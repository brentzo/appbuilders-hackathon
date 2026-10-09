package ai.yumi.android.ui.components

import ai.yumi.android.errors.PresentedButton
import ai.yumi.android.errors.PresentedError
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Shows a [PresentedError]: the SPEC-11 text and its buttons. The first button is the main next step. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ErrorCard(error: PresentedError, onButton: (PresentedButton) -> Unit, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(error.text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                error.buttons.forEachIndexed { index, button ->
                    if (index == 0) {
                        Button(onClick = { onButton(button) }) { Text(button.label) }
                    } else {
                        OutlinedButton(onClick = { onButton(button) }) { Text(button.label) }
                    }
                }
            }
        }
    }
}
