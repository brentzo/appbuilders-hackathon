package ai.yumi.android.tools

import ai.yumi.android.permissions.PermissionCoordinator
import ai.yumi.android.permissions.ToolPermission
import android.util.Log
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration.Companion.minutes

/**
 * A tool that does nothing but need a permission, to check the SPEC-10 scenario "Permission asked from the background"
 * before the real phone tools exist. Debug builds only trigger it.
 */
class TestPermissionTool(private val permissions: PermissionCoordinator) {

    suspend fun run(): Boolean {
        Log.i(TAG, "Test tool started")
        val granted = withTimeoutOrNull(5.minutes) { permissions.ensure(ToolPermission.Location) } ?: false
        Log.i(TAG, "Test tool finished, permission granted=$granted")
        return granted
    }

    private companion object {
        const val TAG = "YumiTestTool"
    }
}
