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
import ai.yumi.android.design.YumiMotion
import ai.yumi.android.design.YumiSpace
import ai.yumi.android.ui.components.YumiButton
import ai.yumi.android.ui.components.YumiCard
import ai.yumi.android.ui.theme.Yumi
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
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
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.sp

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
    val colors = Yumi.colors
    Column(
        Modifier
            .fillMaxSize()
            .background(colors.paper)
            .safeDrawingPadding()
            .padding(horizontal = YumiSpace.xl, vertical = YumiSpace.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (steps.size > 1) {
            Text(
                stringResource(R.string.onboarding_step, index + 1, steps.size),
                style = MaterialTheme.typography.bodySmall,
                color = colors.muted,
            )
        }
        Spacer(Modifier.weight(1f))
        LocalCatRenderer.current.Cat(
            if (step == Step.Microphone) CatState.Listening else CatState.Idle,
            Modifier.size(200.dp),
        )
        Spacer(Modifier.height(YumiSpace.xl))
        YumiCard(Modifier.widthIn(max = 400.dp)) {
            AnimatedContent(
                targetState = step,
                transitionSpec = {
                    fadeIn(tween(YumiMotion.PANEL_MS, easing = YumiMotion.easing)) togetherWith
                        fadeOut(tween(YumiMotion.AVOID_FADE_MS))
                },
                label = "step",
            ) { shown ->
                Column(
                    Modifier.fillMaxWidth().padding(YumiSpace.s),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(YumiSpace.s),
                ) {
                    Text(
                        stringResource(shown.title),
                        style = MaterialTheme.typography.titleLarge,
                        color = colors.brand,
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
                        color = colors.muted,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        YumiButton(
            onClick = {
                when (step) {
                    Step.Microphone -> askMic()
                    Step.Notifications -> askNotifications()
                    Step.Battery -> battery.launch(SystemSettings.ignoreBatteryOptimizationsIntent(context))
                }
            },
            large = true,
            modifier = Modifier.fillMaxWidth().widthIn(max = 400.dp),
        ) {
            Text(stringResource(R.string.onboarding_allow), style = MaterialTheme.typography.labelLarge.copy(fontSize = 15.sp))
        }
        Spacer(Modifier.height(YumiSpace.s))
        TextButton(
            onClick = next,
            modifier = Modifier.fillMaxWidth().widthIn(max = 400.dp).height(52.dp),
            colors = ButtonDefaults.textButtonColors(contentColor = colors.muted),
        ) {
            Text(stringResource(R.string.onboarding_not_now), style = MaterialTheme.typography.labelLarge.copy(fontSize = 15.sp))
        }
    }
}
