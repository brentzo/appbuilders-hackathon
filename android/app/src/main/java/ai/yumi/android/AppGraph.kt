package ai.yumi.android

import ai.yumi.android.errors.ErrorPresenter
import ai.yumi.android.permissions.AndroidPermissionEnvironment
import ai.yumi.android.permissions.PermissionCoordinator
import ai.yumi.android.bridge.BridgeCrypto
import ai.yumi.android.bridge.DeviceKeyStore
import ai.yumi.android.bridge.PrefsBridgeStore
import ai.yumi.android.bridge.RelayBridge
import ai.yumi.android.service.WakeWordDetector
import ai.yumi.android.service.YumiStatus
import ai.yumi.android.settings.SettingsStore
import ai.yumi.android.tools.TestPermissionTool
import ai.yumi.android.voice.ChimeListeningSound
import ai.yumi.android.voice.LastGoal
import ai.yumi.android.voice.MicrophoneOwner
import ai.yumi.android.voice.OnDeviceSpeechEngine
import ai.yumi.android.voice.OnDeviceVoiceInput
import ai.yumi.android.voice.VoiceInput
import ai.yumi.android.voice.VoiceTrigger
import ai.yumi.android.voice.wakeword.WakeWordChoice
import ai.yumi.android.voice.wakeword.WakeWordConfig
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

/** The app's single object graph. Swap the stand-ins here when OBJ-23 and OBJ-12 land. */
class AppGraph(context: Context) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val settings = SettingsStore(context, appScope)
    val errors = ErrorPresenter()

    private val crypto = BridgeCrypto(LazySodiumAndroid(SodiumAndroid()))
    private val deviceKeys = DeviceKeyStore(context, crypto)
    val bridge = RelayBridge(
        crypto = crypto,
        keys = deviceKeys::keys,
        store = PrefsBridgeStore(context),
        deviceName = deviceName(context),
        allowLoopback = BuildConfig.DEBUG,
        log = { Log.i("YumiBridge", it) },
    )
    val goals = LastGoal()
    val microphone = MicrophoneOwner()
    val wakeWordConfig = WakeWordConfig.Current
    val voice: VoiceInput = OnDeviceVoiceInput(
        engine = OnDeviceSpeechEngine(context),
        microphone = microphone,
        goals = goals,
        sound = ChimeListeningSound(),
        microphoneAllowed = {
            context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        },
        scope = appScope,
    )
    val wakeWord: WakeWordDetector = WakeWordChoice.Current.detector(context, microphone) {
        voice.start(VoiceTrigger.WakeWord)
    }

    /** Set by [ai.yumi.android.service.YumiService] while it runs. */
    val serviceRunning = MutableStateFlow(false)

    val status: StateFlow<YumiStatus> = combine(serviceRunning, bridge.state, wakeWord.listening, voice.listening, ::YumiStatus)
        .stateIn(appScope, SharingStarted.Eagerly, YumiStatus())

    val permissions = PermissionCoordinator(AndroidPermissionEnvironment(context), errors)
    val testTool = TestPermissionTool(permissions)

    init {
        // Reconnect at once when Android moves to another network, for example from Wi-Fi to mobile data.
        context.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(
            object : ConnectivityManager.NetworkCallback() {
                private var current: Network? = null
                override fun onAvailable(network: Network) {
                    if (current != null && current != network) bridge.networkChanged()
                    current = network
                }
            },
        )
        Log.i(
            "Yumi",
            "Stand-ins in use: placeholder cat (OBJ-10), " +
                "wake word ${WakeWordChoice.Current} instead of OBJ-12's Hey Yumi model, temporary protocol types (OBJ-01)",
        )
    }
}

/** The phone's name as the user set it, shown on the Mac as "Paired with <name>". */
private fun deviceName(context: Context): String =
    Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: Build.MODEL
