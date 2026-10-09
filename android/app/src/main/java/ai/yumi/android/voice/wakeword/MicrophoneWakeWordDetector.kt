package ai.yumi.android.voice.wakeword

import ai.yumi.android.service.WakeWordDetector
import ai.yumi.android.voice.MicrophoneOwner
import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext
import kotlin.time.Duration.Companion.seconds

/**
 * Listens for the wake word inside the foreground service (SPEC-01 requirements 10 and 12), with whichever
 * [WakeWordSpotter] [WakeWordChoice] picks.
 *
 * Audio is read in 80 ms chunks and handed straight to the spotter, which only keeps its own short state. On a
 * detection, and whenever listening stops, that state is cleared, so speech before the wake word is never stored.
 * The detector also lets go of the microphone whenever voice intake needs it ([MicrophoneOwner]).
 */
class MicrophoneWakeWordDetector(
    private val microphone: MicrophoneOwner,
    /** Loads the spotter on the audio thread, or returns null (and logs why) if it cannot. */
    private val loadSpotter: () -> WakeWordSpotter?,
    /** Logged when listening starts, to say which detector runs and whether it is a stand-in. */
    private val description: String,
    private val onDetected: () -> Unit,
) : WakeWordDetector {

    private val _listening = MutableStateFlow(false)
    override val listening: StateFlow<Boolean> = _listening.asStateFlow()

    private var job: Job? = null
    private var spotter: WakeWordSpotter? = null

    @OptIn(ExperimentalCoroutinesApi::class)
    private val audioThread = Dispatchers.IO.limitedParallelism(1)

    override fun start(scope: CoroutineScope) {
        if (job?.isActive == true) return
        Log.i(TAG, "Wake word detector: $description")
        job = scope.launch(audioThread) { run() }
    }

    override fun stop() {
        job?.cancel()
        job = null
    }

    private suspend fun run() {
        val active = spotter ?: loadSpotter() ?: return
        spotter = active
        try {
            while (coroutineContext.isActive) {
                microphone.intakeActive.first { !it }
                if (listenUntilDetected(active)) {
                    Log.i(TAG, "Wake word detected")
                    // Intake marks the microphone as taken before this returns, so the loop waits for it to finish.
                    withContext(Dispatchers.Main) { onDetected() }
                }
            }
        } finally {
            active.clear()
            _listening.value = false
            microphone.setDetectorOpen(false)
        }
    }

    /** Opens the microphone and reads until the wake word is heard (true) or intake needs the microphone (false). */
    @SuppressLint("MissingPermission") // The service only starts the detector while the microphone is allowed.
    private suspend fun listenUntilDetected(active: WakeWordSpotter): Boolean {
        val record = openRecord() ?: run {
            delay(RETRY_DELAY)
            return false
        }
        active.reset()
        val chunk = ShortArray(AudioFeatures.CHUNK_SAMPLES)
        try {
            record.startRecording()
            microphone.setDetectorOpen(true)
            _listening.value = true
            while (true) {
                coroutineContext.ensureActive()
                if (microphone.intakeActive.value) return false
                if (!readChunk(record, chunk)) {
                    Log.w(TAG, "The microphone stopped giving audio, opening it again")
                    delay(RETRY_DELAY)
                    return false
                }
                if (active.detect(chunk)) return true
            }
        } finally {
            chunk.fill(0)
            active.clear()
            record.stop()
            record.release()
            _listening.value = false
            microphone.setDetectorOpen(false)
        }
    }

    private fun readChunk(record: AudioRecord, chunk: ShortArray): Boolean {
        var read = 0
        while (read < chunk.size) {
            val n = record.read(chunk, read, chunk.size - read)
            if (n <= 0) return false
            read += n
        }
        return true
    }

    @SuppressLint("MissingPermission")
    private fun openRecord(): AudioRecord? {
        val minBuffer = AudioRecord.getMinBufferSize(AudioFeatures.SAMPLE_RATE, CHANNEL, ENCODING)
        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                AudioFeatures.SAMPLE_RATE,
                CHANNEL,
                ENCODING,
                maxOf(minBuffer, AudioFeatures.CHUNK_SAMPLES * 2 * 4),
            )
        } catch (e: SecurityException) {
            Log.w(TAG, "Microphone not allowed", e)
            return null
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Microphone does not support 16 kHz mono", e)
            return null
        }
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            Log.w(TAG, "Could not open the microphone (state ${record.state})")
            record.release()
            return null
        }
        return record
    }

    private companion object {
        const val TAG = "YumiWakeWord"
        const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        val RETRY_DELAY = 5.seconds
    }
}
