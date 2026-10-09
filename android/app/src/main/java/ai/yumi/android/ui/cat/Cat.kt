package ai.yumi.android.ui.cat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier

/** The cat states the Android app shows today. Grows with the character state machine contract (OBJ-10). */
enum class CatState { Idle, Listening }

/**
 * Draws Yumi. The home screen only talks to this interface, so the Rive cat (`character/yumi-cat.riv`, OBJ-10)
 * replaces [PlaceholderCatRenderer] by providing a different [LocalCatRenderer], with no screen changes.
 */
interface CatRenderer {
    @Composable
    fun Cat(state: CatState, modifier: Modifier)
}

val LocalCatRenderer = staticCompositionLocalOf<CatRenderer> { PlaceholderCatRenderer }
