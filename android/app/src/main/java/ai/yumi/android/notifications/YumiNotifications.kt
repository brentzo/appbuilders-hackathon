package ai.yumi.android.notifications

import ai.yumi.android.MainActivity
import ai.yumi.android.R
import ai.yumi.android.permissions.ToolPermission
import ai.yumi.android.protocol.ConnectionState
import ai.yumi.android.service.YumiService
import ai.yumi.android.service.YumiStatus
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import ai.yumi.android.voice.wakeword.WakeWordConfig
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object YumiNotifications {
    private const val TAG = "YumiNotifications"
    private const val CHANNEL_RUNNING = "yumi_running"
    private const val CHANNEL_REQUESTS = "yumi_requests"

    const val ID_SERVICE = 1
    private const val ID_PERMISSION_BASE = 100

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(
                    CHANNEL_RUNNING,
                    context.getString(R.string.channel_running_name),
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = context.getString(R.string.channel_running_description, WakeWordConfig.Current.phrase)
                    setShowBadge(false)
                },
                NotificationChannel(
                    CHANNEL_REQUESTS,
                    context.getString(R.string.channel_requests_name),
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = context.getString(R.string.channel_requests_description)
                },
            ),
        )
    }

    /** The persistent notification of the foreground service: Yumi's state and a Stop button. */
    fun service(context: Context, status: YumiStatus): Notification {
        val title = when {
            status.voiceListening -> context.getString(R.string.notification_title_hearing)
            status.wakeWordListening -> context.getString(R.string.notification_title_listening, WakeWordConfig.Current.phrase)
            else -> context.getString(R.string.notification_title_running)
        }
        val stop = PendingIntent.getService(
            context,
            0,
            Intent(context, YumiService::class.java).setAction(YumiService.ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(context, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_cat)
            .setColor(ContextCompat.getColor(context, R.color.yumi_notification_accent))
            .setContentTitle(title)
            .setContentText(context.getString(connectionTextRes(status.connection)))
            .setContentIntent(openApp(context, requestCode = 0, intent = Intent(context, MainActivity::class.java)))
            .addAction(R.drawable.ic_stop, context.getString(R.string.notification_action_stop), stop)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    fun updateService(context: Context, status: YumiStatus) = post(context, ID_SERVICE, service(context, status))

    fun cancelService(context: Context) = NotificationManagerCompat.from(context).cancel(ID_SERVICE)

    /**
     * Asks for a permission while the app is in the background, where Android cannot show the dialog.
     * Tapping it opens the app, which shows the Android permission dialog.
     */
    fun postPermissionRequest(context: Context, permission: ToolPermission, text: String) {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(MainActivity.ACTION_PERMISSION_REQUEST)
            .putExtra(MainActivity.EXTRA_PERMISSION, permission.name)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val notification = NotificationCompat.Builder(context, CHANNEL_REQUESTS)
            .setSmallIcon(R.drawable.ic_cat)
            .setColor(ContextCompat.getColor(context, R.color.yumi_notification_accent))
            .setContentTitle(context.getString(R.string.notification_permission_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openApp(context, requestCode = ID_PERMISSION_BASE + permission.ordinal, intent = intent))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        post(context, ID_PERMISSION_BASE + permission.ordinal, notification)
    }

    fun cancelPermissionRequest(context: Context, permission: ToolPermission) {
        NotificationManagerCompat.from(context).cancel(ID_PERMISSION_BASE + permission.ordinal)
    }

    private fun openApp(context: Context, requestCode: Int, intent: Intent): PendingIntent =
        PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    // areNotificationsEnabled covers both the Android 13+ runtime permission and the per-app switch on Android 12.
    @SuppressLint("MissingPermission")
    private fun post(context: Context, id: Int, notification: Notification) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) {
            Log.i(TAG, "Notifications are not allowed, so notification $id was not shown")
            return
        }
        manager.notify(id, notification)
    }
}

/** Shared by the home screen and the notification. */
fun connectionTextRes(state: ConnectionState): Int = when (state) {
    ConnectionState.NotPaired -> R.string.connection_not_paired
    ConnectionState.Connected -> R.string.connection_connected
    ConnectionState.Reconnecting -> R.string.connection_reconnecting
    ConnectionState.Offline -> R.string.connection_offline
}
