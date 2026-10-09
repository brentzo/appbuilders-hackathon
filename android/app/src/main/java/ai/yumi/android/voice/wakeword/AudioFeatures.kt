package ai.yumi.android.voice.wakeword

import ai.yumi.android.voice.wakeword.FeatureModels.Companion.EMBEDDING_WINDOW
import ai.yumi.android.voice.wakeword.FeatureModels.Companion.MEL_BINS
import kotlin.random.Random

/**
 * Kotlin port of openWakeWord's streaming feature step (`AudioFeatures._streaming_features` in
 * `openwakeword/utils.py`, source at commit 368c037), for 16 kHz 16-bit mono audio fed in chunks of exactly
 * [CHUNK_SAMPLES] (80 ms), which is how openWakeWord recommends feeding it.
 *
 * Per chunk, like the reference:
 * 1. Melspectrogram of the chunk plus the 480 samples before it, transformed with `x / 10 + 2`.
 * 2. Append the frames to the melspectrogram buffer, which starts as 76 rows of ones.
 * 3. Embed the last 76 frames and append the embedding to the feature buffer, which starts with the embeddings
 *    of 4 seconds of random noise.
 *
 * Differences that do not change the result: the reference keeps 10 seconds of raw audio, 970 melspectrogram
 * frames, and 120 embeddings, but with 80 ms chunks it only ever reads the last 480 samples, 76 frames, and as many
 * embeddings as the wake word model takes. This keeps only those, so audio before the wake word lives in memory
 * for at most 110 ms (SPEC-01 requirement 10). `AudioFeaturesParityTest` checks the scores against the reference.
 */
class AudioFeatures(
    private val models: FeatureModels,
    private val featureFrames: Int,
    private val random: Random = Random.Default,
) {
    /** The last [CONTEXT_SAMPLES] samples of the previous chunk. Empty before the first chunk. */
    private var tail = FloatArray(0)
    private val melBuffer = ArrayDeque<FloatArray>()
    private val featureBuffer = ArrayDeque<FloatArray>()

    init {
        reset()
    }

    /** Adds one chunk of audio and computes one new embedding. */
    fun accept(chunk: ShortArray) {
        require(chunk.size == CHUNK_SAMPLES) { "Chunks must be $CHUNK_SAMPLES samples" }
        val input = FloatArray(tail.size + chunk.size)
        tail.copyInto(input)
        for (i in chunk.indices) input[tail.size + i] = chunk[i].toFloat()
        tail = input.copyOfRange(input.size - minOf(CONTEXT_SAMPLES, input.size), input.size)

        models.melspectrogram(input).forEach { melBuffer.addLast(transform(it)) }
        while (melBuffer.size > EMBEDDING_WINDOW) melBuffer.removeFirst()

        featureBuffer.addLast(models.embeddings(listOf(melBuffer.toTypedArray())).single())
        while (featureBuffer.size > featureFrames) featureBuffer.removeFirst()
    }

    /** The last [featureFrames] embeddings, oldest first: the wake word model's input. */
    fun features(): List<FloatArray> = featureBuffer.toList()

    /** Discards everything heard so far, then starts over as the reference does after `reset()`. */
    fun reset() {
        clear()
        repeat(EMBEDDING_WINDOW) { melBuffer.addLast(FloatArray(MEL_BINS) { 1f }) }
        featureBuffer.addAll(noiseEmbeddings())
    }

    /** Overwrites and drops all buffered audio and features. */
    fun clear() {
        tail.fill(0f)
        tail = FloatArray(0)
        melBuffer.forEach { it.fill(0f) }
        melBuffer.clear()
        featureBuffer.forEach { it.fill(0f) }
        featureBuffer.clear()
    }

    /** The reference starts from `_get_embeddings` of 4 s of random integers in [-1000, 1000). */
    private fun noiseEmbeddings(): List<FloatArray> {
        val noise = FloatArray(NOISE_SAMPLES) { random.nextInt(-1000, 1000).toFloat() }
        val spec = models.melspectrogram(noise).map(::transform)
        val starts = (0 until spec.size step EMBEDDING_STEP).filter { it + EMBEDDING_WINDOW <= spec.size }
        val windows = starts.takeLast(featureFrames).map { start -> spec.subList(start, start + EMBEDDING_WINDOW).toTypedArray() }
        return models.embeddings(windows)
    }

    /** openWakeWord's default `melspec_transform`, which brings the ONNX model close to Google's TF original. */
    private fun transform(row: FloatArray): FloatArray = FloatArray(row.size) { row[it] / 10f + 2f }

    companion object {
        const val SAMPLE_RATE = 16_000
        const val CHUNK_SAMPLES = 1280
        const val CONTEXT_SAMPLES = 160 * 3
        private const val EMBEDDING_STEP = 8
        private const val NOISE_SAMPLES = SAMPLE_RATE * 4
    }
}
