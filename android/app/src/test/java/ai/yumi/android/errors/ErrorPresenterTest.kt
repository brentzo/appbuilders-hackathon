package ai.yumi.android.errors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.net.SocketException

class ErrorPresenterTest {

    private val logged = mutableListOf<Pair<ErrorKind, Throwable?>>()
    private val presenter = ErrorPresenter(log = { kind, error -> logged += kind to error })

    @Test
    fun rawErrorNeverReachesTheUser() {
        // The same type OkHttp throws when a connection is reset. It carries no Yumi kind, so it is Unexpected.
        val raw = SocketException("ECONNRESET: Connection reset by peer")

        val shown = presenter.present(raw, lastAction = "Opened Spotify")

        assertEquals(ErrorKind.Unexpected, shown.kind)
        val everything = shown.text + shown.spoken + shown.buttons.joinToString { it.label }
        assertFalse(everything.contains("ECONNRESET"))
        assertFalse(everything.contains("Connection reset"))
        assertSame(raw, logged.single().second)
    }

    @Test
    fun knownKindIsReadFromTheTypeNotTheMessage() {
        val error = YumiException(ErrorKind.BridgeDown, message = "socket closed with code 1006")

        val shown = presenter.present(error)

        assertEquals(ErrorKind.BridgeDown, shown.kind)
        assertEquals(
            "I can't connect your phone and Mac right now because the connection between them is down. " +
                "Things on this device still work.",
            shown.text,
        )
        assertEquals(listOf("Try again", "Work on this device only"), shown.buttons.map { it.label })
        assertSame(error, logged.single().second)
    }

    @Test
    fun copyNamesTheOtherDevice() {
        val shown = presenter.present(ErrorKind.OtherDeviceOffline)

        assertEquals(
            "I can't reach your Mac right now. It might be asleep or off the internet. I can run this as soon as it's back.",
            shown.text,
        )
    }

    @Test
    fun deviceAtTheStartOfASentenceIsCapitalized() {
        assertEquals(
            "Your Mac is busy with another task. I'll start this right after.",
            presenter.present(ErrorKind.OtherDeviceBusy).text,
        )
        assertEquals(
            "I can't reach your Mac to pause it. Use the stop shortcut on your Mac.",
            presenter.present(ErrorKind.CantPauseOtherDevice).text,
        )
    }

    @Test
    fun unexpectedErrorUsesGenericCopyWithTheLastAction() {
        val shown = presenter.present(IllegalStateException("boom"), lastAction = "Clicked Export in Keynote")

        assertEquals(
            "Something went wrong and I stopped to be safe. Here's the last thing I did: Clicked Export in Keynote.",
            shown.text,
        )
        assertEquals(listOf("Show what I did", "Try again", "Stop"), shown.buttons.map { it.label })
    }

    @Test
    fun unexpectedErrorWithNoLastActionDropsThatSentence() {
        val shown = presenter.present(IllegalStateException("boom"))

        assertEquals("Something went wrong and I stopped to be safe.", shown.text)
    }

    @Test
    fun spokenTextIsTheFirstSentence() {
        val shown = presenter.present(ErrorKind.LanguageNotSupported)

        assertEquals("I can only understand English on this phone for now.", shown.spoken)
    }

    @Test
    fun alternativesBecomeButtons() {
        val shown = presenter.present(ErrorKind.UnsupportedRequest, alternatives = listOf("Set a timer", "Open Clock"))

        assertEquals(listOf("Set a timer", "Open Clock", "Cancel"), shown.buttons.map { it.label })
    }

    @Test
    fun buttonsWorkByVoice() {
        val shown = presenter.present(ErrorKind.OtherDeviceOffline)

        assertEquals(ErrorButton.Cancel, presenter.buttonForSpeech(shown, "cancel")?.action)
        assertEquals(ErrorButton.RunWhenBack, presenter.buttonForSpeech(shown, "Run it when it’s back.")?.action)
        assertNull(presenter.buttonForSpeech(shown, "maybe later"))
    }
}
