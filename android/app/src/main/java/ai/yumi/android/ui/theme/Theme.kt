package ai.yumi.android.ui.theme

import ai.yumi.android.design.YumiColors
import ai.yumi.android.design.YumiPalette
import ai.yumi.android.design.yumiColorScheme
import ai.yumi.android.design.yumiTypography
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

private val LocalYumiColors = staticCompositionLocalOf { YumiPalette.Light }

/** The design tokens from character/design for the current appearance. Material's roles map onto the same tokens. */
object Yumi {
    val colors: YumiColors
        @Composable @ReadOnlyComposable
        get() = LocalYumiColors.current
}

@Composable
fun YumiTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val tokens = yumiTypography()
    // The tokens name seven styles. The Material styles they leave out take the nearest one,
    // so dialogs and list items never fall back to Material's own sizes.
    val typography = tokens.copy(
        headlineSmall = tokens.titleLarge,
        titleSmall = tokens.labelLarge,
        labelMedium = tokens.bodySmall,
    )
    CompositionLocalProvider(LocalYumiColors provides if (darkTheme) YumiPalette.Dark else YumiPalette.Light) {
        MaterialTheme(colorScheme = yumiColorScheme(darkTheme), typography = typography, content = content)
    }
}
