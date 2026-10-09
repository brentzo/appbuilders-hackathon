package ai.yumi.android.voice

import ai.yumi.android.errors.ErrorKind
import ai.yumi.android.errors.YumiException
import android.annotation.SuppressLint
import android.speech.SpeechRecognizer
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

/**
 * Voice intake on the phone (SPEC-01, SPEC-10 Part A requirement 1): the on-device recognizer, English only.
 * Every transcript goes to [goals]. Every failure becomes a SPEC-11 kind in [failure].
 *
 * Runs on the main thread, as Android's recognizer requires.
 */
class OnDeviceVoiceInput(
    private val engine: SpeechEngine,
    private val microphone: MicrophoneOwner,
    private val goals: GoalSink,
    private val sound: ListeningSound,
    private val microphoneAllowed: () -> Boolean,
    private val scope: CoroutineScope,
    private val log: (String) -> Unit = { Log.i(TAG, it) },
) : VoiceInput {

    private enum class Phase { Idle, Starting, Listening, Transcribing }

    private var phase = Phase.Idle
        set(value) {
            field = value
            _listening.value = value == Phase.Listening
            _active.value = value != Phase.Idle
            microphone.setIntakeActive(value != Phase.Idle)
        }

    private val _listening = MutableStateFlow(false)
    private val _active = MutableStateFlow(false)
    private val _partial = MutableStateFlow<String?>(null)
    private val _failure = MutableStateFlow<YumiException?>(null)
    override val listening: StateFlow<Boolean> = _listening.asStateFlow()
    override val active: StateFlow<Boolean> = _active.asStateFlow()
    override val partial: StateFlow<String?> = _partial.asStateFlow()
    override val failure: StateFlow<YumiException?> = _failure.asStateFlow()

    /** Increases with every session, so late events from an ended session are ignored. */
    private var session = 0
    /** The recognizer's latest confident guess at the spoken language. Early guesses are often wrong. */
    private var spokenLanguage: String? = null
    private var watchdog: Job? = null

    override fun start(trigger: VoiceTrigger) {
        if (phase != Phase.Idle) return
        _failure.value = null
        _partial.value = null
        spokenLanguage = null
        if (!microphoneAllowed()) return fail(ErrorKind.MicrophonePermissionMissing, "Microphone not allowed")
        if (!engine.isAvailable()) {
            return fail(ErrorKind.SpeechRecognitionNotSetUp, "This phone has no on-device speech recognizer")
        }
        phase = Phase.Starting
        val id = ++session
        log("Listening session $id started by $trigger")
        scope.launch {
            if (!microphone.awaitDetectorClosed(DETECTOR_CLOSE_TIMEOUT)) log("Wake word detector still open, starting anyway")
            if (trigger == VoiceTrigger.WakeWord) sound.play()
            if (id != session || phase != Phase.Starting) return@launch
            try {
                engine.start { event -> if (id == session) onEvent(event) }
            } catch (e: RuntimeException) {
                // createOnDeviceSpeechRecognizer throws UnsupportedOperationException when there is none.
                finish(YumiException(ErrorKind.SpeechRecognitionNotSetUp, "Could not start the on-device recognizer", e))
                return@launch
            }
            watchdog = scope.launch {
                delay(SESSION_LIMIT)
                if (id == session && phase != Phase.Idle) {
                    engine.cancel()
                    finish(YumiException(ErrorKind.DidntCatchSpeech, "The recognizer never finished"))
                }
            }
        }
    }

    override fun stop() {
        when (phase) {
            Phase.Idle, Phase.Transcribing -> Unit
            Phase.Starting -> {
                log("Stopped before the microphone opened")
                finish(null)
            }
            Phase.Listening -> engine.stop()
        }
    }

    override fun clearFailure() {
        _failure.value = null
    }

    private fun onEvent(event: SpeechEvent) {
        when (event) {
            SpeechEvent.Ready -> if (phase == Phase.Starting) phase = Phase.Listening
            SpeechEvent.EndOfSpeech -> if (phase != Phase.Idle) phase = Phase.Transcribing
            is SpeechEvent.Partial -> _partial.value = event.text.ifBlank { null }
            is SpeechEvent.Language -> {
                if (isConfident(event.confidence)) spokenLanguage = event.tag
            }
            is SpeechEvent.Results -> {
                val text = event.texts.firstOrNull { it.isNotBlank() }?.trim()
                val language = spokenLanguage
                when {
                    language != null && !isEnglish(language) ->
                        finish(YumiException(ErrorKind.LanguageNotSupported, "Spoken language was $language"))
                    text == null -> finish(YumiException(ErrorKind.DidntCatchSpeech, "Empty transcript"))
                    else -> {
                        finish(null)
                        // Never log the transcript itself.
                        log("Transcript handed to onGoal (${text.split(' ').size} words)")
                        goals.onGoal(text)
                    }
                }
            }
            is SpeechEvent.Error -> {
                val language = spokenLanguage
                val kind = errorKind(event.code)
                // An English-only recognizer often finds no match in another language even though it is sure
                // which language it heard. The language is the real reason, so say that.
                if (kind == ErrorKind.DidntCatchSpeech && language != null && !isEnglish(language)) {
                    finish(YumiException(ErrorKind.LanguageNotSupported, "Spoken language was $language, recognizer error ${event.code}"))
                } else {
                    finish(YumiException(kind, "Recognizer error ${event.code}"))
                }
            }
        }
    }

    private fun fail(kind: ErrorKind, detail: String) {
        log(detail)
        _failure.value = YumiException(kind, detail)
    }

    private fun finish(error: YumiException?) {
        session++
        watchdog?.cancel()
        watchdog = null
        if (phase != Phase.Idle) engine.cancel()
        phase = Phase.Idle
        _partial.value = null
        if (error != null) {
            log("Listening ended: ${error.message}")
            _failure.value = error
        }
    }

    companion object {
        private const val TAG = "YumiVoice"
        private val DETECTOR_CLOSE_TIMEOUT = 500.milliseconds
        private val SESSION_LIMIT = 30.seconds

        /** Maps `SpeechRecognizer.ERROR_*` codes to SPEC-11 kinds. */
        fun errorKind(code: Int): ErrorKind = when (code) {
            // The recognizer cannot do English, or its English pack is not downloaded yet. Speech in another
            // language is told apart by language detection instead (LanguageNotSupported).
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
            SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
            -> ErrorKind.SpeechRecognitionNotSetUp

            SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_AUDIO,
            -> ErrorKind.DidntCatchSpeech

            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> ErrorKind.MicrophonePermissionMissing
            else -> ErrorKind.Unexpected
        }

        /**
         * Low-confidence guesses are ignored. On the demo phone the recognizer guessed "ar-eg" as confident early in
         * an English sentence, then settled on "en-us" as highly confident, so only the latest confident guess counts.
         */
        @SuppressLint("InlinedApi") // Language detection results only arrive on Android 14 and later.
        fun isConfident(confidence: Int): Boolean =
            confidence >= SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_CONFIDENT

        fun isEnglish(tag: String): Boolean = Locale.forLanguageTag(tag).language.let { it.isEmpty() || it == "en" }
    }
}
