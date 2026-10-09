package ai.yumi.android.errors

import android.util.Log

/** One button as the user sees it. [action] says what it does; [label] is what is shown and what can be said. */
data class PresentedButton(val action: ErrorButton, val label: String)

/** An error ready for the screen and for speech. Never contains raw technical text. */
data class PresentedError(
    val kind: ErrorKind,
    /** Full text shown on screen. */
    val text: String,
    /** What Yumi speaks: the first sentence only (SPEC-11 requirement 11). */
    val spoken: String,
    val buttons: List<PresentedButton>,
)

/** Where technical detail goes instead of the screen (SPEC-11 requirement 2). */
fun interface ErrorLog {
    fun record(kind: ErrorKind, error: Throwable?)
}

object AndroidErrorLog : ErrorLog {
    private const val TAG = "YumiError"

    override fun record(kind: ErrorKind, error: Throwable?) {
        Log.w(TAG, "Showing ${kind.name} to the user", error)
    }
}

/**
 * Turns structured error kinds into the SPEC-11 copy and buttons. The only place UI error text comes from.
 *
 * @param otherDevice the other device from the user's point of view. On the phone it is always "your Mac".
 */
class ErrorPresenter(
    private val log: ErrorLog = AndroidErrorLog,
    private val otherDevice: String = "your Mac",
) {

    /**
     * Presents any thrown error. Only [YumiException] carries a known kind; everything else is
     * [ErrorKind.Unexpected]. The kind is read from the type, never from the message (SPEC-11 requirement 5).
     */
    fun present(error: Throwable, lastAction: String? = null): PresentedError {
        val kind = (error as? YumiException)?.kind ?: ErrorKind.Unexpected
        log.record(kind, error)
        return build(kind, lastAction, alternatives = emptyList())
    }

    /**
     * Presents a known kind.
     *
     * @param lastAction fills `{last action}` in the Unexpected copy.
     * @param alternatives the request-specific buttons for Unsupported request.
     * @param permission fills `{permission}` with a plain name, such as "location".
     */
    fun present(
        kind: ErrorKind,
        lastAction: String? = null,
        alternatives: List<String> = emptyList(),
        permission: String? = null,
    ): PresentedError {
        log.record(kind, null)
        return build(kind, lastAction, alternatives, permission)
    }

    /** The button whose label the user said, if any (SPEC-11 requirement 9). */
    fun buttonForSpeech(error: PresentedError, utterance: String): PresentedButton? {
        val said = normalize(utterance)
        return error.buttons.firstOrNull { normalize(it.label) == said }
    }

    private fun build(
        kind: ErrorKind,
        lastAction: String?,
        alternatives: List<String>,
        permission: String? = null,
    ): PresentedError {
        val copy = ErrorCopyTable.of(kind)
        val text = fill(copy.text, lastAction, permission)
        val nothingDoneYet = copy.text.contains(LAST_ACTION) && lastAction.isNullOrBlank()
        val buttons = copy.buttons.flatMap { button ->
            if (button == ErrorButton.ShowWhatIDid && nothingDoneYet) {
                // There is nothing to show yet (SPEC-11, "Unexpected" notes).
                emptyList()
            } else if (button == ErrorButton.Alternatives) {
                alternatives.map { PresentedButton(ErrorButton.Alternatives, it) }
            } else {
                listOf(PresentedButton(button, button.label))
            }
        }
        return PresentedError(kind, text, firstSentence(text), buttons)
    }

    private fun fill(template: String, lastAction: String?, permission: String?): String {
        val withDevice = SENTENCE_START_DEVICE.replace(template) { match ->
            match.groupValues[1] + otherDevice.replaceFirstChar { it.uppercase() }
        }.replace(DEVICE, otherDevice)
            .replace(PERMISSION, permission ?: GENERIC_PERMISSION)
        if (!withDevice.contains(LAST_ACTION)) return withDevice
        val action = lastAction?.trim()?.trimEnd('.')
        return if (action.isNullOrEmpty()) {
            // Nothing has run yet, so there is no last action to name. Drop that sentence rather than show a blank.
            withDevice.substringBefore(LAST_ACTION_SENTENCE).trimEnd()
        } else {
            withDevice.replace(LAST_ACTION, action)
        }
    }

    private fun firstSentence(text: String): String {
        val end = SENTENCE_END.find(text) ?: return text
        return text.substring(0, end.range.first + 1)
    }

    private fun normalize(text: String): String =
        text.lowercase().replace('’', '\'').replace(PUNCTUATION, "").trim().replace(WHITESPACE, " ")

    private companion object {
        const val DEVICE = "{device}"
        const val LAST_ACTION = "{last action}"
        const val PERMISSION = "{permission}"

        /** Only if a caller forgets the name: still a full sentence, never a raw placeholder. */
        const val GENERIC_PERMISSION = "phone's features"
        const val LAST_ACTION_SENTENCE = "Here's the last thing I did:"
        val SENTENCE_START_DEVICE = Regex("""(^|[.!?]\s+)\{device\}""")
        val SENTENCE_END = Regex("""[.!?](\s|$)""")
        val PUNCTUATION = Regex("""[.,!?]""")
        val WHITESPACE = Regex("""\s+""")
    }
}
