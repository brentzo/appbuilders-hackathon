package ai.yumi.android.debug

import ai.yumi.android.YumiApplication
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.launch

/**
 * Runs the test tool from adb, for the SPEC-10 scenario "Permission asked from the background":
 * `adb shell am broadcast -a ai.yumi.android.debug.RUN_TEST_TOOL -p ai.yumi.android`
 */
class TestToolReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val graph = (context.applicationContext as YumiApplication).graph
        graph.appScope.launch { graph.testTool.run() }
    }
}
