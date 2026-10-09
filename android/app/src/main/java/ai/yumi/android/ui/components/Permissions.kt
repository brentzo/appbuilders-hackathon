package ai.yumi.android.ui.components

import ai.yumi.android.system.SystemSettings
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

fun isGranted(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

/**
 * Returns a function that asks for [permission] and reports the answer to [onResult].
 *
 * Android stops showing its dialog after the user says no twice. In that case this opens Yumi's app settings
 * instead and reports the answer when the user comes back, so "Allow" always leads somewhere.
 */
@Composable
fun rememberPermissionAsker(
    permission: String,
    alreadyAsked: Set<String>,
    onAsked: (String) -> Unit,
    onResult: (Boolean) -> Unit,
): () -> Unit {
    val activity = LocalActivity.current ?: return {}
    val asked by rememberUpdatedState(alreadyAsked)
    val result by rememberUpdatedState(onResult)
    val waitingOnSettings = remember { BooleanRef() }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { result(it) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && waitingOnSettings.value) {
                waitingOnSettings.value = false
                result(isGranted(activity, permission))
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    return {
        val deniedForGood = permission in asked && !activity.shouldShowRequestPermissionRationale(permission)
        when {
            isGranted(activity, permission) -> result(true)
            deniedForGood -> {
                waitingOnSettings.value = true
                activity.startActivity(SystemSettings.appDetailsIntent(activity))
            }
            else -> {
                onAsked(permission)
                launcher.launch(permission)
            }
        }
    }
}

private class BooleanRef(var value: Boolean = false)

/** A counter that goes up every time the screen resumes, to re-read permission and battery state. */
@Composable
fun rememberResumeCount(): Int {
    val lifecycleOwner = LocalLifecycleOwner.current
    val count = remember { mutableIntStateOf(0) }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) count.intValue++
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    return count.intValue
}
