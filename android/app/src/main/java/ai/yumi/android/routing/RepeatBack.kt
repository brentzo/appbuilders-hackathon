package ai.yumi.android.routing

/**
 * The fixed repeat-back templates of SPEC-10 requirement 8, word for word.
 * The phone says and shows one of these before anything runs or is sent to the Mac.
 *
 * The demo delegates every goal, so only [delegated] is used at runtime. The phone-only templates are
 * ready for the p0 rule (OBJ-67.1) and are kept here beside it so the spec's wording lives in one place.
 */
object RepeatBack {
    /** "You want an alarm at 6:30 am tomorrow. Should I set it?" */
    fun alarm(time: String) = "You want an alarm at $time. Should I set it?"

    /** "You want a 10-minute timer. Should I start it?" */
    fun timer(duration: String) = "You want a $duration timer. Should I start it?"

    /** "You want me to open Spotify. Should I open it?" */
    fun openApp(app: String) = "You want me to open $app. Should I open it?"

    /** "You said: "export my Keynote deck as a PDF". Should I send it to your Mac?" */
    fun delegated(transcript: String) = "You said: \"$transcript\". Should I send it to your Mac?"
}

/** What a spoken reply means when the phone is waiting for a yes or a no (SPEC-10 requirement 8). */
enum class Reply { Confirm, Cancel }

/** The short fixed reply lists of SPEC-10 requirement 8. Anything else is a corrected goal. */
object Replies {
    /** "Yes", "go ahead", "do it", "send it", and "okay" confirm. */
    val confirm = listOf("yes", "go ahead", "do it", "send it", "okay")

    /** "No", "cancel", "never mind", and "stop" cancel. */
    val cancel = listOf("no", "cancel", "never mind", "stop")

    /** Null when the reply is not a yes or a no, so the phone repeats it back as a corrected goal. */
    fun of(utterance: String): Reply? = when (val said = normalize(utterance)) {
        in confirm -> Reply.Confirm
        in cancel -> Reply.Cancel
        else -> null
    }

    private fun normalize(text: String): String =
        text.lowercase().replace('’', '\'').replace(WHITESPACE, " ").trim().trimEnd('.', ',', '!', '?').trim()

    private val WHITESPACE = Regex("\\s+")
}
