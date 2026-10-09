package ai.yumi.android.system

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.net.toUri

object SystemSettings {

    fun isIgnoringBatteryOptimizations(context: Context): Boolean =
        context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)

    /** Android's "Let Yumi always run in the background?" prompt. Allowed because Yumi is sideloaded (SPEC-10). */
    @SuppressLint("BatteryLife")
    fun ignoreBatteryOptimizationsIntent(context: Context): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${context.packageName}".toUri())

    /**
     * Android's speech settings, where the recognizer and its offline language packs live (SPEC-11, "Speech
     * recognition not set up on this phone"). Android has no public screen for the on-device pack itself, so this
     * opens the voice input settings, or Settings itself on a phone without them.
     */
    fun openSpeechSettings(context: Context) {
        try {
            context.startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Log.w("Yumi", "No voice input settings screen, opening Settings", e)
            context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    /** Yumi's own page in Android settings: permissions, battery, and phone-maker options. */
    fun appDetailsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${context.packageName}".toUri())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
