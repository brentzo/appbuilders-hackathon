package ai.yumi.android.ui.components

import ai.yumi.android.design.YumiRadius
import ai.yumi.android.design.YumiSpace
import ai.yumi.android.ui.theme.Yumi
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** A card: surface on a hairline, with the panel radius, like the Mac's floating cards. */
@Composable
fun YumiCard(
    modifier: Modifier = Modifier,
    color: Color = Yumi.colors.surface,
    border: Color = Yumi.colors.line,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(YumiRadius.panel)
    Column(
        modifier
            .fillMaxWidth()
            .background(color, shape)
            .border(1.dp, border, shape)
            .padding(YumiSpace.l),
        content = content,
    )
}

/** A short state word on a capsule, like the Mac's cursor rows. */
@Composable
fun StatePill(text: String, container: Color, content: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .background(container, RoundedCornerShape(YumiRadius.pill))
            .padding(horizontal = YumiSpace.m - YumiSpace.xxs, vertical = YumiSpace.xxs + 1.dp),
    ) {
        Text(text, style = MaterialTheme.typography.bodySmall, color = content, textAlign = TextAlign.Center, maxLines = 1)
    }
}

/** The one ginger action of a screen ("ginger means go"), or the quiet raised button for every other action. */
@Composable
fun YumiButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = true,
    large: Boolean = false,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val colors = Yumi.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    // A small, fast press: the button heard the tap.
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, tween(120), label = "press")
    val shape = RoundedCornerShape(if (large) YumiRadius.panel else YumiRadius.field)
    Button(
        onClick = onClick,
        enabled = enabled,
        interactionSource = interaction,
        shape = shape,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (primary) colors.accent else colors.surfaceRaised,
            contentColor = if (primary) colors.onAccent else colors.ink,
            disabledContainerColor = (if (primary) colors.accent else colors.surfaceRaised).copy(alpha = 0.45f),
            disabledContentColor = (if (primary) colors.onAccent else colors.ink).copy(alpha = 0.45f),
        ),
        border = if (primary) null else BorderStroke(1.dp, colors.line),
        elevation = null,
        contentPadding = if (large) PaddingValues(horizontal = YumiSpace.xl, vertical = YumiSpace.m) else PaddingValues(horizontal = YumiSpace.l, vertical = YumiSpace.s),
        modifier = modifier
            .defaultMinSize(minHeight = if (large) 52.dp else 40.dp)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            },
        content = content,
    )
}

/** A small section heading above a group of cards. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = Yumi.colors.muted,
        modifier = modifier.padding(start = YumiSpace.xs, bottom = YumiSpace.s),
    )
}
