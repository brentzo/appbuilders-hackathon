package ai.yumi.android.voice.wakeword

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import java.nio.FloatBuffer

/**
 * The openWakeWord model, and the phrase the user says, which the screens show whichever spotter runs.
 *
 * The model is only used when [WakeWordChoice.Current] is [WakeWordChoice.OpenWakeWord]; until OBJ-12 lands the app
 * uses [WakeWordChoice.Vosk] instead. STAND-IN until OBJ-12: openWakeWord's pre-trained "hey jarvis" model. To switch,
 * put `hey_yumi.onnx` in `assets/wakeword/`, change [Current]'s model file to it, and set [WakeWordChoice.Current] to
 * [WakeWordChoice.OpenWakeWord]. Nothing else changes.
 */
data class WakeWordConfig(
    /** File name under `assets/wakeword/`. */
    val modelFile: String,
    /** What the user says, as shown on screen. Uses a non-breaking space so it never splits across lines. */
    val phrase: String,
    /** Score at or above which the phrase counts as said. openWakeWord's models are trained for 0.5. */
    val threshold: Float = 0.5f,
    val isStandIn: Boolean,
) {
    companion object {
        val Current = WakeWordConfig(modelFile = "hey_jarvis_v0.1.onnx", phrase = "Hey Yumi", isStandIn = true)

        const val ASSET_DIR = "wakeword"
        const val MELSPECTROGRAM_FILE = "melspectrogram.onnx"
        const val EMBEDDING_FILE = "embedding_model.onnx"
    }
}

/** openWakeWord's two shared feature models: audio to melspectrogram, and melspectrogram windows to embeddings. */
interface FeatureModels {
    /** Melspectrogram of 16 kHz audio given as float sample values (not scaled). One row of [MEL_BINS] per 10 ms frame. */
    fun melspectrogram(samples: FloatArray): Array<FloatArray>

    /** One [EMBEDDING_SIZE] embedding for each window of [EMBEDDING_WINDOW] melspectrogram rows. */
    fun embeddings(windows: List<Array<FloatArray>>): List<FloatArray>

    companion object {
        const val MEL_BINS = 32
        const val EMBEDDING_WINDOW = 76
        const val EMBEDDING_SIZE = 96
    }
}

/** A wake word model: scores the last [inputFrames] embeddings between 0 and 1. */
interface WakeWordClassifier {
    val inputFrames: Int
    fun score(features: List<FloatArray>): Float
}

/** Runs openWakeWord's ONNX models with ONNX Runtime, one thread each, as openWakeWord itself does. */
class OnnxWakeWordModels(
    melspectrogramModel: ByteArray,
    embeddingModel: ByteArray,
    wakeWordModel: ByteArray,
) : FeatureModels, WakeWordClassifier, AutoCloseable {

    private val env = OrtEnvironment.getEnvironment()
    private val melspectrogram = session(melspectrogramModel)
    private val embedding = session(embeddingModel)
    private val wakeWord = session(wakeWordModel)
    private val wakeWordInput = wakeWord.inputNames.first()

    override val inputFrames: Int =
        (wakeWord.inputInfo.getValue(wakeWordInput).info as TensorInfo).shape[1].toInt()

    override fun melspectrogram(samples: FloatArray): Array<FloatArray> {
        val flat = run(melspectrogram, "input", FloatBuffer.wrap(samples), longArrayOf(1, samples.size.toLong()))
        return Array(flat.size / FeatureModels.MEL_BINS) { row ->
            flat.copyOfRange(row * FeatureModels.MEL_BINS, (row + 1) * FeatureModels.MEL_BINS)
        }
    }

    override fun embeddings(windows: List<Array<FloatArray>>): List<FloatArray> {
        if (windows.isEmpty()) return emptyList()
        val input = FloatBuffer.allocate(windows.size * FeatureModels.EMBEDDING_WINDOW * FeatureModels.MEL_BINS)
        windows.forEach { window -> window.forEach { input.put(it) } }
        input.rewind()
        val shape = longArrayOf(windows.size.toLong(), FeatureModels.EMBEDDING_WINDOW.toLong(), FeatureModels.MEL_BINS.toLong(), 1)
        val flat = run(embedding, "input_1", input, shape)
        return List(windows.size) { flat.copyOfRange(it * FeatureModels.EMBEDDING_SIZE, (it + 1) * FeatureModels.EMBEDDING_SIZE) }
    }

    override fun score(features: List<FloatArray>): Float {
        val input = FloatBuffer.allocate(features.size * FeatureModels.EMBEDDING_SIZE)
        features.forEach { input.put(it) }
        input.rewind()
        return run(wakeWord, wakeWordInput, input, longArrayOf(1, features.size.toLong(), FeatureModels.EMBEDDING_SIZE.toLong()))[0]
    }

    override fun close() {
        melspectrogram.close()
        embedding.close()
        wakeWord.close()
    }

    private fun session(model: ByteArray): OrtSession =
        OrtSession.SessionOptions().use { options ->
            options.setIntraOpNumThreads(1)
            options.setInterOpNumThreads(1)
            env.createSession(model, options)
        }

    private fun run(session: OrtSession, inputName: String, input: FloatBuffer, shape: LongArray): FloatArray =
        OnnxTensor.createTensor(env, input, shape).use { tensor ->
            session.run(mapOf(inputName to tensor)).use { result ->
                val output = (result.get(0) as OnnxTensor).floatBuffer
                FloatArray(output.remaining()).also { output.get(it) }
            }
        }
}
