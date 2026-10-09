package ai.yumi.android.ui.home

import ai.yumi.android.R
import ai.yumi.android.design.YumiRadius
import ai.yumi.android.design.YumiSpace
import ai.yumi.android.routing.GoalFlow
import ai.yumi.android.routing.RepeatBack
import ai.yumi.android.ui.components.StatePill
import ai.yumi.android.ui.components.YumiButton
import ai.yumi.android.ui.components.YumiCard
import ai.yumi.android.ui.theme.Yumi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource

/** What the user tapped on the goal card. */
sealed interface GoalAction {
    /** Send the (possibly edited) transcript to the Mac. */
    data class Confirm(val text: String) : GoalAction

    /** Drop the repeat-back, or cancel a paused goal. */
    data object Cancel : GoalAction

    /** Ask the Mac to pause. */
    data object Stop : GoalAction

    /** Resume a paused goal. */
    data object Resume : GoalAction
}

/** The goal card: the repeat-back, the working state with Stop, the paused state, or the summary. */
@Composable
fun GoalCard(goal: GoalFlow, onAction: (GoalAction) -> Unit, modifier: Modifier = Modifier) {
    when (goal) {
        GoalFlow.Idle -> Unit
        is GoalFlow.Confirming -> ConfirmingCard(goal, onAction, modifier)
        is GoalFlow.Working -> RunningCard(goal.goal, goal.subtask, stopping = false, onAction, modifier)
        is GoalFlow.Pausing -> RunningCard(goal.goal, goal.subtask, stopping = true, onAction, modifier)
        is GoalFlow.Paused -> PausedCard(goal, onAction, modifier)
        is GoalFlow.Finished -> FinishedCard(goal, modifier)
    }
}

/** The repeat-back: the fixed sentence, the transcript editable below it, and Send or Cancel. */
@Composable
private fun ConfirmingCard(goal: GoalFlow.Confirming, onAction: (GoalAction) -> Unit, modifier: Modifier) {
    // Keyed on the goal so a corrected goal replaces what the user last typed.
    var text by rememberSaveable(goal.goal) { mutableStateOf(goal.goal) }
    YumiCard(modifier) {
        Text(
            RepeatBack.delegated(text.trim().ifEmpty { goal.goal }),
            style = MaterialTheme.typography.bodyLarge,
            color = Yumi.colors.ink,
        )
        Spacer(Modifier.height(YumiSpace.s))
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.goal_edit_label), style = MaterialTheme.typography.bodySmall) },
            minLines = 2,
            shape = RoundedCornerShape(YumiRadius.field),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Yumi.colors.accent,
                unfocusedBorderColor = Yumi.colors.line,
                focusedTextColor = Yumi.colors.ink,
                unfocusedTextColor = Yumi.colors.ink,
            ),
        )
        Spacer(Modifier.height(YumiSpace.m))
        Row(horizontalArrangement = Arrangement.spacedBy(YumiSpace.s)) {
            YumiButton(onClick = { onAction(GoalAction.Confirm(text)) }) { Text(stringResource(R.string.goal_send)) }
            YumiButton(onClick = { onAction(GoalAction.Cancel) }, primary = false) { Text(stringResource(R.string.goal_cancel)) }
        }
    }
}

/** "Working on your Mac": the goal, the current subtask, and Stop. */
@Composable
private fun RunningCard(goal: String, subtask: String?, stopping: Boolean, onAction: (GoalAction) -> Unit, modifier: Modifier) {
    YumiCard(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.home_main_task), style = MaterialTheme.typography.bodySmall, color = Yumi.colors.muted)
                Spacer(Modifier.height(YumiSpace.xxs))
                Text(goal, style = MaterialTheme.typography.bodyLarge, color = Yumi.colors.ink)
            }
            Spacer(Modifier.width(YumiSpace.m))
            StatePill(stringResource(R.string.home_task_working), Yumi.colors.accent, Yumi.colors.onAccent)
        }
        Spacer(Modifier.height(YumiSpace.s))
        Text(
            subtask ?: stringResource(if (stopping) R.string.goal_stopping else R.string.goal_starting),
            style = MaterialTheme.typography.bodyMedium,
            color = Yumi.colors.muted,
        )
        Spacer(Modifier.height(YumiSpace.m))
        YumiButton(onClick = { onAction(GoalAction.Stop) }, primary = false, enabled = !stopping) {
            Text(stringResource(R.string.goal_stop))
        }
    }
}

/** "Paused": the Mac confirmed the pause, so Resume and Cancel are offered (SPEC-09 r12). */
@Composable
private fun PausedCard(goal: GoalFlow.Paused, onAction: (GoalAction) -> Unit, modifier: Modifier) {
    YumiCard(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.home_main_task), style = MaterialTheme.typography.bodySmall, color = Yumi.colors.muted)
                Spacer(Modifier.height(YumiSpace.xxs))
                Text(goal.goal, style = MaterialTheme.typography.bodyLarge, color = Yumi.colors.ink)
            }
            Spacer(Modifier.width(YumiSpace.m))
            StatePill(stringResource(R.string.goal_paused), Yumi.colors.surfaceRaised, Yumi.colors.muted)
        }
        Spacer(Modifier.height(YumiSpace.m))
        Row(horizontalArrangement = Arrangement.spacedBy(YumiSpace.s)) {
            YumiButton(onClick = { onAction(GoalAction.Resume) }) { Text(stringResource(R.string.goal_resume)) }
            YumiButton(onClick = { onAction(GoalAction.Cancel) }, primary = false) { Text(stringResource(R.string.goal_cancel)) }
        }
    }
}

/** The result the Mac sent, spoken and shown once (SPEC-09 r7). */
@Composable
private fun FinishedCard(goal: GoalFlow.Finished, modifier: Modifier) {
    YumiCard(modifier) {
        Text(stringResource(R.string.home_main_task), style = MaterialTheme.typography.bodySmall, color = Yumi.colors.muted)
        Spacer(Modifier.height(YumiSpace.xxs))
        Text(goal.summary, style = MaterialTheme.typography.bodyLarge, color = Yumi.colors.ink)
    }
}
