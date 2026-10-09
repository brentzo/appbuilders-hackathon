package ai.yumi.android.service

import android.app.ForegroundServiceStartNotAllowedException
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/** Starts and stops [YumiService]. Call [start] only while the app is in the foreground. */
object YumiServiceController {
    private const val TAG = "YumiService"

    /** Starts the service, or asks a running one to re-check its settings and permissions. */
    fun start(context: Context): Boolean = try {
        ContextCompat.startForegroundService(context, Intent(context, YumiService::class.java))
        true
    } catch (e: ForegroundServiceStartNotAllowedException) {
        Log.w(TAG, "Android did not allow starting the service right now", e)
        false
    }

    fun stop(context: Context) {
        context.stopService(Intent(context, YumiService::class.java))
    }
}
