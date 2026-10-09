package ai.yumi.android.permissions

import ai.yumi.android.errors.ErrorPresenter
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PermissionCoordinatorTest {

    private class FakeEnvironment(var granted: Boolean = false, var foreground: Boolean = false) : PermissionEnvironment {
        val posted = mutableListOf<Pair<ToolPermission, String>>()
        val cancelled = mutableListOf<ToolPermission>()
        override fun isGranted(permission: ToolPermission) = granted
        override fun isAppInForeground() = foreground
        override fun postBackgroundRequest(permission: ToolPermission, text: String) {
            posted += permission to text
        }
        override fun cancelBackgroundRequest(permission: ToolPermission) {
            cancelled += permission
        }
    }

    private val environment = FakeEnvironment()
    private val coordinator = PermissionCoordinator(environment, ErrorPresenter(log = { _, _ -> }))

    /** SPEC-10 scenario "Permission asked from the background", up to the Android dialog. */
    @Test
    fun permissionAskedFromTheBackground() = runTest {
        environment.foreground = false

        val result = async { coordinator.ensure(ToolPermission.Location) }
        runCurrent()

        // The phone posts a notification explaining why.
        assertEquals(listOf(ToolPermission.Location to "I need permission to use your location for this."), environment.posted)
        val request = coordinator.request.value!!
        assertTrue(request.postedAsNotification)
        assertFalse(request.openedFromNotification)

        // Tapping it opens the app, which goes straight to the Android dialog.
        coordinator.onOpenedFromNotification(ToolPermission.Location)
        assertTrue(coordinator.request.value!!.openedFromNotification)

        environment.granted = true
        coordinator.onAnswered(true)

        assertTrue(result.await())
        assertNull(coordinator.request.value)
        assertEquals(listOf(ToolPermission.Location), environment.cancelled)
    }

    @Test
    fun foregroundRequestShowsInAppWithoutNotification() = runTest {
        environment.foreground = true

        val result = async { coordinator.ensure(ToolPermission.Location) }
        runCurrent()

        assertTrue(environment.posted.isEmpty())
        val request = coordinator.request.value!!
        assertFalse(request.postedAsNotification)
        assertEquals(listOf("Allow", "Not now"), request.error.buttons.map { it.label })

        coordinator.onAnswered(false)

        assertFalse(result.await())
        assertNull(coordinator.request.value)
    }

    @Test
    fun alreadyGrantedAsksNothing() = runTest {
        environment.granted = true

        assertTrue(coordinator.ensure(ToolPermission.Location))
        assertNull(coordinator.request.value)
        assertTrue(environment.posted.isEmpty())
    }

    @Test
    fun cancelledRequestCleansUp() = runTest {
        val result = async { coordinator.ensure(ToolPermission.Location) }
        runCurrent()
        result.cancel()
        runCurrent()

        assertNull(coordinator.request.value)
        assertEquals(listOf(ToolPermission.Location), environment.cancelled)
    }
}
