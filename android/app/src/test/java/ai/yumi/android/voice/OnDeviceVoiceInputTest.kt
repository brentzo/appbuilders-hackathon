package ai.yumi.android.voice

import ai.yumi.android.errors.ErrorButton
import ai.yumi.android.errors.ErrorKind
import ai.yumi.android.errors.ErrorPresenter
import android.speech.SpeechRecognizer
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OnDeviceVoiceInputTest {

    /** Stands in for Android's recognizer. Events are sent the way `RecognitionListener` reports them. */
    private class FakeEngine(var available: Boolean = true) : SpeechEngine {
        var onEvent: ((SpeechEvent) -> Unit)? = null
        var starts = 0
        var stops = 0
        var cancels = 0
        override fun isAvailable() = available
        override fun start(onEvent: (SpeechEvent) -> Unit) {
            starts++
            this.onEvent = onEvent
        }
        override fun stop() { stops++ }
        override fun cancel() { cancels++ }
        fun send(event: SpeechEvent) = checkNotNull(onEvent)(event)
    }

    private val engine = FakeEngine()
    private val microphone = MicrophoneOwner()
    private val goals = mutableListOf<String>()
    private var sounds = 0
    private var micAllowed = true

    private fun TestScope.voice() = OnDeviceVoiceInput(
        engine = engine,
        microphone = microphone,
        goals = { goals += it },
        sound = { sounds++ },
        microphoneAllowed = { micAllowed },
        scope = this,
        log = {},
    )

    @Test
    fun pushToTalkTranscribesWhenTheUserStopsSpeaking() = runTest {
        val voice = voice()
        voice.start()
        runCurrent()
        assertTrue(voice.active.value)
        assertFalse("indicator only once the microphone is on", voice.listening.value)

        engine.send(SpeechEvent.Ready)
        assertTrue(voice.listening.value)
        engine.send(SpeechEvent.Partial("set a timer"))
        assertEquals("set a timer", voice.partial.value)
        engine.send(SpeechEvent.EndOfSpeech)
        assertFalse("microphone is off after the user stops speaking", voice.listening.value)
        engine.send(SpeechEvent.Results(listOf("set a timer for 10 minutes")))

        assertEquals(listOf("set a timer for 10 minutes"), goals)
        assertFalse(voice.active.value)
        assertNull(voice.failure.value)
        assertEquals("no chime for push-to-talk", 0, sounds)
        assertFalse(microphone.intakeActive.value)
    }

    @Test
    fun wakeWordPlaysTheListeningSoundBeforeListening() = runTest {
        val voice = voice()
        voice.start(VoiceTrigger.WakeWord)
        assertTrue("the detector must let go of the microphone at once", microphone.intakeActive.value)
        runCurrent()
        assertEquals(1, sounds)
        assertEquals(1, engine.starts)
        engine.send(SpeechEvent.Ready)
        assertTrue(voice.listening.value)
    }

    @Test
    fun waitsForTheWakeWordDetectorToCloseTheMicrophone() = runTest {
        microphone.setDetectorOpen(true)
        val voice = voice()
        voice.start()
        runCurrent()
        assertEquals(0, engine.starts)
        microphone.setDetectorOpen(false)
        runCurrent()
        assertEquals(1, engine.starts)
    }

    @Test
    fun silenceShowsDidntCatchSpeech() = runTest {
        for (code in listOf(SpeechRecognizer.ERROR_SPEECH_TIMEOUT, SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_AUDIO)) {
            val voice = voice()
            voice.start()
            runCurrent()
            engine.send(SpeechEvent.Ready)
            engine.send(SpeechEvent.Error(code))
            assertEquals(ErrorKind.DidntCatchSpeech, voice.failure.value?.kind)
            assertFalse(voice.active.value)
        }
        assertTrue(goals.isEmpty())
    }

    @Test
    fun emptyTranscriptShowsDidntCatchSpeech() = runTest {
        val voice = voice()
        voice.start()
        runCurrent()
        engine.send(SpeechEvent.Results(listOf("  ")))
        assertEquals(ErrorKind.DidntCatchSpeech, voice.failure.value?.kind)
        assertTrue(goals.isEmpty())
    }

    @Test
    fun missingLanguageModelShowsLanguageNotSupported() = runTest {
        for (code in listOf(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)) {
            val voice = voice()
            voice.start()
            runCurrent()
            engine.send(SpeechEvent.Error(code))
            assertEquals(ErrorKind.LanguageNotSupported, voice.failure.value?.kind)
        }
    }

    @Test
    fun anotherSpokenLanguageShowsLanguageNotSupported() = runTest {
        val voice = voice()
        voice.start()
        runCurrent()
        engine.send(SpeechEvent.Language("fil-PH", SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_HIGHLY_CONFIDENT))
        engine.send(SpeechEvent.Results(listOf("pakigising yung mac ko")))
        assertEquals(ErrorKind.LanguageNotSupported, voice.failure.value?.kind)
        assertTrue("an unsupported language never becomes a goal", goals.isEmpty())
    }

    @Test
    fun unsureLanguageGuessesAreIgnored() {
        assertFalse(OnDeviceVoiceInput.isOtherLanguage("de-DE", SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_NOT_CONFIDENT))
        assertFalse(OnDeviceVoiceInput.isOtherLanguage("en-GB", SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_HIGHLY_CONFIDENT))
        assertTrue(OnDeviceVoiceInput.isOtherLanguage("tl", SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_CONFIDENT))
    }

    @Test
    fun noOnDeviceRecognizerNeverFallsBackToAnotherOne() = runTest {
        engine.available = false
        val voice = voice()
        voice.start()
        runCurrent()
        assertEquals(0, engine.starts)
        assertEquals(ErrorKind.LanguageNotSupported, voice.failure.value?.kind)
    }

    @Test
    fun missingMicrophonePermissionNeverOpensTheRecognizer() = runTest {
        micAllowed = false
        val voice = voice()
        voice.start()
        runCurrent()
        assertEquals(0, engine.starts)
        assertEquals(ErrorKind.MicrophonePermissionMissing, voice.failure.value?.kind)
        val buttons = ErrorPresenter(log = { _, _ -> }).present(voice.failure.value!!).buttons.map { it.action }
        assertEquals(listOf(ErrorButton.OpenSettings, ErrorButton.TypeInstead), buttons)
    }

    @Test
    fun permissionRevokedWhileListeningShowsMicrophonePermissionMissing() = runTest {
        val voice = voice()
        voice.start()
        runCurrent()
        engine.send(SpeechEvent.Error(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS))
        assertEquals(ErrorKind.MicrophonePermissionMissing, voice.failure.value?.kind)
    }

    @Test
    fun otherRecognizerErrorsAreUnexpectedAndNeverShowTheCode() = runTest {
        val voice = voice()
        voice.start()
        runCurrent()
        engine.send(SpeechEvent.Error(SpeechRecognizer.ERROR_SERVER_DISCONNECTED))
        val failure = checkNotNull(voice.failure.value)
        assertEquals(ErrorKind.Unexpected, failure.kind)
        val shown = ErrorPresenter(log = { _, _ -> }).present(failure)
        assertFalse(shown.text.contains("11"))
        assertFalse(shown.text.contains("rror"))
    }

    @Test
    fun tappingStopWhileListeningStillTranscribes() = runTest {
        val voice = voice()
        voice.start()
        runCurrent()
        engine.send(SpeechEvent.Ready)
        voice.stop()
        assertEquals(1, engine.stops)
        engine.send(SpeechEvent.Results(listOf("open spotify")))
        assertEquals(listOf("open spotify"), goals)
    }

    @Test
    fun stoppingBeforeTheMicrophoneOpensCancelsQuietly() = runTest {
        microphone.setDetectorOpen(true)
        val voice = voice()
        voice.start()
        runCurrent()
        voice.stop()
        microphone.setDetectorOpen(false)
        runCurrent()
        assertEquals(0, engine.starts)
        assertFalse(voice.active.value)
        assertNull(voice.failure.value)
    }

    @Test
    fun lateEventsFromAnEndedSessionAreIgnored() = runTest {
        val voice = voice()
        voice.start()
        runCurrent()
        val old = checkNotNull(engine.onEvent)
        engine.send(SpeechEvent.Results(listOf("first")))
        old(SpeechEvent.Error(SpeechRecognizer.ERROR_CLIENT))
        assertNull(voice.failure.value)
        assertEquals(listOf("first"), goals)
    }

    @Test
    fun aRecognizerThatNeverFinishesIsStopped() = runTest {
        val voice = voice()
        voice.start()
        runCurrent()
        engine.send(SpeechEvent.Ready)
        advanceTimeBy(31_000)
        assertFalse(voice.active.value)
        assertEquals(ErrorKind.DidntCatchSpeech, voice.failure.value?.kind)
        assertTrue(engine.cancels > 0)
    }
}
