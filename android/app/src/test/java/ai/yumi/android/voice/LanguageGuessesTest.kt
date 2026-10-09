package ai.yumi.android.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The guess sequences are copied from Brent's session on the demo phone (2026-10-09, 11:39 to 11:46 pm). */
class LanguageGuessesTest {

    private fun guesses(vararg pairs: Pair<String, Int>) = LanguageGuesses().apply { pairs.forEach { (tag, c) -> add(tag, c) } }

    @Test
    fun englishGoalWithProductNamesIsEnglish() {
        // "export my Keynote deck as a PDF", session 57: ends on fil-ph, highly confident, after a confident en-us.
        val session = guesses(
            "id-id" to 1, "nl-nl" to 1, "en-us" to 1, "en-us" to 2, "fil-ph" to 2, "en-us" to 2, "fil-ph" to 2,
            "fil-ph" to 3,
        )
        assertNull(session.otherLanguageDespiteTranscript())
        assertNull(session.otherLanguageWithoutTranscript())
    }

    @Test
    fun shortEnglishGoalWithOnlyAnUnsureEnglishGuessIsEnglish() {
        // "open the camera" after the wake word, session 79: en-us only reached "not confident", and a transcript came.
        val session = guesses("cmn-hans-cn" to 1, "en-us" to 1, "pt-br" to 2, "fil-ph" to 2)
        assertNull(session.otherLanguageDespiteTranscript())
    }

    @Test
    fun tagalogWithNoMatchGetsTheLanguageMessage() {
        // "pakigising yung Mac ko", session 65: en-us never confident, then no match.
        val session = guesses(
            "cmn-hans-cn" to 1, "en-us" to 1, "th-th" to 1, "en-us" to 1, "fil-ph" to 1, "fil-ph" to 2, "fil-ph" to 3,
            "fil-ph" to 2, "fil-ph" to 3,
        )
        assertEquals("fil-ph", session.otherLanguageWithoutTranscript())
    }

    @Test
    fun tagalogHeardAsMandarinStillGetsTheLanguageMessage() {
        // Session 63: no English guess at all.
        val session = guesses("cmn-hans-cn" to 1, "id-id" to 2, "cmn-hans-cn" to 2, "fil-ph" to 1)
        assertEquals("cmn-hans-cn", session.otherLanguageWithoutTranscript())
    }

    @Test
    fun aTranscriptWithNoEnglishGuessAtAllIsAnotherLanguage() {
        val session = guesses("fil-ph" to 3)
        assertEquals("fil-ph", session.otherLanguageDespiteTranscript())
    }

    @Test
    fun noGuessesMeansNoLanguageProblem() {
        assertNull(LanguageGuesses().otherLanguageDespiteTranscript())
        assertNull(LanguageGuesses().otherLanguageWithoutTranscript())
    }
}
