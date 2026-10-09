package ai.yumi.android

import ai.yumi.android.permissions.ToolPermission
import ai.yumi.android.ui.YumiApp
import ai.yumi.android.ui.theme.YumiTheme
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

class MainActivity : ComponentActivity() {

    private val graph get() = (application as YumiApplication).graph

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleIntent(intent)
        setContent {
            YumiTheme {
                YumiApp(graph)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.action != ACTION_PERMISSION_REQUEST) return
        val name = intent.getStringExtra(EXTRA_PERMISSION) ?: return
        val permission = ToolPermission.entries.firstOrNull { it.name == name } ?: return
        graph.permissions.onOpenedFromNotification(permission)
    }

    companion object {
        const val ACTION_PERMISSION_REQUEST = "ai.yumi.android.action.PERMISSION_REQUEST"
        const val EXTRA_PERMISSION = "permission"
    }
}
