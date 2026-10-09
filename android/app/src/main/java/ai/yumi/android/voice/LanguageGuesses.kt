package ai.yumi.android.voice

import android.annotation.SuppressLint
import android.speech.SpeechRecognizer
import java.util.Locale

/**
 * The recognizer's guesses at the spoken language during one session, and what they mean for an English-only phone.
 *
 * The guesses swing a lot. On the demo phone, Brent's English goal "export my Keynote deck as a PDF" went back and
 * forth between "en-us" and "fil-ph", both up to highly confident, and ended on "fil-ph". Real Tagalog never got a
 * confident "en-us" guess, and the English-only recognizer found no match for it. So the whole session counts, not
 * the last guess, and a transcript outweighs the guesses.
 */
class LanguageGuesses {
    private var englishHeard = false
    private var englishConfident = false

    /** The most confident non-English guess, for the log. */
    private var otherConfident: String? = null

    fun add(tag: String, confidence: Int) {
        if (isEnglish(tag)) {
            if (confidence >= NOT_CONFIDENT) englishHeard = true
            if (isConfident(confidence)) englishConfident = true
        } else if (isConfident(confidence)) {
            otherConfident = tag
        }
    }

    /**
     * The other language heard when the recognizer did give a transcript, or null if the transcript is the goal.
     * Only when English was never even guessed: names and acronyms in English goals often draw other guesses.
     */
    fun otherLanguageDespiteTranscript(): String? = otherConfident?.takeIf { !englishHeard }

    /** The other language heard when the recognizer found no match, or null if it is "Didn't catch speech". */
    fun otherLanguageWithoutTranscript(): String? = otherConfident?.takeIf { !englishConfident }

    companion object {
        @SuppressLint("InlinedApi") // Language detection results only arrive on Android 14 and later.
        private const val NOT_CONFIDENT = SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_NOT_CONFIDENT

        @SuppressLint("InlinedApi")
        fun isConfident(confidence: Int): Boolean =
            confidence >= SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_CONFIDENT

        fun isEnglish(tag: String): Boolean = Locale.forLanguageTag(tag).language.let { it.isEmpty() || it == "en" }
    }
}
