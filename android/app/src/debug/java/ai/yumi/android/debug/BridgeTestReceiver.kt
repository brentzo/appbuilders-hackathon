package ai.yumi.android.debug

import ai.yumi.android.YumiApplication
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Base64

/**
 * Drives the bridge from a computer, for testing against the local relay stand-in without a camera:
 * - `adb shell am broadcast -a ai.yumi.android.debug.PAIR -p ai.yumi.android --es offer64 <base64 of the QR text>`
 * - `adb shell am broadcast -a ai.yumi.android.debug.GOAL -p ai.yumi.android --es text "export my deck"`, as if spoken
 * - `adb shell am broadcast -a ai.yumi.android.debug.UNPAIR -p ai.yumi.android`
 */
class BridgeTestReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val graph = (context.applicationContext as YumiApplication).graph
        when (intent.action) {
            "ai.yumi.android.debug.PAIR" -> intent.getStringExtra("offer64")?.let {
                graph.bridge.pair(String(Base64.decode(it, Base64.DEFAULT)))
            }
            "ai.yumi.android.debug.GOAL" -> intent.getStringExtra("text")?.let { graph.goals.onGoal(it) }
            "ai.yumi.android.debug.UNPAIR" -> graph.bridge.unpair()
        }
    }
}
