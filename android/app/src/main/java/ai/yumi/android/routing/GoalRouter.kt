package ai.yumi.android.routing

import ai.yumi.android.bridge.Bridge
import ai.yumi.android.errors.ErrorKind
import ai.yumi.android.voice.GoalSink
import ai.yumi.android.voice.Speaker
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import yumi.protocol.CancelConfirmedPayload
import yumi.protocol.CancelPayload
import yumi.protocol.DelegateGoalPayload
import yumi.protocol.EnvelopeType
import yumi.protocol.GoalFinalStatus
import yumi.protocol.GoalFinishedPayload
import yumi.protocol.PauseConfirmedPayload
import yumi.protocol.PausePayload
import yumi.protocol.ProgressPayload
import yumi.protocol.ResumePayload

/**
 * What the phone shows for a goal (SPEC-09 r9, r11, r12; SPEC-10 Part A).
 * One goal at a time: the phone repeats a goal back, delegates it, shows the Mac's progress, and owns Stop.
 */
sealed interface GoalFlow {
    /** Nothing to show. */
    data object Idle : GoalFlow

    /** The repeat-back is on screen and Yumi waits for a yes or a no. [prompt] is shown and spoken. */
    data class Confirming(val goal: String, val prompt: String) : GoalFlow

    /** The goal was sent to the Mac and is running. [subtask] is the latest `progress` title, null before the first one. */
    data class Working(override val goalId: String, override val goal: String, override val subtask: String?) : ActiveGoal

    /** Stop was tapped; the phone still shows it working until the Mac confirms the pause (SPEC-09 r12). */
    data class Pausing(override val goalId: String, override val goal: String, override val subtask: String?) : ActiveGoal

    /** The Mac confirmed the pause. Resume and Cancel are offered. */
    data class Paused(override val goalId: String, override val goal: String, override val subtask: String?) : ActiveGoal

    /** The Mac finished. The summary is shown and spoken, and the working state is cleared. */
    data class Finished(val goalId: String, val goal: String, val status: GoalFinalStatus, val summary: String) : GoalFlow
}

/** The states of a delegated goal that the Mac knows by id: working, pausing, or paused. */
sealed interface ActiveGoal : GoalFlow {
    val goalId: String
    val goal: String
    val subtask: String?
}

/**
 * The phone's goal brain for the demo (SPEC-09 r5, r9, r11, r12; SPEC-10 r8).
 * It replaces `LastGoal`: every transcript is repeated back, and once confirmed it is delegated to the Mac
 * as a `delegateGoal` command. It collects `progress`, `goalFinished`, and `pauseConfirmed` from the bridge,
 * so the working state survives the app going to the background.
 *
 * The demo delegates every goal, so the p0 rule (OBJ-67.1) and phone-run tools (OBJ-66) are not here yet.
 */
class GoalRouter(
    private val bridge: Bridge,
    private val speaker: Speaker,
    scope: CoroutineScope,
    private val now: () -> Instant = { Instant.now() },
    private val newGoalId: () -> String = { UUID.randomUUID().toString() },
) : GoalSink {

    private val _state = MutableStateFlow<GoalFlow>(GoalFlow.Idle)
    val state: StateFlow<GoalFlow> = _state.asStateFlow()

    /** A failure the user should see, with its SPEC-11 kind, until [clearFailure]. */
    private val _failure = MutableStateFlow<ErrorKind?>(null)
    val failure: StateFlow<ErrorKind?> = _failure.asStateFlow()

    init {
        scope.launch {
            bridge.incoming.collect { message ->
                when (val payload = message.payload) {
                    is ProgressPayload -> onProgress(payload)
                    is GoalFinishedPayload -> onFinished(payload)
                    is PauseConfirmedPayload -> onPauseConfirmed(payload)
                    is CancelConfirmedPayload -> onCancelConfirmed(payload)
                    else -> Unit
                }
            }
        }
    }

    /** Every transcript, spoken or typed, arrives here. */
    override fun onGoal(text: String) {
        val said = text.trim()
        if (said.isEmpty()) return
        when (val current = _state.value) {
            is GoalFlow.Confirming -> onReply(current, said)
            // One delegated goal at a time; a new goal waits until this one ends.
            is ActiveGoal -> Unit
            else -> repeatBack(said)
        }
    }

    /** The user tapped Send, or a confirm reply arrived. The edited transcript is what is delegated. */
    fun confirm(goal: String) {
        val current = _state.value as? GoalFlow.Confirming ?: return
        val confirmed = goal.trim().ifEmpty { current.goal }
        val goalId = newGoalId()
        val payload = DelegateGoalPayload(goalId, confirmed, bridge.deviceId, now().toString())
        if (bridge.send(EnvelopeType.Command, payload) == null) return unpaired()
        _state.value = GoalFlow.Working(goalId, confirmed, subtask = null)
    }

    /** Stop: ask the Mac to pause, and keep the working state until it confirms (SPEC-09 r12). */
    fun stop() {
        val current = _state.value as? GoalFlow.Working ?: return
        if (bridge.send(EnvelopeType.Command, PausePayload(current.goalId)) == null) return unpaired()
        _state.value = GoalFlow.Pausing(current.goalId, current.goal, current.subtask)
    }

    /** Resume a paused goal. */
    fun resume() {
        val current = _state.value as? GoalFlow.Paused ?: return
        if (bridge.send(EnvelopeType.Command, ResumePayload(current.goalId)) == null) return unpaired()
        _state.value = GoalFlow.Working(current.goalId, current.goal, current.subtask)
    }

    /**
     * Cancel: a repeat-back is dropped, or a paused goal is cancelled on the Mac.
     * A cancelled goal stays paused until the Mac confirms, so the phone never claims it stopped early.
     */
    fun cancel() {
        when (val current = _state.value) {
            is GoalFlow.Confirming -> _state.value = GoalFlow.Idle
            is GoalFlow.Paused -> if (bridge.send(EnvelopeType.Command, CancelPayload(current.goalId)) == null) unpaired()
            else -> Unit
        }
    }

    fun clearFailure() {
        _failure.value = null
    }

    private fun onReply(current: GoalFlow.Confirming, said: String) {
        when (Replies.of(said)) {
            Reply.Confirm -> confirm(current.goal)
            Reply.Cancel -> _state.value = GoalFlow.Idle
            // Not a yes or a no: a corrected goal, repeated back with the same template (SPEC-10 r8).
            null -> repeatBack(said)
        }
    }

    private fun repeatBack(goal: String) {
        val prompt = RepeatBack.delegated(goal)
        _state.value = GoalFlow.Confirming(goal, prompt)
        speaker.speak(prompt)
    }

    private fun unpaired() {
        _failure.value = ErrorKind.UnpairedDevice
    }

    private fun onProgress(progress: ProgressPayload) {
        val current = _state.value
        if (current !is ActiveGoal || progress.goalId != current.goalId) return
        _state.value = when (current) {
            is GoalFlow.Working -> current.copy(subtask = progress.currentSubtaskTitle)
            is GoalFlow.Pausing -> current.copy(subtask = progress.currentSubtaskTitle)
            // A `paused` progress is not the confirmation the phone waits for (SPEC-09 r12), so it changes nothing.
            is GoalFlow.Paused -> current
        }
    }

    private fun onFinished(finished: GoalFinishedPayload) {
        val current = _state.value
        if (current !is ActiveGoal || finished.goalId != current.goalId) return
        _state.value = GoalFlow.Finished(current.goalId, current.goal, finished.status, finished.summary)
        speaker.speak(finished.summary)
    }

    private fun onPauseConfirmed(confirmed: PauseConfirmedPayload) {
        val current = _state.value
        if (current !is ActiveGoal || current is GoalFlow.Paused || confirmed.goalId != current.goalId) return
        _state.value = GoalFlow.Paused(current.goalId, current.goal, current.subtask)
    }

    private fun onCancelConfirmed(confirmed: CancelConfirmedPayload) {
        val current = _state.value
        if (current is ActiveGoal && confirmed.goalId == current.goalId) _state.value = GoalFlow.Idle
    }
}
