package ai.yumi.android.routing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The fixed SPEC-10 requirement 8 templates and reply lists (OBJ-67.2, OBJ-67.3, OBJ-67.5). */
class RepeatBackTest {

    @Test
    fun `the templates match SPEC-10 requirement 8`() {
        assertEquals("You want an alarm at 6:30 am tomorrow. Should I set it?", RepeatBack.alarm("6:30 am tomorrow"))
        assertEquals("You want a 10-minute timer. Should I start it?", RepeatBack.timer("10-minute"))
        assertEquals("You want me to open Spotify. Should I open it?", RepeatBack.openApp("Spotify"))
        assertEquals(
            "You said: \"export my Keynote deck as a PDF\". Should I send it to your Mac?",
            RepeatBack.delegated("export my Keynote deck as a PDF"),
        )
    }

    @Test
    fun `the confirm and cancel reply lists are exactly the spec lists`() {
        assertEquals(listOf("yes", "go ahead", "do it", "send it", "okay"), Replies.confirm)
        assertEquals(listOf("no", "cancel", "never mind", "stop"), Replies.cancel)
    }

    @Test
    fun `replies are matched whatever their case or trailing punctuation`() {
        for (said in listOf("Yes", "Go ahead.", "DO IT", "send it!", "okay", "  Yes  ")) {
            assertEquals(said, Reply.Confirm, Replies.of(said))
        }
        for (said in listOf("No", "Cancel.", "Never mind", "STOP!", "never mind.")) {
            assertEquals(said, Reply.Cancel, Replies.of(said))
        }
    }

    @Test
    fun `anything else is not a yes or a no`() {
        assertNull(Replies.of("actually export it as images"))
        assertNull(Replies.of("yes please"))
        assertNull(Replies.of(""))
    }
}
