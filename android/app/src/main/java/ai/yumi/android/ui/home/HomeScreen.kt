package ai.yumi.android.ui.home

import ai.yumi.android.R
import ai.yumi.android.errors.PresentedButton
import ai.yumi.android.errors.PresentedError
import ai.yumi.android.notifications.connectionTextRes
import ai.yumi.android.protocol.ConnectionState
import ai.yumi.android.ui.cat.CatState
import ai.yumi.android.ui.cat.LocalCatRenderer
import ai.yumi.android.ui.components.ErrorCard
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** A notice at the top of the home screen with one action, for things that stop Yumi working in the background. */
data class HomeNotice(val title: Int, val body: Int, val action: Int, val onAction: () -> Unit)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    listening: Boolean,
    connection: ConnectionState,
    notices: List<HomeNotice>,
    lastGoal: String?,
    error: PresentedError?,
    onErrorButton: (PresentedButton) -> Unit,
    onMic: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleLarge) },
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.home_settings))
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                notices.forEach { NoticeCard(it) }
                Spacer(Modifier.height(if (notices.isEmpty()) 32.dp else 12.dp))
                LocalCatRenderer.current.Cat(
                    if (listening) CatState.Listening else CatState.Idle,
                    Modifier.size(220.dp),
                )
                Text(
                    stringResource(if (listening) R.string.home_hint_listening else R.string.home_hint_idle),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                if (lastGoal != null) GoalCard(lastGoal)
                AnimatedVisibility(visible = error != null) {
                    if (error != null) ErrorCard(error, onErrorButton, Modifier.padding(top = 4.dp))
                }
                Spacer(Modifier.height(12.dp))
            }
            ConnectionLine(connection)
            Spacer(Modifier.height(20.dp))
            MicButton(listening, onMic)
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
private fun NoticeCard(notice: HomeNotice) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        ),
    ) {
        Column(Modifier.padding(start = 20.dp, end = 12.dp, top = 16.dp, bottom = 8.dp)) {
            Text(stringResource(notice.title), style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            Text(stringResource(notice.body), style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = notice.onAction, modifier = Modifier.align(Alignment.End)) {
                Text(stringResource(notice.action))
            }
        }
    }
}

@Composable
private fun GoalCard(text: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
            Text(
                stringResource(R.string.home_you_said),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))
            Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun ConnectionLine(connection: ConnectionState) {
    val dot = when (connection) {
        ConnectionState.Connected -> Color(0xFF3FA66A)
        ConnectionState.Reconnecting -> Color(0xFFE0A030)
        ConnectionState.Offline, ConnectionState.NotPaired -> MaterialTheme.colorScheme.outline
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        Box(Modifier.size(8.dp).background(dot, CircleShape))
        Text(
            stringResource(connectionTextRes(connection)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun MicButton(listening: Boolean, onClick: () -> Unit) {
    val container by animateColorAsState(
        if (listening) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.primaryContainer,
        label = "micContainer",
    )
    val content by animateColorAsState(
        if (listening) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onPrimaryContainer,
        label = "micContent",
    )
    FilledIconButton(
        onClick = onClick,
        modifier = Modifier.size(80.dp),
        shape = CircleShape,
        colors = IconButtonDefaults.filledIconButtonColors(containerColor = container, contentColor = content),
    ) {
        Icon(
            painterResource(if (listening) R.drawable.ic_stop else R.drawable.ic_mic),
            contentDescription = stringResource(if (listening) R.string.home_mic_stop else R.string.home_mic_start),
            modifier = Modifier.size(32.dp),
        )
    }
}
