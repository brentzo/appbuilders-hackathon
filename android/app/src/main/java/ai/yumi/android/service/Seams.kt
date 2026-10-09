package ai.yumi.android.service

import ai.yumi.android.protocol.ConnectionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The bridge client that runs inside [YumiService]. OBJ-23 provides the real one.
 * [start] is called once when the service starts, with a scope that ends when the service stops.
 */
interface BridgeConnection {
    val state: StateFlow<ConnectionState>
    fun start(scope: CoroutineScope)
    fun stop()
}

/**
 * The "Hey Yumi" detector that runs inside [YumiService] (SPEC-01 requirement 12).
 * The real one is `voice/wakeword/OpenWakeWordDetector`.
 * The service only calls [start] while it holds the microphone service type and the wake word setting is on.
 */
interface WakeWordDetector {
    /** True only while the microphone is actually open for detection. */
    val listening: StateFlow<Boolean>
    fun start(scope: CoroutineScope)
    fun stop()
}

/** Stand-in until OBJ-23: never paired, never connects. */
class UnpairedBridgeConnection : BridgeConnection {
    override val state: StateFlow<ConnectionState> = MutableStateFlow(ConnectionState.NotPaired).asStateFlow()
    override fun start(scope: CoroutineScope) = Unit
    override fun stop() = Unit
}
