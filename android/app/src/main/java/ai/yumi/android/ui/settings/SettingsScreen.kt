package ai.yumi.android.ui.settings

import ai.yumi.android.R
import ai.yumi.android.design.YumiSpace
import ai.yumi.android.ui.components.SectionLabel
import ai.yumi.android.ui.components.YumiButton
import ai.yumi.android.ui.components.YumiCard
import ai.yumi.android.ui.theme.Yumi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class SettingsState(
    val wakeWordEnabled: Boolean,
    val microphoneAllowed: Boolean,
    /** Null on Android 12, where notifications need no runtime permission. */
    val notificationsAllowed: Boolean?,
    val runInBackground: Boolean,
    val batteryUnrestricted: Boolean,
    val showTesting: Boolean,
    /** The wake word as the user says it. */
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

@Composable
fun SettingsScreen(state: SettingsState, actions: SettingsActions) {
    val colors = Yumi.colors
    Column(
        Modifier
            .fillMaxSize()
            .background(colors.paper)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = YumiSpace.xs, end = YumiSpace.l, top = YumiSpace.s),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = actions.onBack) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.settings_back),
                    tint = colors.ink,
                )
            }
            Spacer(Modifier.width(YumiSpace.xs))
            Text(
                stringResource(R.string.settings_title),
                style = MaterialTheme.typography.titleLarge,
                color = colors.brand,
                modifier = Modifier.semantics { heading() },
            )
        }
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = YumiSpace.l, vertical = YumiSpace.m),
        ) {
            Section(R.string.settings_section_voice) {
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
            }

            Section(R.string.settings_section_mac) {
                Row(
                    title = R.string.settings_pairing,
                    body = stringResource(R.string.settings_pairing_body),
                    trailing = {
                        YumiButton(onClick = {}, primary = false, enabled = false) { Text(stringResource(R.string.settings_pair_now)) }
                    },
                )
            }

            Section(R.string.settings_section_background) {
                SwitchRow(
                    title = R.string.settings_run_in_background,
                    body = stringResource(R.string.settings_run_in_background_body, state.wakePhrase),
                    checked = state.runInBackground,
                    onCheckedChange = actions.onRunInBackgroundChange,
                )
                Hairline()
                Row(
                    title = R.string.settings_battery,
                    body = stringResource(
                        if (state.batteryUnrestricted) R.string.settings_battery_unrestricted else R.string.settings_battery_limited,
                    ),
                    trailing = if (state.batteryUnrestricted) {
                        null
                    } else {
                        { YumiButton(onClick = actions.onAllowBattery) { Text(stringResource(R.string.settings_battery_allow)) } }
                    },
                )
                Hairline()
                Text(
                    stringResource(R.string.settings_battery_maker),
                    style = Caption,
                    color = colors.muted,
                )
                Spacer(Modifier.height(YumiSpace.m))
                YumiButton(onClick = actions.onOpenAppSettings, primary = false) {
                    Text(stringResource(R.string.settings_open_app_settings))
                }
            }

            Section(R.string.settings_section_permissions) {
                PermissionRow(R.string.settings_microphone, state.microphoneAllowed, actions.onAllowMicrophone)
                state.notificationsAllowed?.let {
                    Hairline()
                    PermissionRow(R.string.settings_notifications, it, actions.onAllowNotifications)
                }
            }

            if (state.showTesting) {
                Section(R.string.settings_section_testing) {
                    Row(
                        title = R.string.settings_test_tool,
                        body = stringResource(R.string.settings_test_tool_body),
                        trailing = {
                            YumiButton(onClick = actions.onRunTestTool, primary = false) { Text(stringResource(R.string.settings_test_tool_run)) }
                        },
                    )
                    Hairline()
                    Row(
                        title = R.string.settings_stand_ins,
                        body = stringResource(R.string.settings_stand_ins_body),
                        trailing = null,
                    )
                }
            }
        }
    }
}

/** Captions under a row title: a step up from the token caption, so two lines stay easy to read. */
private val Caption
    @Composable get() = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp, lineHeight = 18.sp)

/** A labeled group of rows on one card, with hairlines between rows. */
@Composable
private fun Section(title: Int, content: @Composable ColumnScope.() -> Unit) {
    SectionLabel(stringResource(title), Modifier.padding(top = YumiSpace.s).semantics { heading() })
    YumiCard(content = content)
    Spacer(Modifier.height(YumiSpace.l))
}

@Composable
private fun Hairline() {
    Box(Modifier.fillMaxWidth().padding(vertical = YumiSpace.m).height(1.dp).background(Yumi.colors.line))
}

@Composable
private fun Row(title: Int, body: String, trailing: (@Composable () -> Unit)?, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                stringResource(title),
                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
                color = Yumi.colors.ink,
            )
            Spacer(Modifier.height(YumiSpace.xxs))
            Text(body, style = Caption, color = Yumi.colors.muted)
        }
        if (trailing != null) {
            Spacer(Modifier.width(YumiSpace.m))
            trailing()
        }
    }
}

@Composable
private fun SwitchRow(title: Int, body: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val colors = Yumi.colors
    Row(
        title = title,
        body = body,
        trailing = {
            Switch(
                checked = checked,
                onCheckedChange = null,
                colors = SwitchDefaults.colors(
                    checkedTrackColor = colors.accent,
                    checkedThumbColor = colors.surface,
                    checkedBorderColor = colors.accent,
                    uncheckedTrackColor = colors.surfaceRaised,
                    uncheckedThumbColor = colors.faint,
                    uncheckedBorderColor = colors.faint,
                ),
            )
        },
        modifier = Modifier.toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange),
    )
}

@Composable
private fun PermissionRow(title: Int, allowed: Boolean, onAllow: () -> Unit) {
    Row(
        title = title,
        body = stringResource(if (allowed) R.string.settings_allowed else R.string.settings_not_allowed),
        trailing = if (allowed) {
            null
        } else {
            { YumiButton(onClick = onAllow) { Text(stringResource(R.string.settings_allow)) } }
        },
    )
}
