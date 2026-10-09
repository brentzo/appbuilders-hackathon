package ai.yumi.android.voice

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration

/**
 * Who has the microphone: the wake word detector or voice intake, never both.
 * Intake always wins: while it is active the detector closes its microphone and waits.
 */
class MicrophoneOwner {
    private val _intakeActive = MutableStateFlow(false)
    private val _detectorOpen = MutableStateFlow(false)

    /** True from the moment intake starts until its session has fully ended. */
    val intakeActive: StateFlow<Boolean> = _intakeActive.asStateFlow()

    /** True while the wake word detector holds the microphone open. */
    val detectorOpen: StateFlow<Boolean> = _detectorOpen.asStateFlow()

    fun setIntakeActive(active: Boolean) {
        _intakeActive.value = active
    }

    fun setDetectorOpen(open: Boolean) {
        _detectorOpen.value = open
    }

    /** Waits until the detector has let go of the microphone. Returns false if it did not within [timeout]. */
    suspend fun awaitDetectorClosed(timeout: Duration): Boolean =
        withTimeoutOrNull(timeout) { _detectorOpen.first { !it } } != null
}
