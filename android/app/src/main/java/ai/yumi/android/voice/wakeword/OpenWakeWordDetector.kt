package ai.yumi.android.voice.wakeword

import ai.yumi.android.service.WakeWordDetector
import ai.yumi.android.voice.MicrophoneOwner
import android.annotation.SuppressLint
import android.content.Context
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
 * Listens for the wake word with openWakeWord's models on ONNX Runtime, inside the foreground service
 * (SPEC-01 requirements 10 and 12).
 *
 * Audio is read in 80 ms chunks and only kept in [WakeWordEngine]'s short buffers. On a detection, and whenever
 * listening stops, those buffers are cleared, so speech before the wake word is never transcribed or stored.
 * The detector also lets go of the microphone whenever voice intake needs it ([MicrophoneOwner]).
 */
class OpenWakeWordDetector(
    context: Context,
    private val microphone: MicrophoneOwner,
    private val config: WakeWordConfig,
    private val onDetected: () -> Unit,
) : WakeWordDetector {

    private val appContext = context.applicationContext
    private val _listening = MutableStateFlow(false)
    override val listening: StateFlow<Boolean> = _listening.asStateFlow()

    private var job: Job? = null
    private var engine: WakeWordEngine? = null

    @OptIn(ExperimentalCoroutinesApi::class)
    private val audioThread = Dispatchers.IO.limitedParallelism(1)

    override fun start(scope: CoroutineScope) {
        if (job?.isActive == true) return
        if (config.isStandIn) Log.i(TAG, "Wake word is a STAND-IN: ${config.modelFile} until OBJ-12's hey_yumi.onnx")
        job = scope.launch(audioThread) { run() }
    }

    override fun stop() {
        job?.cancel()
        job = null
    }

    private suspend fun run() {
        val engine = engine ?: load() ?: return
        this.engine = engine
        try {
            while (coroutineContext.isActive) {
                microphone.intakeActive.first { !it }
                if (listenUntilDetected(engine)) {
                    Log.i(TAG, "Wake word detected")
                    // Intake marks the microphone as taken before this returns, so the loop waits for it to finish.
                    withContext(Dispatchers.Main) { onDetected() }
                }
            }
        } finally {
            engine.clear()
            _listening.value = false
            microphone.setDetectorOpen(false)
        }
    }

    /** Opens the microphone and reads until the wake word is heard (true) or intake needs the microphone (false). */
    @SuppressLint("MissingPermission") // The service only starts the detector while the microphone is allowed.
    private suspend fun listenUntilDetected(engine: WakeWordEngine): Boolean {
        val record = openRecord() ?: run {
            delay(RETRY_DELAY)
            return false
        }
        engine.reset()
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
                if (engine.detect(chunk)) return true
            }
        } finally {
            chunk.fill(0)
            engine.clear()
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

    private fun load(): WakeWordEngine? = try {
        val assets = appContext.assets
        fun read(name: String) = assets.open("${WakeWordConfig.ASSET_DIR}/$name").use { it.readBytes() }
        val models = OnnxWakeWordModels(
            read(WakeWordConfig.MELSPECTROGRAM_FILE),
            read(WakeWordConfig.EMBEDDING_FILE),
            read(config.modelFile),
        )
        WakeWordEngine(models, models, config.threshold)
    } catch (e: Exception) {
        // The status line then never says it is listening, which is the truth. Nothing to show the user.
        Log.e(TAG, "Could not load the wake word models", e)
        null
    }

    private companion object {
        const val TAG = "YumiWakeWord"
        const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        val RETRY_DELAY = 5.seconds
    }
}
