package ai.yumi.android.permissions

import ai.yumi.android.notifications.YumiNotifications
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner

class AndroidPermissionEnvironment(context: Context) : PermissionEnvironment {
    private val context = context.applicationContext

    override fun isGranted(permission: ToolPermission): Boolean =
        ContextCompat.checkSelfPermission(context, permission.manifestPermission) == PackageManager.PERMISSION_GRANTED

    override fun isAppInForeground(): Boolean =
        ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    override fun postBackgroundRequest(permission: ToolPermission, text: String) =
        YumiNotifications.postPermissionRequest(context, permission, text)

    override fun cancelBackgroundRequest(permission: ToolPermission) =
        YumiNotifications.cancelPermissionRequest(context, permission)
}
