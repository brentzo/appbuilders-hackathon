package ai.yumi.android.voice.wakeword

import ai.yumi.android.AppGraph
import ai.yumi.android.service.WakeWordDetector
import ai.yumi.android.voice.MicrophoneOwner
import android.content.Context
import android.util.Log

/**
 * Hears the wake word in a stream of 80 ms chunks of 16 kHz mono audio. Not thread safe: feed it from one thread.
 * It keeps only what it needs to spot the phrase, and forgets it on [reset] and [clear].
 */
interface WakeWordSpotter {
    /** True if the chunk completes the wake word. */
    fun detect(chunk: ShortArray): Boolean

    /** Forgets all audio heard so far. Call it after a detection and whenever listening starts. */
    fun reset()

    /** Forgets all audio heard so far, without preparing to listen again. */
    fun clear()
}

/**
 * Which spotter listens for "Hey Yumi" (SPEC-01 requirement 10 and its Decisions).
 *
 * [Vosk] is the hackathon spotter until OBJ-12's trained openWakeWord model is ready. To switch: put
 * `hey_yumi.onnx` in `assets/wakeword/`, point [WakeWordConfig.Current] at it, and set [Current] to [OpenWakeWord].
 */
enum class WakeWordChoice {
    /** An offline Vosk recognizer limited to "hey yumi" (OBJ-59). Sound-alikes also wake it, on purpose. */
    Vosk,

    /** openWakeWord on ONNX Runtime, with the model in [WakeWordConfig.Current] (OBJ-24, then OBJ-12). */
    OpenWakeWord;

    /** The detector for this choice. Called once, from [AppGraph]. */
    fun detector(context: Context, microphone: MicrophoneOwner, onDetected: () -> Unit): WakeWordDetector {
        val appContext = context.applicationContext
        return when (this) {
            Vosk -> MicrophoneWakeWordDetector(
                microphone,
                loadSpotter = { VoskSpotter.load(appContext) },
                description = "Vosk ${VoskSpotter.MODEL_NAME}, phrase \"${VoskSpotter.PHRASE}\" (until OBJ-12's model)",
                onDetected = onDetected,
            )
            OpenWakeWord -> {
                val config = WakeWordConfig.Current
                MicrophoneWakeWordDetector(
                    microphone,
                    loadSpotter = { loadOpenWakeWord(appContext, config) },
                    description = "openWakeWord ${config.modelFile}" +
                        if (config.isStandIn) " (STAND-IN until OBJ-12's hey_yumi.onnx)" else "",
                    onDetected = onDetected,
                )
            }
        }
    }

    companion object {
        val Current = Vosk

        private fun loadOpenWakeWord(context: Context, config: WakeWordConfig): WakeWordSpotter? = try {
            fun read(name: String) = context.assets.open("${WakeWordConfig.ASSET_DIR}/$name").use { it.readBytes() }
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

        private const val TAG = "YumiWakeWord"
    }
}
