package ai.yumi.android.voice.wakeword

import kotlin.random.Random

/**
 * Scores a stream of 80 ms chunks the way openWakeWord's `Model.predict` does, for one wake word model.
 * Not thread safe: feed it from one thread.
 */
class WakeWordEngine(
    models: FeatureModels,
    private val classifier: WakeWordClassifier,
    private val threshold: Float,
    random: Random = Random.Default,
) : WakeWordSpotter {
    private val features = AudioFeatures(models, classifier.inputFrames, random)
    private var chunks = 0

    /** Scores one chunk of [AudioFeatures.CHUNK_SAMPLES] samples, between 0 and 1. */
    fun score(chunk: ShortArray): Float {
        features.accept(chunk)
        val score = classifier.score(features.features())
        // Like the reference, the first 5 scores are 0 while the buffers still hold start-up values.
        return if (chunks++ < WARM_UP_CHUNKS) 0f else score
    }

    override fun detect(chunk: ShortArray): Boolean = score(chunk) >= threshold

    override fun reset() {
        features.reset()
        chunks = 0
    }

    override fun clear() {
        features.clear()
        chunks = 0
    }

    private companion object {
        const val WARM_UP_CHUNKS = 5
    }
}
