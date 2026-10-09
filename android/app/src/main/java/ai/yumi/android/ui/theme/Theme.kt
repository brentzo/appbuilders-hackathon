package ai.yumi.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// A warm palette built around Yumi's orange fur. Every surface role is set, so no default purple tint shows through.
private val LightColors = lightColorScheme(
    primary = Color(0xFF96491F),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFFFDBCC),
    onPrimaryContainer = Color(0xFF773309),
    inversePrimary = Color(0xFFFFB693),
    secondary = Color(0xFF77574A),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFFFDBCC),
    onSecondaryContainer = Color(0xFF5D4034),
    tertiary = Color(0xFF665F31),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFEEE4A9),
    onTertiaryContainer = Color(0xFF4E471C),
    background = Color(0xFFFFF8F6),
    onBackground = Color(0xFF231A16),
    surface = Color(0xFFFFF8F6),
    onSurface = Color(0xFF231A16),
    surfaceVariant = Color(0xFFF5DED5),
    onSurfaceVariant = Color(0xFF53433D),
    surfaceTint = Color(0xFF96491F),
    inverseSurface = Color(0xFF392E2A),
    inverseOnSurface = Color(0xFFFFEDE7),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF93000A),
    outline = Color(0xFF85736C),
    outlineVariant = Color(0xFFD8C2BA),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFFFFF8F6),
    surfaceDim = Color(0xFFE8D6D0),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFFF1EC),
    surfaceContainer = Color(0xFFFCEAE4),
    surfaceContainerHigh = Color(0xFFF6E5DE),
    surfaceContainerHighest = Color(0xFFF1DFD9),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFFFB693),
    onPrimary = Color(0xFF562000),
    primaryContainer = Color(0xFF773309),
    onPrimaryContainer = Color(0xFFFFDBCC),
    inversePrimary = Color(0xFF96491F),
    secondary = Color(0xFFE7BDAD),
    onSecondary = Color(0xFF442A1F),
    secondaryContainer = Color(0xFF5D4034),
    onSecondaryContainer = Color(0xFFFFDBCC),
    tertiary = Color(0xFFD1C88F),
    onTertiary = Color(0xFF363107),
    tertiaryContainer = Color(0xFF4E471C),
    onTertiaryContainer = Color(0xFFEEE4A9),
    background = Color(0xFF1A120E),
    onBackground = Color(0xFFF1DFD9),
    surface = Color(0xFF1A120E),
    onSurface = Color(0xFFF1DFD9),
    surfaceVariant = Color(0xFF53433D),
    onSurfaceVariant = Color(0xFFD8C2BA),
    surfaceTint = Color(0xFFFFB693),
    inverseSurface = Color(0xFFF1DFD9),
    inverseOnSurface = Color(0xFF392E2A),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = Color(0xFFA08D85),
    outlineVariant = Color(0xFF53433D),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFF423733),
    surfaceDim = Color(0xFF1A120E),
    surfaceContainerLowest = Color(0xFF140C09),
    surfaceContainerLow = Color(0xFF231A16),
    surfaceContainer = Color(0xFF271E1A),
    surfaceContainerHigh = Color(0xFF322824),
    surfaceContainerHighest = Color(0xFF3D332E),
)

@Composable
fun YumiTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
}
