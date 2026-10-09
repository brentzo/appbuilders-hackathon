package ai.yumi.android.ui

import ai.yumi.android.AppGraph
import ai.yumi.android.BuildConfig
import ai.yumi.android.R
import ai.yumi.android.errors.ErrorButton
import ai.yumi.android.errors.ErrorKind
import ai.yumi.android.errors.PresentedError
import ai.yumi.android.permissions.PermissionCoordinator
import ai.yumi.android.service.YumiServiceController
import ai.yumi.android.system.SystemSettings
import ai.yumi.android.ui.components.YumiButton
import ai.yumi.android.ui.components.isGranted
import ai.yumi.android.ui.components.rememberPermissionAsker
import ai.yumi.android.ui.components.rememberResumeCount
import ai.yumi.android.ui.home.GoalAction
import ai.yumi.android.ui.home.HomeNotice
import ai.yumi.android.ui.home.HomeScreen
import ai.yumi.android.ui.onboarding.OnboardingScreen
import ai.yumi.android.ui.settings.SettingsActions
import ai.yumi.android.ui.settings.SettingsScreen
import ai.yumi.android.ui.settings.SettingsState
import ai.yumi.android.ui.theme.Yumi
import android.Manifest
import android.os.Build
import ai.yumi.android.design.YumiRadius
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.seconds

private enum class Screen { Home, Settings }

@Composable
fun YumiApp(graph: AppGraph) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val loaded by graph.settings.settings.collectAsStateWithLifecycle()
    val status by graph.status.collectAsStateWithLifecycle()
    val listening by graph.voice.listening.collectAsStateWithLifecycle()
    val voiceActive by graph.voice.active.collectAsStateWithLifecycle()
    val heard by graph.voice.partial.collectAsStateWithLifecycle()
    val voiceFailure by graph.voice.failure.collectAsStateWithLifecycle()
    val goal by graph.goals.state.collectAsStateWithLifecycle()
    val goalFailure by graph.goals.failure.collectAsStateWithLifecycle()
    val resumeCount = rememberResumeCount()

    // The window background shows until settings are read from disk, which takes a few milliseconds.
    val settings = loaded ?: return
    val markAsked: (String) -> Unit = { permission -> scope.launch { graph.settings.markPermissionAsked(permission) } }

    if (!settings.onboardingDone) {
        OnboardingScreen(
            alreadyAsked = settings.askedPermissions,
            onAsked = markAsked,
            onFinished = { scope.launch { graph.settings.setOnboardingDone() } },
        )
        return
    }

    // Keep the service running while allowed. Starting again on every resume lets a running service pick up a
    // microphone permission granted in the meantime, which it can only do while the app is in the foreground.
    LaunchedEffect(settings.runInBackground, settings.wakeWordEnabled, resumeCount) {
        if (settings.runInBackground) YumiServiceController.start(context) else YumiServiceController.stop(context)
    }

    val micAllowed = remember(resumeCount) { isGranted(context, Manifest.permission.RECORD_AUDIO) }
    val notificationsAllowed = remember(resumeCount) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            isGranted(context, Manifest.permission.POST_NOTIFICATIONS)
        } else {
            null
        }
    }
    val batteryUnrestricted = remember(resumeCount) { SystemSettings.isIgnoringBatteryOptimizations(context) }

    var screen by rememberSaveable { mutableStateOf(Screen.Home) }
    var error by remember { mutableStateOf<PresentedError?>(null) }
    var typing by remember { mutableStateOf(false) }

    LaunchedEffect(micAllowed) {
        if (micAllowed && error?.kind == ErrorKind.MicrophonePermissionMissing) error = null
    }

    // A new listening session replaces whatever went wrong last time.
    LaunchedEffect(voiceActive) {
        if (voiceActive) error = null
    }

    // Voice failures can happen with the app closed, after the wake word. They stay until the app shows them.
    LaunchedEffect(voiceFailure) {
        voiceFailure?.let {
            error = graph.errors.present(it)
            graph.voice.clearFailure()
        }
    }

    // A goal that could not be sent (for example, no Mac paired yet) says so, then is forgotten.
    LaunchedEffect(goalFailure) {
        goalFailure?.let {
            error = graph.errors.present(it)
            graph.goals.clearFailure()
        }
    }

    val askMic = rememberPermissionAsker(Manifest.permission.RECORD_AUDIO, settings.askedPermissions, markAsked) {}
    val askNotifications = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        rememberPermissionAsker(Manifest.permission.POST_NOTIFICATIONS, settings.askedPermissions, markAsked) {}
    } else {
        {}
    }
    val allowBattery = { context.startActivity(SystemSettings.ignoreBatteryOptimizationsIntent(context)) }

    when (screen) {
        Screen.Home -> HomeScreen(
            listening = listening,
            voiceActive = voiceActive,
            heard = heard,
            connection = status.connection,
            notices = buildList {
                if (!settings.runInBackground) {
                    add(
                        HomeNotice(R.string.home_stopped_title, R.string.home_stopped_body, R.string.home_stopped_action) {
                            scope.launch { graph.settings.setRunInBackground(true) }
                        },
                    )
                } else if (!batteryUnrestricted) {
                    add(HomeNotice(R.string.home_battery_title, R.string.home_battery_body, R.string.home_battery_action, allowBattery))
                }
            },
            goal = goal,
            error = error,
            onErrorButton = { button ->
                error = null
                when (button.action) {
                    ErrorButton.OpenSettings -> if (error?.kind == ErrorKind.SpeechRecognitionNotSetUp) {
                        SystemSettings.openSpeechSettings(context)
                    } else {
                        context.startActivity(SystemSettings.appDetailsIntent(context))
                    }
                    ErrorButton.TypeInstead -> typing = true
                    ErrorButton.TryAgain -> graph.voice.start()
                    else -> Unit
                }
            },
            onGoalAction = { action ->
                when (action) {
                    is GoalAction.Confirm -> graph.goals.confirm(action.text)
                    GoalAction.Cancel -> graph.goals.cancel()
                    GoalAction.Stop -> graph.goals.stop()
                    GoalAction.Resume -> graph.goals.resume()
                }
            },
            onMic = {
                if (voiceActive) {
                    graph.voice.stop()
                } else {
                    error = null
                    graph.voice.start()
                }
            },
            onOpenSettings = { screen = Screen.Settings },
        )

        Screen.Settings -> {
            BackHandler { screen = Screen.Home }
            SettingsScreen(
                state = SettingsState(
                    wakeWordEnabled = settings.wakeWordEnabled,
                    microphoneAllowed = micAllowed,
                    notificationsAllowed = notificationsAllowed,
                    runInBackground = settings.runInBackground,
                    batteryUnrestricted = batteryUnrestricted,
                    showTesting = BuildConfig.DEBUG,
                    wakePhrase = graph.wakeWordConfig.phrase,
                ),
                actions = SettingsActions(
                    onBack = { screen = Screen.Home },
                    onWakeWordChange = { scope.launch { graph.settings.setWakeWordEnabled(it) } },
                    onRunInBackgroundChange = { scope.launch { graph.settings.setRunInBackground(it) } },
                    onAllowBattery = allowBattery,
                    onOpenAppSettings = { context.startActivity(SystemSettings.appDetailsIntent(context)) },
                    onAllowMicrophone = askMic,
                    onAllowNotifications = askNotifications,
                    onRunTestTool = {
                        graph.appScope.launch {
                            delay(5.seconds)
                            graph.testTool.run()
                        }
                    },
                ),
            )
        }
    }

    if (typing) {
        TypeGoalDialog(
            onSend = {
                typing = false
                graph.goals.onGoal(it)
            },
            onDismiss = { typing = false },
        )
    }

    PermissionRequestHost(graph.permissions, settings.askedPermissions, markAsked)
}

/** Shows tool permission requests from [PermissionCoordinator] while the app is open. */
@Composable
private fun PermissionRequestHost(
    coordinator: PermissionCoordinator,
    alreadyAsked: Set<String>,
    onAsked: (String) -> Unit,
) {
    // Collect only while resumed. Android delivers the notification's intent before onResume but after onStart,
    // so this way the in-app card never flashes behind the Android dialog when the user came from the notification.
    val request by coordinator.request.collectAsStateWithLifecycle(minActiveState = Lifecycle.State.RESUMED)
    val current = request ?: return
    val permission = current.permission.manifestPermission
    key(current.permission) {
        val ask = rememberPermissionAsker(permission, alreadyAsked, onAsked) { coordinator.onAnswered(it) }
        val activity = LocalActivity.current
        val dialogAvailable = permission !in alreadyAsked || activity?.shouldShowRequestPermissionRationale(permission) == true
        if (current.openedFromNotification && dialogAvailable) {
            // The notification already explained why, so go straight to Android's dialog.
            LaunchedEffect(current) { ask() }
        } else {
            val (allow, notNow) = current.error.buttons
            AlertDialog(
                onDismissRequest = { coordinator.onAnswered(false) },
                title = { Text(stringResource(R.string.permission_dialog_title)) },
                text = { Text(current.error.text) },
                confirmButton = { YumiButton(onClick = ask) { Text(allow.label) } },
                dismissButton = { YumiButton(onClick = { coordinator.onAnswered(false) }, primary = false) { Text(notNow.label) } },
                containerColor = Yumi.colors.surface,
                titleContentColor = Yumi.colors.brand,
                textContentColor = Yumi.colors.ink,
            )
        }
    }
}

@Composable
private fun TypeGoalDialog(onSend: (String) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.type_title)) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text(stringResource(R.string.type_hint)) },
                minLines = 2,
                shape = RoundedCornerShape(YumiRadius.field),
                colors = OutlinedTextFieldDefaults.colors(
                    unfocusedBorderColor = Yumi.colors.line,
                    focusedBorderColor = Yumi.colors.accent,
                    unfocusedPlaceholderColor = Yumi.colors.faint,
                    focusedPlaceholderColor = Yumi.colors.faint,
                ),
            )
        },
        confirmButton = {
            YumiButton(onClick = { onSend(text) }, enabled = text.isNotBlank()) { Text(stringResource(R.string.type_send)) }
        },
        dismissButton = { YumiButton(onClick = onDismiss, primary = false) { Text(stringResource(R.string.type_cancel)) } },
        containerColor = Yumi.colors.surface,
        titleContentColor = Yumi.colors.brand,
    )
}
