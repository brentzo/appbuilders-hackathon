package ai.yumi.android.ui.onboarding

import ai.yumi.android.R
import ai.yumi.android.system.SystemSettings
import ai.yumi.android.ui.cat.CatState
import ai.yumi.android.ui.cat.LocalCatRenderer
import ai.yumi.android.ui.components.isGranted
import ai.yumi.android.ui.components.rememberPermissionAsker
import android.Manifest
import android.os.Build
import ai.yumi.android.voice.wakeword.WakeWordConfig
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

private enum class Step(val title: Int, val body: Int) {
    Microphone(R.string.onboarding_mic_title, R.string.onboarding_mic_body),
    Notifications(R.string.onboarding_notifications_title, R.string.onboarding_notifications_body),
    Battery(R.string.onboarding_battery_title, R.string.onboarding_battery_body),
}

/**
 * First-run setup: microphone, notifications, and battery, one at a time.
 * Each step is one plain sentence, then "Allow" and "Not now". Steps already allowed are skipped.
 * Other permissions are asked only when a tool first needs them.
 */
@Composable
fun OnboardingScreen(
    alreadyAsked: Set<String>,
    onAsked: (String) -> Unit,
    onFinished: () -> Unit,
) {
    val context = LocalContext.current
    val steps = remember {
        buildList {
            if (!isGranted(context, Manifest.permission.RECORD_AUDIO)) add(Step.Microphone)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                !isGranted(context, Manifest.permission.POST_NOTIFICATIONS)
            ) {
                add(Step.Notifications)
            }
            if (!SystemSettings.isIgnoringBatteryOptimizations(context)) add(Step.Battery)
        }
    }
    var index by rememberSaveable { mutableIntStateOf(0) }
    if (index >= steps.size) {
        LaunchedEffect(Unit) { onFinished() }
        return
    }
    val next: () -> Unit = { index++ }

    val askMic = rememberPermissionAsker(Manifest.permission.RECORD_AUDIO, alreadyAsked, onAsked) { next() }
    val askNotifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        rememberPermissionAsker(Manifest.permission.POST_NOTIFICATIONS, alreadyAsked, onAsked) { next() }
    } else {
        next
    }
    val battery = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { next() }

    val step = steps[index]
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(horizontal = 32.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (steps.size > 1) {
                Text(
                    stringResource(R.string.onboarding_step, index + 1, steps.size),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.weight(1f))
            LocalCatRenderer.current.Cat(
                if (step == Step.Microphone) CatState.Listening else CatState.Idle,
                Modifier.size(168.dp),
            )
            Spacer(Modifier.height(40.dp))
            AnimatedContent(targetState = step, label = "step") { shown ->
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        stringResource(shown.title),
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.onBackground,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        // The microphone step names the wake word, which differs while it is a stand-in.
                        if (shown == Step.Microphone) {
                            stringResource(shown.body, WakeWordConfig.Current.phrase)
                        } else {
                            stringResource(shown.body)
                        },
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.widthIn(max = 360.dp),
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            Button(
                onClick = {
                    when (step) {
                        Step.Microphone -> askMic()
                        Step.Notifications -> askNotifications()
                        Step.Battery -> battery.launch(SystemSettings.ignoreBatteryOptimizationsIntent(context))
                    }
                },
                modifier = Modifier.fillMaxWidth().widthIn(max = 360.dp).height(52.dp),
            ) {
                Text(stringResource(R.string.onboarding_allow), style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = next, modifier = Modifier.fillMaxWidth().widthIn(max = 360.dp).height(52.dp)) {
                Text(stringResource(R.string.onboarding_not_now), style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}
