package ai.yumi.android.ui.settings

import ai.yumi.android.R
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

data class SettingsState(
    val wakeWordEnabled: Boolean,
    val microphoneAllowed: Boolean,
    /** Null on Android 12, where notifications need no runtime permission. */
    val notificationsAllowed: Boolean?,
    val runInBackground: Boolean,
    val batteryUnrestricted: Boolean,
    val showTesting: Boolean,
    /** The wake word as the user says it. A stand-in until the "Hey Yumi" model exists. */
    val wakePhrase: String,
)

class SettingsActions(
    val onBack: () -> Unit,
    val onWakeWordChange: (Boolean) -> Unit,
    val onRunInBackgroundChange: (Boolean) -> Unit,
    val onAllowBattery: () -> Unit,
    val onOpenAppSettings: () -> Unit,
    val onAllowMicrophone: () -> Unit,
    val onAllowNotifications: () -> Unit,
    val onRunTestTool: () -> Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(state: SettingsState, actions: SettingsActions) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = {
                    IconButton(onClick = actions.onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.settings_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            Section(R.string.settings_section_voice)
            SwitchRow(
                title = R.string.settings_wake_word,
                body = stringResource(
                    if (state.wakeWordEnabled && !state.microphoneAllowed) {
                        R.string.settings_wake_word_needs_mic
                    } else {
                        R.string.settings_wake_word_body
                    },
                    state.wakePhrase,
                ),
                checked = state.wakeWordEnabled,
                onCheckedChange = actions.onWakeWordChange,
            )

            Divider()
            Section(R.string.settings_section_mac)
            Row(
                title = R.string.settings_pairing,
                body = stringResource(R.string.settings_pairing_body),
                trailing = {
                    OutlinedButton(onClick = {}, enabled = false) { Text(stringResource(R.string.settings_pair_now)) }
                },
            )

            Divider()
            Section(R.string.settings_section_background)
            SwitchRow(
                title = R.string.settings_run_in_background,
                body = stringResource(R.string.settings_run_in_background_body, state.wakePhrase),
                checked = state.runInBackground,
                onCheckedChange = actions.onRunInBackgroundChange,
            )
            Row(
                title = R.string.settings_battery,
                body = stringResource(
                    if (state.batteryUnrestricted) R.string.settings_battery_unrestricted else R.string.settings_battery_limited,
                ),
                trailing = if (state.batteryUnrestricted) {
                    null
                } else {
                    { TextButton(onClick = actions.onAllowBattery) { Text(stringResource(R.string.settings_battery_allow)) } }
                },
            )
            Text(
                stringResource(R.string.settings_battery_maker),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            TextButton(onClick = actions.onOpenAppSettings, modifier = Modifier.padding(horizontal = 4.dp)) {
                Text(stringResource(R.string.settings_open_app_settings))
            }

            Divider()
            Section(R.string.settings_section_permissions)
            PermissionRow(R.string.settings_microphone, state.microphoneAllowed, actions.onAllowMicrophone)
            state.notificationsAllowed?.let {
                PermissionRow(R.string.settings_notifications, it, actions.onAllowNotifications)
            }

            if (state.showTesting) {
                Divider()
                Section(R.string.settings_section_testing)
                Row(
                    title = R.string.settings_test_tool,
                    body = stringResource(R.string.settings_test_tool_body),
                    trailing = { TextButton(onClick = actions.onRunTestTool) { Text(stringResource(R.string.settings_test_tool_run)) } },
                )
                Row(
                    title = R.string.settings_stand_ins,
                    body = stringResource(R.string.settings_stand_ins_body, state.wakePhrase),
                    trailing = null,
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Section(title: Int) {
    Text(
        stringResource(title),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 4.dp),
    )
}

@Composable
private fun Divider() = HorizontalDivider(Modifier.padding(top = 12.dp), color = MaterialTheme.colorScheme.outlineVariant)

@Composable
private fun Row(title: Int, body: String, trailing: (@Composable () -> Unit)?) {
    ListItem(
        headlineContent = { Text(stringResource(title)) },
        supportingContent = { Text(body) },
        trailingContent = trailing,
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
    )
}

@Composable
private fun SwitchRow(title: Int, body: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(stringResource(title)) },
        supportingContent = { Text(body) },
        trailingContent = { Switch(checked = checked, onCheckedChange = null) },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
        modifier = Modifier.toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange),
    )
}

@Composable
private fun PermissionRow(title: Int, allowed: Boolean, onAllow: () -> Unit) {
    ListItem(
        headlineContent = { Text(stringResource(title)) },
        supportingContent = { Text(stringResource(if (allowed) R.string.settings_allowed else R.string.settings_not_allowed)) },
        trailingContent = if (allowed) {
            null
        } else {
            { TextButton(onClick = onAllow) { Text(stringResource(R.string.settings_allow)) } }
        },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.background),
    )
}
