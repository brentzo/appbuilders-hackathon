package ai.yumi.android.voice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log

/** What the recognizer reports during one listening session. */
sealed interface SpeechEvent {
    /** The microphone is open. */
    data object Ready : SpeechEvent

    /** The user stopped speaking and the microphone is closed. Results or an error follow. */
    data object EndOfSpeech : SpeechEvent
    data class Partial(val text: String) : SpeechEvent
    data class Language(val tag: String, val confidence: Int) : SpeechEvent
    data class Results(val texts: List<String>) : SpeechEvent

    /** [code] is one of `SpeechRecognizer.ERROR_*`. */
    data class Error(val code: Int) : SpeechEvent
}

/** One speech recognizer session at a time. Call from the main thread. */
interface SpeechEngine {
    /** False if the phone has no on-device recognizer at all. */
    fun isAvailable(): Boolean
    fun start(onEvent: (SpeechEvent) -> Unit)

    /** Stops listening and transcribes what was heard. */
    fun stop()

    /** Stops without results. No further events arrive. */
    fun cancel()
}

/**
 * Android's on-device recognizer, English only (SPEC-10 requirement 1, SPEC-01 requirement 2).
 *
 * Always created with `createOnDeviceSpeechRecognizer`, never `createSpeechRecognizer`, which may use the cloud.
 * If the on-device recognizer cannot handle the request it fails, and Yumi shows an error. There is no fallback.
 */
class OnDeviceSpeechEngine(context: Context) : SpeechEngine {
    private val appContext = context.applicationContext
    private var recognizer: SpeechRecognizer? = null

    override fun isAvailable(): Boolean = SpeechRecognizer.isOnDeviceRecognitionAvailable(appContext)

    override fun start(onEvent: (SpeechEvent) -> Unit) {
        release()
        val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(appContext)
        this.recognizer = recognizer
        recognizer.setRecognitionListener(Listener(onEvent))
        recognizer.startListening(intent())
    }

    override fun stop() {
        recognizer?.stopListening()
    }

    override fun cancel() {
        release()
    }

    private fun release() {
        recognizer?.let {
            it.cancel()
            it.destroy()
        }
        recognizer = null
    }

    private fun intent() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, LANGUAGE)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Lets Yumi tell "spoke another language" apart from "said nothing". Some recognizers ignore it.
            putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_DETECTION, true)
        }
    }

    private inner class Listener(private val onEvent: (SpeechEvent) -> Unit) : RecognitionListener {
        private var lastGuess: String? = null

        override fun onReadyForSpeech(params: Bundle?) {
            Log.i(TAG, "Microphone on")
            onEvent(SpeechEvent.Ready)
        }

        override fun onBeginningOfSpeech() {
            Log.i(TAG, "Speech started")
        }
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() {
            Log.i(TAG, "Speech ended, microphone off")
            onEvent(SpeechEvent.EndOfSpeech)
        }

        override fun onError(error: Int) {
            Log.i(TAG, "Recognizer error $error")
            release()
            onEvent(SpeechEvent.Error(error))
        }

        override fun onResults(results: Bundle?) {
            release()
            onEvent(SpeechEvent.Results(texts(results)))
        }

        override fun onPartialResults(partialResults: Bundle?) {
            texts(partialResults).firstOrNull()?.let { onEvent(SpeechEvent.Partial(it)) }
        }

        override fun onLanguageDetection(results: Bundle) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
            val tag = results.getString(SpeechRecognizer.DETECTED_LANGUAGE) ?: return
            val confidence = results.getInt(SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL)
            val guess = "$tag ($confidence)"
            if (guess != lastGuess) Log.i(TAG, "Detected language $guess")
            lastGuess = guess
            onEvent(SpeechEvent.Language(tag, confidence))
        }

        override fun onEvent(eventType: Int, params: Bundle?) = Unit

        private fun texts(bundle: Bundle?): List<String> =
            bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
    }

    private companion object {
        const val TAG = "YumiVoice"
        const val LANGUAGE = "en-US"
    }
}
