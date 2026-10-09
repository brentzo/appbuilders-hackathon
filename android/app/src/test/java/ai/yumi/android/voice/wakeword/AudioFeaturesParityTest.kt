package ai.yumi.android.voice.wakeword

import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.random.Random

/**
 * Checks the Kotlin feature port against openWakeWord's own Python pipeline.
 *
 * The fixtures in `src/test/resources/wakeword/` are clips made with macOS `say` (Samantha, 16 kHz) and the
 * scores `reference.py` printed for them with openWakeWord at commit 368c037 and ONNX Runtime 1.31.0:
 *
 *     python reference.py <models dir> hey_jarvis.wav > hey_jarvis.scores.txt
 *
 * The first scores depend on the random noise both sides start from, so the comparison starts once every
 * embedding the model sees comes from the clip.
 */
class AudioFeaturesParityTest {

    @Test
    fun scoresMatchTheReferenceWhenTheWakeWordIsSaid() {
        val (kotlin, reference) = scores("hey_jarvis")
        assertMatches(kotlin, reference)
        assertTrue("the reference detects the wake word", reference.max() >= 0.5f)
        assertTrue("the port detects the wake word", kotlin.max() >= 0.5f)
    }

    @Test
    fun scoresMatchTheReferenceForOtherSpeech() {
        val (kotlin, reference) = scores("no_wake")
        assertMatches(kotlin, reference)
        assertFalse("no detection in other speech", kotlin.any { it >= 0.5f })
    }

    @Test
    fun clearDiscardsAllBufferedAudio() {
        val features = AudioFeatures(models, models.inputFrames, Random(1))
        pcm("hey_jarvis").take(10).forEach(features::accept)
        features.clear()
        assertTrue(features.features().isEmpty())
    }

    private fun assertMatches(kotlin: List<Float>, reference: List<Float>) {
        assertEquals(reference.size, kotlin.size)
        val firstComparable = models.inputFrames - 1
        for (i in firstComparable until reference.size) {
            assertEquals("score of chunk $i", reference[i], kotlin[i], TOLERANCE)
        }
    }

    private fun scores(clip: String): Pair<List<Float>, List<Float>> {
        val engine = WakeWordEngine(models, models, WakeWordConfig.Current.threshold, Random(0))
        val kotlin = pcm(clip).map(engine::score)
        val reference = resource("$clip.scores.txt").readLines().filter { it.isNotBlank() }.map { it.toFloat() }
        return kotlin to reference
    }

    private fun pcm(clip: String): List<ShortArray> {
        val bytes = resource("$clip.wav").readBytes()
        val data = dataChunk(bytes)
        val samples = ShortArray(data.remaining() / 2).also { data.asShortBuffer().get(it) }
        return (0..samples.size - AudioFeatures.CHUNK_SAMPLES step AudioFeatures.CHUNK_SAMPLES)
            .map { samples.copyOfRange(it, it + AudioFeatures.CHUNK_SAMPLES) }
    }

    /** The samples of a 16 kHz mono 16-bit WAV file. */
    private fun dataChunk(bytes: ByteArray): ByteBuffer {
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        var offset = 12
        while (offset + 8 <= bytes.size) {
            val id = String(bytes, offset, 4, Charsets.US_ASCII)
            val size = buffer.getInt(offset + 4)
            if (id == "fmt ") {
                assertEquals(1, buffer.getShort(offset + 10).toInt())
                assertEquals(16_000, buffer.getInt(offset + 12))
                assertEquals(16, buffer.getShort(offset + 22).toInt())
            }
            if (id == "data") {
                return ByteBuffer.wrap(bytes, offset + 8, size).slice().order(ByteOrder.LITTLE_ENDIAN)
            }
            offset += 8 + size + (size and 1)
        }
        error("No data chunk")
    }

    private fun resource(name: String): File =
        File(checkNotNull(javaClass.classLoader.getResource("wakeword/$name")).toURI())

    companion object {
        private const val TOLERANCE = 0.002f
        private lateinit var models: OnnxWakeWordModels

        @JvmStatic
        @BeforeClass
        fun loadModels() {
            val dir = File(System.getProperty("yumi.assetsDir"), WakeWordConfig.ASSET_DIR)
            models = OnnxWakeWordModels(
                File(dir, WakeWordConfig.MELSPECTROGRAM_FILE).readBytes(),
                File(dir, WakeWordConfig.EMBEDDING_FILE).readBytes(),
                File(dir, WakeWordConfig.Current.modelFile).readBytes(),
            )
        }

        @JvmStatic
        @AfterClass
        fun closeModels() = models.close()
    }
}
