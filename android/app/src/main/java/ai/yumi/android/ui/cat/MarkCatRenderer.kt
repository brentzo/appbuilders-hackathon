package ai.yumi.android.ui.cat

import ai.yumi.android.R
import ai.yumi.android.design.YumiMotion
import ai.yumi.android.ui.components.YumiMark
import ai.yumi.android.ui.theme.Yumi
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.lerp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The Yumi mark (character/assets/logo) on the halo disc, until the Rive cat from OBJ-10 lands.
 * Idle breathes slowly, listening leans in with a soft ginger ring, and stuck sits on hush lavender.
 * With animations off in the system settings, the cat holds still and only the colors change.
 */
object MarkCatRenderer : CatRenderer {

    @Composable
    override fun Cat(state: CatState, modifier: Modifier, playful: Boolean) {
        val colors = Yumi.colors
        val still = rememberReduceMotion()
        val listening by animateFloatAsState(
            targetValue = if (state == CatState.Listening) 1f else 0f,
            animationSpec = tween(YumiMotion.PANEL_MS, easing = YumiMotion.easing),
            label = "listening",
        )
        val disc by animateColorAsState(
            // A lavender tint, not the full hush: at this size the solid color would shout.
            if (state == CatState.Stuck) colors.hush.copy(alpha = 0.45f).compositeOver(colors.paper) else colors.halo,
            tween(YumiMotion.PANEL_MS, easing = YumiMotion.easing),
            label = "disc",
        )
        val description = when (state) {
            CatState.Idle -> "Yumi"
            CatState.Listening -> "Yumi is listening"
            CatState.Stuck -> "Yumi needs a hand"
        }
        val reaction = rememberTapReaction(still)
        val tap = if (playful) {
            Modifier.clickable(
                interactionSource = null,
                indication = null,
                onClickLabel = stringResource(R.string.cat_pet),
                onClick = reaction::play,
            )
        } else {
            Modifier
        }
        Box(modifier.semantics { contentDescription = description }.then(tap), contentAlignment = Alignment.Center) {
            // Both are read while drawing, so the motion redraws without recomposing.
            val breath = if (still) null else breathing()
            val ring = if (still || state != CatState.Listening) null else ringPhase()
            val accent = colors.accent
            Canvas(Modifier.fillMaxSize()) {
                val radius = size.minDimension / 2f * DISC
                ring?.value?.let {
                    drawCircle(
                        accent.copy(alpha = 0.45f * (1f - it)),
                        radius = radius * lerp(1f, 1f / DISC, it),
                        style = Stroke(width = 2.dp.toPx()),
                    )
                }
                drawCircle(disc, radius = radius * (1f + 0.02f * listening))
            }
            Box(
                Modifier
                    .fillMaxSize(CAT)
                    .graphicsLayer {
                        // Breathing and squashing grow from the paws, so the cat stays seated on the disc.
                        transformOrigin = TransformOrigin(0.5f, 0.85f)
                        val scale = 1f + 0.012f * (breath?.value ?: 0f) + 0.035f * listening
                        val squash = reaction.squash.value * SQUASH
                        scaleX = scale * (1f + squash)
                        scaleY = scale * (1f - squash)
                        translationY = -reaction.hop.value * size.height * HOP
                    },
            ) {
                YumiMark(Modifier.fillMaxSize())
                // The happy face fades in over the plain one; both share one frame, so nothing jumps.
                YumiMark(Modifier.fillMaxSize().graphicsLayer { alpha = reaction.joy.value }, happy = true)
            }
        }
    }

    /** The disc's share of the box, leaving room for the listening ring to grow. */
    private const val DISC = 0.84f
    private const val CAT = 0.66f

    @Composable
    private fun breathing(): State<Float> =
        rememberInfiniteTransition(label = "breath").animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(BREATH_MS, easing = YumiMotion.easing), RepeatMode.Reverse),
            label = "breath",
        )

    @Composable
    private fun ringPhase(): State<Float> =
        rememberInfiniteTransition(label = "ring").animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(RING_MS, easing = LinearEasing), RepeatMode.Restart),
            label = "ring",
        )

    /** How far a full squash widens the cat, and how high the hop goes, as shares of its size. */
    private const val SQUASH = 0.07f
    private const val HOP = 0.12f
    private const val BREATH_MS = 2400
    private const val RING_MS = 1600
}

/** True when the user turned animations off (Settings, Accessibility, Remove animations sets the scale to 0). */
@Composable
fun rememberReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

/**
 * The cat's answer to a tap: a squash, a hop, and a settle, about 590 ms on the token easing, with the happy face
 * of the Mac's "done" pose and a light tick. A new tap cancels the running one and starts again from wherever the
 * cat is, so taps can come as fast as the user likes. With animations off, only the happy face fades in and out.
 */
@Stable
class TapReaction internal constructor(
    private val scope: CoroutineScope,
    private val view: View,
    private val still: Boolean,
) {
    /** 1 at the top of the hop. */
    val hop = Animatable(0f)
    /** Positive squashes the cat wide and short; negative stretches it tall. */
    val squash = Animatable(0f)
    /** The happy face's opacity. */
    val joy = Animatable(0f)
    private var running: Job? = null

    fun play() {
        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        running?.cancel()
        running = scope.launch {
            launch {
                joy.animateTo(1f, tween(JOY_IN_MS))
                delay(JOY_HOLD_MS)
                joy.animateTo(0f, tween(JOY_OUT_MS))
            }
            if (still) return@launch
            val easing = YumiMotion.easing
            squash.animateTo(1f, tween(80, easing = easing))
            coroutineScope {
                launch { hop.animateTo(1f, tween(190, easing = easing)) }
                squash.animateTo(-0.6f, tween(110, easing = easing))
                squash.animateTo(0f, tween(80, easing = easing))
            }
            hop.animateTo(0f, tween(170, easing = easing))
            squash.animateTo(0.7f, tween(60, easing = easing))
            squash.animateTo(0f, tween(90, easing = easing))
        }
    }

    private companion object {
        const val JOY_IN_MS = 90
        const val JOY_HOLD_MS = 300L
        const val JOY_OUT_MS = 150
    }
}

@Composable
private fun rememberTapReaction(still: Boolean): TapReaction {
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    return remember(scope, view, still) { TapReaction(scope, view, still) }
}
