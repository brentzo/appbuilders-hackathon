package ai.yumi.android.service

import ai.yumi.android.YumiApplication
import ai.yumi.android.notifications.YumiNotifications
import android.Manifest
import android.app.ForegroundServiceStartNotAllowedException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Keeps Yumi alive in the background with a persistent notification (SPEC-10 requirement 4).
 *
 * Service types:
 * - `specialUse` always, for the bridge connection. Not `dataSync`, which Android 15 limits to 6 hours a day.
 *   Not `connectedDevice`, which is for nearby hardware and needs Bluetooth, USB, or network-change permissions.
 * - `microphone` only while the wake word is on and the microphone permission is granted (SPEC-01 requirement 12).
 *   Android only lets the app add it while the app is in the foreground, so a failure falls back to `specialUse` alone.
 *
 * Seams: [BridgeConnection] (OBJ-23) and [WakeWordDetector] (OBJ-24) come from the app graph and run here.
 */
class YumiService : LifecycleService() {

    private val graph get() = (application as YumiApplication).graph
    private var started = false
    private var holdsMicrophone = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (intent?.action == ACTION_STOP) {
            stopFromUser()
            return START_NOT_STICKY
        }
        if (!enterForeground(withMicrophone = holdsMicrophone)) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!started) {
            started = true
            onFirstStart()
        } else {
            // A second start comes from the app in the foreground, for example after the microphone was allowed.
            graph.settings.settings.value?.let { updateWakeWord(it.wakeWordEnabled) }
        }
        return START_STICKY
    }

    private fun onFirstStart() {
        graph.serviceRunning.value = true
        graph.bridge.start(lifecycleScope)
        lifecycleScope.launch {
            graph.settings.settings.filterNotNull()
                .map { it.wakeWordEnabled }
                .distinctUntilChanged()
                .collect { updateWakeWord(it) }
        }
        lifecycleScope.launch {
            graph.status.collect { YumiNotifications.updateService(this@YumiService, it) }
        }
    }

    private fun updateWakeWord(enabled: Boolean) {
        val micAllowed = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        val wantMicrophone = enabled && micAllowed
        if (wantMicrophone != holdsMicrophone) {
            if (enterForeground(withMicrophone = wantMicrophone)) {
                holdsMicrophone = wantMicrophone
            } else if (wantMicrophone) {
                enterForeground(withMicrophone = false)
            }
        }
        if (holdsMicrophone) graph.wakeWord.start(lifecycleScope) else graph.wakeWord.stop()
    }

    private fun enterForeground(withMicrophone: Boolean): Boolean {
        // specialUse exists from Android 14. Android 12 and 13 need no type for the connection, only for the microphone.
        var types = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE
        }
        if (withMicrophone) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        return try {
            ServiceCompat.startForeground(
                this,
                YumiNotifications.ID_SERVICE,
                YumiNotifications.service(this, graph.status.value),
                types,
            )
            true
        } catch (e: ForegroundServiceStartNotAllowedException) {
            Log.w(TAG, "Android did not allow the foreground service (microphone=$withMicrophone)", e)
            false
        } catch (e: SecurityException) {
            Log.w(TAG, "Missing permission for the foreground service (microphone=$withMicrophone)", e)
            false
        }
    }

    private fun stopFromUser() {
        Log.i(TAG, "Stopped from the notification")
        graph.appScope.launch { graph.settings.setRunInBackground(false) }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        graph.wakeWord.stop()
        graph.bridge.stop()
        graph.serviceRunning.value = false
        super.onDestroy()
    }

    companion object {
        private const val TAG = "YumiService"
        const val ACTION_STOP = "ai.yumi.android.action.STOP"
    }
}
