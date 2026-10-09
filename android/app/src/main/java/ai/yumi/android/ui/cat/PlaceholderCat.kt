package ai.yumi.android.ui.cat

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.util.lerp

/**
 * TEMPORARY placeholder until the Rive cat from OBJ-10 lands: a still cat face.
 * Listening perks the ears up, opens the eyes wide, and shows a soft pulse.
 */
object PlaceholderCatRenderer : CatRenderer {

    private val Fur = Color(0xFFF2A66B)
    private val FurShadow = Color(0xFFE08A4C)
    private val InnerEar = Color(0xFFF9CDB8)
    private val Line = Color(0xFF4A2A18)
    private val Nose = Color(0xFFE36F72)
    private val Whisker = Color(0xFF8A5A3E)

    @Composable
    override fun Cat(state: CatState, modifier: Modifier) {
        val listening by animateFloatAsState(
            targetValue = if (state == CatState.Listening) 1f else 0f,
            animationSpec = tween(durationMillis = 280, easing = FastOutSlowInEasing),
            label = "listening",
        )
        val description = if (state == CatState.Listening) "Yumi is listening" else "Yumi"
        Box(modifier.semantics { contentDescription = description }) {
            // Only animates while listening, so an idle home screen draws no frames.
            if (state == CatState.Listening) PulseRing(Modifier.matchParentSize())
            Face(listening, Modifier.matchParentSize())
        }
    }

    @Composable
    private fun PulseRing(modifier: Modifier) {
        val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart),
            label = "pulse",
        )
        val ring = MaterialTheme.colorScheme.primary
        Canvas(modifier) {
            val unit = size.minDimension / 100f
            drawCircle(
                color = ring.copy(alpha = 0.3f * (1f - pulse)),
                radius = lerp(38f, 50f, pulse) * unit,
                center = Offset(size.width / 2f, size.height / 2f + 2f * unit),
                style = Stroke(width = 2.5f * unit),
            )
        }
    }

    @Composable
    private fun Face(listening: Float, modifier: Modifier) {
        Canvas(modifier) {
            val unit = size.minDimension / 100f
            val origin = Offset((size.width - 100f * unit) / 2f, (size.height - 100f * unit) / 2f)
            fun p(x: Float, y: Float) = Offset(origin.x + x * unit, origin.y + y * unit)

            // Ears: tips rise and turn outward while listening.
            val tipY = lerp(10f, 3f, listening)
            val tipOut = lerp(0f, 3f, listening)
            ear(p(17f, 46f), p(24f - tipOut, tipY), p(44f, 26f), unit)
            ear(p(83f, 46f), p(76f + tipOut, tipY), p(56f, 26f), unit)

            // Head.
            drawOval(Fur, topLeft = p(14f, 20f), size = Size(72f * unit, 66f * unit))
            drawOval(FurShadow.copy(alpha = 0.35f), topLeft = p(26f, 62f), size = Size(48f * unit, 22f * unit))
            drawOval(Line, topLeft = p(14f, 20f), size = Size(72f * unit, 66f * unit), style = Stroke(1.8f * unit))

            // Eyes: calm ovals at idle, round and bright while listening.
            val eyeH = lerp(7f, 11f, listening)
            val eyeW = lerp(6.5f, 9f, listening)
            for (x in listOf(37f, 63f)) {
                drawOval(Line, topLeft = p(x - eyeW / 2f, 50f - eyeH / 2f), size = Size(eyeW * unit, eyeH * unit))
                drawCircle(Color.White, radius = lerp(1.2f, 2f, listening) * unit, center = p(x + eyeW / 6f, 50f - eyeH / 5f))
            }

            // Nose and mouth.
            val nose = Path().apply {
                moveTo(p(46.5f, 59f).x, p(46.5f, 59f).y)
                lineTo(p(53.5f, 59f).x, p(53.5f, 59f).y)
                lineTo(p(50f, 63f).x, p(50f, 63f).y)
                close()
            }
            drawPath(nose, Nose)
            val mouth = Path().apply {
                moveTo(p(50f, 63f).x, p(50f, 63f).y)
                quadraticTo(p(47f, 68f).x, p(47f, 68f).y, p(43f, 66f).x, p(43f, 66f).y)
                moveTo(p(50f, 63f).x, p(50f, 63f).y)
                quadraticTo(p(53f, 68f).x, p(53f, 68f).y, p(57f, 66f).x, p(57f, 66f).y)
            }
            drawPath(mouth, Line, style = Stroke(1.6f * unit, cap = StrokeCap.Round))

            // Whiskers.
            for ((from, to) in listOf(
                p(30f, 62f) to p(8f, 58f), p(30f, 66f) to p(9f, 68f),
                p(70f, 62f) to p(92f, 58f), p(70f, 66f) to p(91f, 68f),
            )) {
                drawLine(Whisker, from, to, strokeWidth = 1.2f * unit, cap = StrokeCap.Round)
            }
        }
    }

    private fun DrawScope.ear(base: Offset, tip: Offset, inner: Offset, unit: Float) {
        val outer = Path().apply {
            moveTo(base.x, base.y)
            lineTo(tip.x, tip.y)
            lineTo(inner.x, inner.y)
            close()
        }
        drawPath(outer, Fur)
        drawPath(outer, Line, style = Stroke(1.8f * unit))
        val center = Offset((base.x + tip.x + inner.x) / 3f, (base.y + tip.y + inner.y) / 3f)
        fun toward(point: Offset) = Offset(lerp(center.x, point.x, 0.55f), lerp(center.y, point.y, 0.55f))
        val innerEar = Path().apply {
            moveTo(toward(base).x, toward(base).y)
            lineTo(toward(tip).x, toward(tip).y)
            lineTo(toward(inner).x, toward(inner).y)
            close()
        }
        drawPath(innerEar, InnerEar)
    }
}
