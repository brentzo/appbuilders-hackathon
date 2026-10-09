package ai.yumi.android

import ai.yumi.android.errors.ErrorPresenter
import ai.yumi.android.permissions.AndroidPermissionEnvironment
import ai.yumi.android.permissions.PermissionCoordinator
import ai.yumi.android.service.BridgeConnection
import ai.yumi.android.service.NoWakeWordDetector
import ai.yumi.android.service.UnpairedBridgeConnection
import ai.yumi.android.service.WakeWordDetector
import ai.yumi.android.service.YumiStatus
import ai.yumi.android.settings.SettingsStore
import ai.yumi.android.tools.TestPermissionTool
import ai.yumi.android.voice.LastGoal
import ai.yumi.android.voice.StandInVoiceInput
import ai.yumi.android.voice.VoiceInput
import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

/** The app's single object graph. Swap the stand-ins here when OBJ-23 and OBJ-24 land. */
class AppGraph(context: Context) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val settings = SettingsStore(context, appScope)
    val errors = ErrorPresenter()

    val bridge: BridgeConnection = UnpairedBridgeConnection()
    val wakeWord: WakeWordDetector = NoWakeWordDetector()
    val voice: VoiceInput = StandInVoiceInput()
    val goals = LastGoal()

    /** Set by [ai.yumi.android.service.YumiService] while it runs. */
    val serviceRunning = MutableStateFlow(false)

    val status: StateFlow<YumiStatus> = combine(serviceRunning, bridge.state, wakeWord.listening, ::YumiStatus)
        .stateIn(appScope, SharingStarted.Eagerly, YumiStatus())

    val permissions = PermissionCoordinator(AndroidPermissionEnvironment(context), errors)
    val testTool = TestPermissionTool(permissions)

    init {
        Log.i(
            "Yumi",
            "Stand-ins in use: placeholder cat (OBJ-10), no bridge (OBJ-23), no voice or wake word (OBJ-24), " +
                "temporary protocol types (OBJ-01)",
        )
    }
}
