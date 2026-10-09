package ai.yumi.android.voice.wakeword

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoskSpotterTest {

    @Test
    fun `the grammar is the phrase plus the unknown-word catch-all`() {
        assertEquals("[\"hey yumi\", \"[unk]\"]", VoskSpotter.GRAMMAR)
    }

    @Test
    fun `a finished utterance with the phrase wakes Yumi`() {
        // The shapes Vosk returned for synthetic speech on the Mac (see wiki/android-hey-yumi-vosk.md).
        assertTrue(VoskSpotter.heardWakePhrase("{\n  \"text\" : \"hey yumi\"\n}"))
        assertTrue(VoskSpotter.heardWakePhrase("{\"text\" : \"hey yumi [unk]\"}"))
        assertTrue(VoskSpotter.heardWakePhrase("{\"text\" : \"[unk] hey yumi\"}"))
    }

    @Test
    fun `anything else does not`() {
        assertFalse(VoskSpotter.heardWakePhrase("{\"text\" : \"[unk]\"}"))
        assertFalse(VoskSpotter.heardWakePhrase("{\"text\" : \"hey [unk]\"}"))
        assertFalse(VoskSpotter.heardWakePhrase("{\"text\" : \"yumi hey\"}"))
        assertFalse(VoskSpotter.heardWakePhrase("{\"text\" : \"\"}"))
        assertFalse(VoskSpotter.heardWakePhrase("{\"partial\" : \"hey yumi\"}"))
        assertFalse(VoskSpotter.heardWakePhrase(""))
    }

    @Test
    fun `only finished utterances count, and reset and clear forget the one in progress`() {
        val recognizer = FakeRecognizer(listOf(null, null, "{\"text\" : \"[unk]\"}", null, "{\"text\" : \"hey yumi\"}"))
        val spotter = VoskSpotter(recognizer)
        val chunk = ShortArray(AudioFeatures.CHUNK_SAMPLES)

        assertEquals(listOf(false, false, false, false, true), List(5) { spotter.detect(chunk) })

        spotter.reset()
        spotter.clear()
        assertEquals(2, recognizer.resets)
    }

    private class FakeRecognizer(private val results: List<String?>) : VoskSpotter.PhraseRecognizer {
        private var next = 0
        var resets = 0

        override fun accept(chunk: ShortArray): String? = results[next++]

        override fun reset() {
            resets++
        }
    }
}
