package ai.yumi.android.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

data class YumiSettings(
    /** Whether the first-run setup has been shown to the end. */
    val onboardingDone: Boolean = false,
    /** Listen for "Hey Yumi" in the background (SPEC-01). */
    val wakeWordEnabled: Boolean = true,
    /** Keep the foreground service running. Turned off by "Stop" in the notification. */
    val runInBackground: Boolean = true,
    /** Android permissions Yumi has already asked for once, to tell "never asked" from "denied for good". */
    val askedPermissions: Set<String> = emptySet(),
)

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "yumi_settings")

class SettingsStore(context: Context, scope: CoroutineScope) {
    private val store = context.applicationContext.dataStore

    /** Null until the first read from disk finishes. */
    val settings: StateFlow<YumiSettings?> = store.data
        .map { prefs ->
            YumiSettings(
                onboardingDone = prefs[ONBOARDING_DONE] ?: false,
                wakeWordEnabled = prefs[WAKE_WORD_ENABLED] ?: true,
                runInBackground = prefs[RUN_IN_BACKGROUND] ?: true,
                askedPermissions = prefs[ASKED_PERMISSIONS] ?: emptySet(),
            )
        }
        .stateIn(scope, SharingStarted.Eagerly, null)

    suspend fun setOnboardingDone() = store.edit { it[ONBOARDING_DONE] = true }

    suspend fun setWakeWordEnabled(enabled: Boolean) = store.edit { it[WAKE_WORD_ENABLED] = enabled }

    suspend fun setRunInBackground(enabled: Boolean) = store.edit { it[RUN_IN_BACKGROUND] = enabled }

    suspend fun markPermissionAsked(permission: String) = store.edit {
        it[ASKED_PERMISSIONS] = (it[ASKED_PERMISSIONS] ?: emptySet()) + permission
    }

    private companion object {
        val ONBOARDING_DONE = booleanPreferencesKey("onboarding_done")
        val WAKE_WORD_ENABLED = booleanPreferencesKey("wake_word_enabled")
        val RUN_IN_BACKGROUND = booleanPreferencesKey("run_in_background")
        val ASKED_PERMISSIONS = stringSetPreferencesKey("asked_permissions")
    }
}
