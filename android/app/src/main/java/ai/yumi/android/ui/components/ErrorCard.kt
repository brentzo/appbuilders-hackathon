package ai.yumi.android.ui.components

import ai.yumi.android.design.YumiSpace
import ai.yumi.android.errors.PresentedButton
import ai.yumi.android.errors.PresentedError
import ai.yumi.android.ui.theme.Yumi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.compositeOver

/** Shows a [PresentedError]: the SPEC-11 text and its buttons. The first button is the main next step. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ErrorCard(error: PresentedError, onButton: (PresentedButton) -> Unit, modifier: Modifier = Modifier) {
    HushCard(modifier) {
        Text(error.text, style = MaterialTheme.typography.bodyLarge, color = Yumi.colors.ink)
        Spacer(Modifier.height(YumiSpace.m))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(YumiSpace.s),
            verticalArrangement = Arrangement.spacedBy(YumiSpace.s),
        ) {
            error.buttons.forEachIndexed { index, button ->
                YumiButton(onClick = { onButton(button) }, primary = index == 0) { Text(button.label) }
            }
        }
    }
}

/** A card for trouble and things that need the user: tinted hush lavender, never red (SPEC-11). */
@Composable
fun HushCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val colors = Yumi.colors
    YumiCard(
        modifier = modifier,
        color = colors.hush.copy(alpha = 0.16f).compositeOver(colors.surface),
        border = colors.hush.copy(alpha = 0.55f).compositeOver(colors.surface),
        content = content,
    )
}
