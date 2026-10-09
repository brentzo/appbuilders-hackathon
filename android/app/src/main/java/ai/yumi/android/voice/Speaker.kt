package ai.yumi.android.voice

import android.content.Context
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale

/**
 * Yumi's speech output on the phone (SPEC-10 Part A). The replies and results are spoken through this,
 * never shown only. [SilentSpeaker] is the stand-in that says nothing, used until the real voice is ready.
 */
fun interface Speaker {
    fun speak(text: String)
}

/** Says nothing. Used in tests and before [AndroidTtsSpeaker] has started. */
object SilentSpeaker : Speaker {
    override fun speak(text: String) = Unit
}

/**
 * Android text to speech, English. If it could not start, it stays quiet instead of falling back to
 * another engine or crashing (SPEC-11 "Voice didn't load").
 */
class AndroidTtsSpeaker(
    context: Context,
    private val log: (String) -> Unit = { Log.i(TAG, it) },
) : Speaker {
    private var ready = false
    private var tts: TextToSpeech? = null

    init {
        tts = TextToSpeech(context.applicationContext, ::onInit)
    }

    private fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.US
            ready = true
        } else {
            log("Text to speech did not start, so Yumi stays quiet")
        }
    }

    override fun speak(text: String) {
        val line = text.trim()
        if (line.isEmpty()) return
        if (!ready) {
            log("Voice is not ready yet, so this reply is not spoken")
            return
        }
        tts?.speak(line, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE_ID)
    }

    companion object {
        private const val TAG = "YumiVoice"
        private const val UTTERANCE_ID = "yumi"
    }
}
