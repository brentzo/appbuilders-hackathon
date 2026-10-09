package ai.yumi.android.ui.cat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier

/** The cat states the Android app shows today. Grows with the character state machine contract (OBJ-10). */
enum class CatState { Idle, Listening, Stuck }

/**
 * Draws Yumi. The screens only talk to this interface, so the Rive cat (`character/yumi-cat.riv`, OBJ-10)
 * replaces [MarkCatRenderer] by providing a different [LocalCatRenderer], with no screen changes.
 */
interface CatRenderer {
    /** [playful] lets the user tap the cat for a short happy reaction, on the home screen. */
    @Composable
    fun Cat(state: CatState, modifier: Modifier, playful: Boolean = false)
}

val LocalCatRenderer = staticCompositionLocalOf<CatRenderer> { MarkCatRenderer }
