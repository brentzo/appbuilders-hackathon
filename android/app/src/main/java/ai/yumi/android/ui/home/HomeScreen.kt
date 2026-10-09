package ai.yumi.android.ui.home

import ai.yumi.android.R
import ai.yumi.android.design.YumiMotion
import ai.yumi.android.design.YumiSpace
import ai.yumi.android.errors.PresentedButton
import ai.yumi.android.errors.PresentedError
import ai.yumi.android.notifications.connectionTextRes
import ai.yumi.android.protocol.ConnectionState
import ai.yumi.android.ui.cat.CatState
import ai.yumi.android.ui.cat.LocalCatRenderer
import ai.yumi.android.ui.cat.rememberReduceMotion
import ai.yumi.android.ui.components.ErrorCard
import ai.yumi.android.ui.components.HushCard
import ai.yumi.android.ui.components.StatePill
import ai.yumi.android.ui.components.YumiButton
import ai.yumi.android.ui.components.YumiCard
import ai.yumi.android.ui.components.YumiMark
import ai.yumi.android.ui.theme.Yumi
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp

/** A notice at the top of the home screen with one action, for things that stop Yumi working in the background. */
data class HomeNotice(val title: Int, val body: Int, val action: Int, val onAction: () -> Unit)

/**
 * Home, laid out like the Mac menu panel: the brand header, the cat on its halo with Yumi's state,
 * the last goal as a task row, and the ginger Talk button at the bottom, in reach of a thumb.
 */
@Composable
fun HomeScreen(
    listening: Boolean,
    voiceActive: Boolean,
    heard: String?,
    connection: ConnectionState,
    notices: List<HomeNotice>,
    lastGoal: String?,
    error: PresentedError?,
    onErrorButton: (PresentedButton) -> Unit,
    onMic: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Yumi.colors.paper)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        Header(onOpenSettings)
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            // Centered in the space between the header and the Talk button, and scrollable when cards make it taller.
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = maxHeight)
                    .padding(horizontal = YumiSpace.l, vertical = YumiSpace.m),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(YumiSpace.m, Alignment.CenterVertically),
            ) {
                HomeContent(listening, heard, connection, notices, lastGoal, error, onErrorButton)
            }
        }
        ConnectionLine(connection, Modifier.align(Alignment.CenterHorizontally))
        Spacer(Modifier.height(YumiSpace.l))
        TalkButton(voiceActive, onMic, Modifier.align(Alignment.CenterHorizontally))
        Spacer(Modifier.height(YumiSpace.xl))
    }
}

@Composable
private fun Header(onOpenSettings: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = YumiSpace.l, end = YumiSpace.xs, top = YumiSpace.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        YumiMark(
            Modifier
                .size(36.dp)
                .background(Yumi.colors.halo, CircleShape)
                .padding(5.dp),
            small = true,
        )
        Spacer(Modifier.width(YumiSpace.s + YumiSpace.xxs))
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleMedium, color = Yumi.colors.brand)
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onOpenSettings) {
            Icon(
                Icons.Outlined.Settings,
                contentDescription = stringResource(R.string.home_settings),
                tint = Yumi.colors.muted,
            )
        }
    }
}

@Composable
private fun ColumnScope.HomeContent(
    listening: Boolean,
    heard: String?,
    connection: ConnectionState,
    notices: List<HomeNotice>,
    lastGoal: String?,
    error: PresentedError?,
    onErrorButton: (PresentedButton) -> Unit,
) {
    notices.forEach { NoticeCard(it) }
    val state = when {
        error != null -> CatState.Stuck
        listening -> CatState.Listening
        else -> CatState.Idle
    }
    // The cat makes room when cards need the space, so the state and the cards fit without scrolling.
    val catSize by animateDpAsState(
        when {
            notices.isEmpty() && error == null -> 248.dp
            notices.isEmpty() || error == null -> 200.dp
            else -> 168.dp
        },
        tween(YumiMotion.PANEL_MS, easing = YumiMotion.easing),
        label = "catSize",
    )
    LocalCatRenderer.current.Cat(state, Modifier.size(catSize), playful = true)
    HomeStatePill(state)
    // With an error, its card says what to do next, so the hint would only repeat it.
    if (error == null) Text(
        // While listening, show what the phone has heard so far, so the user can see it is working.
        if (listening && heard != null) heard else stringResource(if (listening) R.string.home_hint_listening else R.string.home_hint_idle),
        style = MaterialTheme.typography.titleMedium,
        color = if (listening && heard != null) Yumi.colors.ink else Yumi.colors.muted,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .padding(horizontal = YumiSpace.l)
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
    if (lastGoal != null) {
        Spacer(Modifier.height(YumiSpace.xs))
        TaskRow(lastGoal, connection)
    }
    AnimatedVisibility(
        visible = error != null,
        enter = fadeIn(tween(YumiMotion.PANEL_MS, easing = YumiMotion.easing)),
        exit = fadeOut(tween(YumiMotion.AVOID_FADE_MS)),
    ) {
        if (error != null) ErrorCard(error, onErrorButton)
    }
}

@Composable
private fun HomeStatePill(state: CatState) {
    val colors = Yumi.colors
    // Crossfades so the pill never jumps between words.
    Crossfade(state, animationSpec = tween(YumiMotion.AVOID_FADE_MS), label = "state") { shown ->
        when (shown) {
            CatState.Idle -> StatePill(stringResource(R.string.home_state_ready), colors.halo, colors.accentText)
            CatState.Listening -> StatePill(stringResource(R.string.home_state_listening), colors.accent, colors.onAccent)
            CatState.Stuck -> StatePill(stringResource(R.string.home_state_needs_hand), colors.hush, colors.onHush)
        }
    }
}

/** The last goal, like a cursor row on the Mac: what the task is, and where it stands. */
@Composable
private fun TaskRow(goal: String, connection: ConnectionState) {
    val colors = Yumi.colors
    YumiCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.home_main_task), style = MaterialTheme.typography.bodySmall, color = colors.muted)
                Spacer(Modifier.height(YumiSpace.xxs))
                Text(goal, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
            }
            Spacer(Modifier.width(YumiSpace.m))
            if (connection == ConnectionState.Connected) {
                StatePill(stringResource(R.string.home_task_working), colors.accent, colors.onAccent)
            } else {
                StatePill(stringResource(R.string.home_task_waiting), colors.surfaceRaised, colors.muted)
            }
        }
    }
}

@Composable
private fun NoticeCard(notice: HomeNotice) {
    HushCard {
        Text(
            stringResource(notice.title),
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
            color = Yumi.colors.ink,
        )
        Spacer(Modifier.height(YumiSpace.xxs))
        Text(
            stringResource(notice.body),
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp, lineHeight = 18.sp),
            color = Yumi.colors.muted,
        )
        Spacer(Modifier.height(YumiSpace.m))
        YumiButton(onClick = notice.onAction, primary = false) { Text(stringResource(notice.action)) }
    }
}

@Composable
private fun ConnectionLine(connection: ConnectionState, modifier: Modifier = Modifier) {
    val colors = Yumi.colors
    val dot = when (connection) {
        ConnectionState.Connected -> colors.accent
        ConnectionState.Reconnecting -> colors.hush
        ConnectionState.Offline, ConnectionState.NotPaired -> colors.faint
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(YumiSpace.s),
        modifier = modifier
            .padding(horizontal = YumiSpace.l)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        Box(Modifier.size(7.dp).background(dot, CircleShape))
        Text(
            stringResource(connectionTextRes(connection)),
            style = MaterialTheme.typography.bodySmall,
            color = colors.muted,
            textAlign = TextAlign.Center,
        )
    }
}

/** The ginger Talk button. While the microphone is on, a soft ring breathes out from it. */
@Composable
private fun TalkButton(active: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Yumi.colors
    val still = rememberReduceMotion()
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.95f else 1f, tween(120), label = "press")
    val ring = if (active && !still) {
        rememberInfiniteTransition(label = "ring").animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Restart),
            label = "ring",
        )
    } else {
        null
    }
    val description = stringResource(if (active) R.string.home_mic_stop else R.string.home_mic_start)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(RING_BOX), contentAlignment = Alignment.Center) {
            val accent = colors.accent
            Canvas(Modifier.matchParentSize()) {
                val button = BUTTON.toPx() / 2f
                if (active) {
                    // A steady soft ring, so the state still shows with animations off.
                    drawCircle(accent.copy(alpha = 0.22f), radius = button + 6.dp.toPx())
                }
                ring?.value?.let {
                    drawCircle(
                        accent.copy(alpha = 0.5f * (1f - it)),
                        radius = lerp(button, size.minDimension / 2f - 1.dp.toPx(), it),
                        style = Stroke(width = 2.dp.toPx()),
                    )
                }
            }
            Box(
                Modifier
                    .size(BUTTON)
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                    }
                    .clip(CircleShape)
                    .background(colors.accent)
                    .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick)
                    .semantics { contentDescription = description },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painterResource(if (active) R.drawable.ic_stop else R.drawable.ic_mic),
                    contentDescription = null,
                    tint = colors.onAccent,
                    modifier = Modifier.size(30.dp),
                )
            }
        }
        Text(
            stringResource(if (active) R.string.home_stop else R.string.home_talk),
            style = MaterialTheme.typography.labelLarge,
            color = colors.muted,
        )
    }
}

private val BUTTON = 72.dp
private val RING_BOX = 104.dp
