// Generated from character/design/tokens.json by character/design/build.py. Do not edit by hand.
package ai.yumi.android.design

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Yumi's colors for one appearance. */
data class YumiColors(
    val paper: Color,
    val paperDeep: Color,
    val surface: Color,
    val surfaceRaised: Color,
    val line: Color,
    val ink: Color,
    val muted: Color,
    val faint: Color,
    val brand: Color,
    val accent: Color,
    val onAccent: Color,
    val accentText: Color,
    val coral: Color,
    val halo: Color,
    val hush: Color,
    val onHush: Color,
)

object YumiPalette {
    val Light = YumiColors(
        paper = Color(0xFFF9F6E7),
        paperDeep = Color(0xFFF3EDDA),
        surface = Color(0xFFFFFDF6),
        surfaceRaised = Color(0xFFF4ECDA),
        line = Color(0xFFE7DCC4),
        ink = Color(0xFF3A2620),
        muted = Color(0xFF6F5A4F),
        faint = Color(0xFF9A887C),
        brand = Color(0xFF6E413E),
        accent = Color(0xFFF0A76A),
        onAccent = Color(0xFF3A2018),
        accentText = Color(0xFF9A4F17),
        coral = Color(0xFFED8770),
        halo = Color(0xFFF3E6CA),
        hush = Color(0xFFB7A8E8),
        onHush = Color(0xFF2A2440),
    )
    val Dark = YumiColors(
        paper = Color(0xFF17120F),
        paperDeep = Color(0xFF1F1814),
        surface = Color(0xFF261E19),
        surfaceRaised = Color(0xFF2F2620),
        line = Color(0xFF3E322A),
        ink = Color(0xFFF7EEDF),
        muted = Color(0xFFC4B3A2),
        faint = Color(0xFF8E7D6F),
        brand = Color(0xFFF0A76A),
        accent = Color(0xFFF0A76A),
        onAccent = Color(0xFF3A2018),
        accentText = Color(0xFFF0A76A),
        coral = Color(0xFFED8770),
        halo = Color(0xFF2B221C),
        hush = Color(0xFFB7A8E8),
        onHush = Color(0xFF2A2440),
    )
}

/** Maps Yumi's colors onto Material 3. Errors use hush (lavender), never red. */
fun yumiColorScheme(dark: Boolean): ColorScheme = if (dark) {
    darkColorScheme(
        primary = YumiPalette.Dark.accent,
        onPrimary = YumiPalette.Dark.onAccent,
        primaryContainer = YumiPalette.Dark.halo,
        onPrimaryContainer = YumiPalette.Dark.ink,
        inversePrimary = YumiPalette.Dark.accentText,
        secondary = YumiPalette.Dark.brand,
        onSecondary = YumiPalette.Dark.paper,
        secondaryContainer = YumiPalette.Dark.surfaceRaised,
        onSecondaryContainer = YumiPalette.Dark.ink,
        tertiary = YumiPalette.Dark.coral,
        onTertiary = YumiPalette.Dark.onAccent,
        background = YumiPalette.Dark.paper,
        onBackground = YumiPalette.Dark.ink,
        surface = YumiPalette.Dark.surface,
        onSurface = YumiPalette.Dark.ink,
        surfaceVariant = YumiPalette.Dark.surfaceRaised,
        onSurfaceVariant = YumiPalette.Dark.muted,
        error = YumiPalette.Dark.hush,
        onError = YumiPalette.Dark.onHush,
        errorContainer = YumiPalette.Dark.hush,
        onErrorContainer = YumiPalette.Dark.onHush,
        outline = YumiPalette.Dark.line,
        outlineVariant = YumiPalette.Dark.line,
    )
} else {
    lightColorScheme(
        primary = YumiPalette.Light.accent,
        onPrimary = YumiPalette.Light.onAccent,
        primaryContainer = YumiPalette.Light.halo,
        onPrimaryContainer = YumiPalette.Light.ink,
        inversePrimary = YumiPalette.Light.accentText,
        secondary = YumiPalette.Light.brand,
        onSecondary = YumiPalette.Light.paper,
        secondaryContainer = YumiPalette.Light.surfaceRaised,
        onSecondaryContainer = YumiPalette.Light.ink,
        tertiary = YumiPalette.Light.coral,
        onTertiary = YumiPalette.Light.onAccent,
        background = YumiPalette.Light.paper,
        onBackground = YumiPalette.Light.ink,
        surface = YumiPalette.Light.surface,
        onSurface = YumiPalette.Light.ink,
        surfaceVariant = YumiPalette.Light.surfaceRaised,
        onSurfaceVariant = YumiPalette.Light.muted,
        error = YumiPalette.Light.hush,
        onError = YumiPalette.Light.onHush,
        errorContainer = YumiPalette.Light.hush,
        onErrorContainer = YumiPalette.Light.onHush,
        outline = YumiPalette.Light.line,
        outlineVariant = YumiPalette.Light.line,
    )
}

/** One cat's colors. The main cat is always ginger; ghost littermates use their own. */
data class YumiCatPalette(val fur: Color, val markings: Color, val line: Color, val cheeks: Color)

object YumiCats {
    val ginger = YumiCatPalette(Color(0xFFF0A76A), Color(0xFFF6DBB5), Color(0xFF6E413E), Color(0xFFED8770))
    val mint = YumiCatPalette(Color(0xFF86D6BE), Color(0xFFDDF3EA), Color(0xFF2F5A50), Color(0xFFEE9A86))
    val sky = YumiCatPalette(Color(0xFF93BCF0), Color(0xFFE0EBFB), Color(0xFF30466B), Color(0xFFEE9A86))
    val slate = YumiCatPalette(Color(0xFFAEB4BE), Color(0xFFEEF0F3), Color(0xFF3B4049), Color(0xFFEE9A86))
    /** Ghost cursors take these in order. */
    val littermates = listOf(mint, sky, slate)
}

/** Text styles. Pass the loaded font families; the defaults fall back to the system fonts. */
fun yumiTypography(display: FontFamily = FontFamily.Default, text: FontFamily = FontFamily.Default, mono: FontFamily = FontFamily.Monospace): Typography {
    fun style(family: FontFamily, size: Int, line: Int, weight: Int) = TextStyle(fontFamily = family, fontSize = size.sp, lineHeight = line.sp, fontWeight = FontWeight(weight))
    return Typography(
        displaySmall = style(display, 40, 44, 800),
        titleLarge = style(display, 24, 28, 700),
        titleMedium = style(display, 19, 24, 650),
        bodyLarge = style(text, 15, 21, 400),
        bodyMedium = style(text, 15, 21, 400),
        labelLarge = style(text, 13, 18, 600),
        bodySmall = style(text, 12, 16, 400),
        labelSmall = style(mono, 12, 16, 400),
    )
}

object YumiSpace {
    val xxs = 2.dp
    val xs = 4.dp
    val s = 8.dp
    val m = 12.dp
    val l = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
    val xxxl = 48.dp
}

object YumiRadius {
    val control = 7.dp
    val field = 10.dp
    val panel = 16.dp
    val card = 24.dp
    val pill = 999.dp
}

object YumiMotion {
    const val MOVE_MIN_MS = 350
    const val MOVE_MAX_MS = 700
    const val MOVE_FAR_PT = 1200
    const val POUNCE_MS = 300
    const val FADE_OUT_MS = 1000
    const val PANEL_MS = 350
    const val AVOID_RADIUS_PT = 8
    const val AVOID_HOP_PT = 64
    const val AVOID_FADE_OPACITY = 0.25f
    const val AVOID_FADE_MS = 150
    const val AVOID_RETURN_MS = 1000
}
