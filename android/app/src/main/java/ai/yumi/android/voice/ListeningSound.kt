package ai.yumi.android.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.sin
import kotlin.time.Duration.Companion.milliseconds

/** The short sound Yumi plays when the wake word starts listening (SPEC-01, "Wake word starts listening"). */
fun interface ListeningSound {
    /** Plays the sound and returns when it has finished, so the recognizer does not hear it. */
    suspend fun play()
}

/** A soft two-note rising chime, made in code so there is no audio file to ship. */
class ChimeListeningSound : ListeningSound {
    private val pcm: ShortArray by lazy { chime() }

    override suspend fun play() {
        val track = try {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(SAMPLE_RATE)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(pcm.size * 2)
                .build()
        } catch (e: Exception) {
            // Listening still works without the sound.
            Log.w("YumiVoice", "Could not play the listening sound", e)
            return
        }
        try {
            track.write(pcm, 0, pcm.size)
            track.play()
            delay((pcm.size * 1000L / SAMPLE_RATE).milliseconds + TAIL)
        } finally {
            track.stop()
            track.release()
        }
    }

    private fun chime(): ShortArray {
        val notes = listOf(NOTE_LOW to 0.0, NOTE_HIGH to NOTE_GAP)
        val length = ((NOTE_GAP + NOTE_LENGTH) * SAMPLE_RATE).toInt()
        val out = FloatArray(length)
        for ((frequency, start) in notes) {
            val offset = (start * SAMPLE_RATE).toInt()
            val count = (NOTE_LENGTH * SAMPLE_RATE).toInt()
            for (i in 0 until count) {
                val t = i.toDouble() / SAMPLE_RATE
                // Quick attack, smooth exponential decay: a soft bell rather than a beep.
                val envelope = minOf(1.0, t / ATTACK) * kotlin.math.exp(-t * DECAY)
                val tone = sin(2 * PI * frequency * t) + 0.25 * sin(4 * PI * frequency * t)
                out[offset + i] += (tone * envelope * VOLUME).toFloat()
            }
        }
        return ShortArray(length) { (out[it].coerceIn(-1f, 1f) * Short.MAX_VALUE).toInt().toShort() }
    }

    private companion object {
        const val SAMPLE_RATE = 44_100
        const val NOTE_LOW = 880.0 // A5
        const val NOTE_HIGH = 1318.5 // E6
        const val NOTE_GAP = 0.09
        const val NOTE_LENGTH = 0.22
        const val ATTACK = 0.005
        const val DECAY = 14.0
        const val VOLUME = 0.22
        val TAIL = 40.milliseconds
    }
}
