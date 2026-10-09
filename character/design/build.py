"""Generate the platform files from tokens.json and check text contrast.

Run: python character/design/build.py
Writes generated/Yumi.swift (macOS, SwiftUI), generated/YumiTheme.kt (Android, Compose),
generated/android/values*/yumi_colors.xml, and generated/tokens.css.
Fails if a text color misses its contrast target in either theme.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "generated")
T = json.load(open(os.path.join(HERE, "tokens.json"), encoding="utf-8"))
HEADER = "Generated from character/design/tokens.json by character/design/build.py. Do not edit by hand."

LIGHT = {k: v["value"] for k, v in T["color"]["light"].items()}
DARK = {k: v["value"] for k, v in T["color"]["dark"].items()}
CATS = {"ginger": T["cat"]["ginger"], **T["cat"]["littermates"]}
CAT_KEYS = ["fur", "markings", "line", "cheeks"]


# ---------- contrast ----------
def lum(hexv):
    c = [int(hexv[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


# (text, ground, minimum)
PAIRS = [
    ("ink", "paper", 4.5), ("ink", "surface", 4.5), ("ink", "paperDeep", 4.5), ("ink", "surfaceRaised", 4.5),
    ("muted", "paper", 4.5), ("muted", "surface", 4.5), ("muted", "surfaceRaised", 4.5),
    ("accentText", "paper", 4.5), ("accentText", "surface", 4.5),
    ("onAccent", "accent", 4.5), ("onHush", "hush", 4.5),
    ("brand", "paper", 3.0), ("faint", "paper", 3.0),
]
failed = False
print("Contrast (WCAG 2):")
for theme, pal in (("light", LIGHT), ("dark", DARK)):
    for fg, bg, need in PAIRS:
        r = ratio(pal[fg], pal[bg])
        ok = r >= need
        failed |= not ok
        print(f"  {theme:5} {fg:>10} on {bg:<13} {r:5.2f}  {'ok' if ok else 'FAIL'} (needs {need})")
for name, cat in CATS.items():
    label = T["cat"]["labelText"].get(name, T["color"]["light"]["onAccent"]["value"])
    r = ratio(label, cat["fur"])
    failed |= r < 4.5
    print(f"  label on {name:<6} {r:5.2f}  {'ok' if r >= 4.5 else 'FAIL'}")
if failed:
    sys.exit("Contrast check failed; fix tokens.json.")

os.makedirs(OUT, exist_ok=True)


def camel(s):
    return s[0].upper() + s[1:]


def hx(v):
    return v.lstrip("#").upper()


# ---------- Swift ----------
weights = {400: ".regular", 500: ".medium", 600: ".semibold", 650: ".semibold", 700: ".bold", 800: ".heavy"}
sw = [f"// {HEADER}",
      "// Every declaration is nonisolated: app targets that default to the main actor would otherwise",
      "// isolate the dynamic colors, which AppKit resolves off the main thread.",
      "import AppKit", "import SwiftUI", "",
      "/// Yumi's colors. Each one follows the system appearance (light or dark) on its own.",
      "nonisolated public enum YumiColor {"]
for k in LIGHT:
    sw.append(f"    /// {T['color']['light'][k]['usage']}")
    sw.append(f"    public static let {k} = dynamicColor(light: 0x{hx(LIGHT[k])}, dark: 0x{hx(DARK[k])})")
sw += ["}", "", "/// One cat's colors. The main cat is always ginger; ghost littermates use their own.",
       "nonisolated public struct YumiCatPalette: Sendable {",
       *[f"    public let {k}: Color" for k in CAT_KEYS], "}", "",
       "nonisolated public enum YumiCatColors {"]
for name, cat in CATS.items():
    args = ", ".join(f"{k}: rgbColor(0x{hx(cat[k])})" for k in CAT_KEYS)
    sw.append(f"    public static let {name} = YumiCatPalette({args})")
sw.append(f"    /// Ghost cursors take these in order.")
sw.append(f"    public static let littermates = [{', '.join(T['cat']['littermates'])}]")
sw += ["}", "", "/// Text styles. Mac panels use the system font so they feel native.", "nonisolated public enum YumiFont {"]
for s in T["type"]["scale"]:
    design = ", design: .monospaced" if s["family"] == "mono" else ""
    sw.append(f"    /// {s['usage']}")
    sw.append(f"    public static let {s['name']} = Font.system(size: {s['size']}, weight: {weights[s['weight']]}{design})")
sw += ["}", "", "nonisolated public enum YumiSpace {"] + [f"    public static let {k}: CGFloat = {v}" for k, v in T["space"].items()]
sw += ["}", "", "nonisolated public enum YumiRadius {"] + [f"    public static let {k}: CGFloat = {v}" for k, v in T["radius"].items()]
m = T["motion"]
e = m["easing"]
sw += ["}", "", "nonisolated public enum YumiMotion {",
       f"    /// A move takes moveMin for a short hop, growing with distance to moveMax at moveFar points.",
       f"    public static let moveMin: Double = {m['moveMinMs'] / 1000}",
       f"    public static let moveMax: Double = {m['moveMaxMs'] / 1000}",
       f"    public static let moveFar: CGFloat = {m['moveFarPt']}",
       f"    public static let pounce: Double = {m['pounceMs'] / 1000}",
       f"    public static let fadeOut: Double = {m['fadeOutMs'] / 1000}",
       f"    public static let panel: Double = {m['panelMs'] / 1000}",
       f"    /// The ease-in-out curve of a move, as cubic-bezier control points.",
       f"    public static let easing: (Double, Double, Double, Double) = ({e[0]}, {e[1]}, {e[2]}, {e[3]})",
       f"    /// A cat reacts when the pointer moves toward it and comes within avoidRadius points of its body (SPEC-04 r21).",
       f"    public static let avoidRadius: CGFloat = {m['avoidRadiusPt']}",
       f"    /// How see-through a cat gets while the pointer is near it, and how fast. Cats never move away.",
       f"    public static let avoidFadeOpacity: Double = {m['avoidFadeOpacity']}",
       f"    public static let avoidFade: Double = {m['avoidFadeMs'] / 1000}",
       f"    /// How long after the pointer leaves a cat fades back.",
       f"    public static let avoidReturn: Double = {m['avoidReturnMs'] / 1000}",
       "    /// How long a move of `distance` points takes.",
       "    public static func moveDuration(distance: CGFloat) -> Double {",
       "        moveMin + (moveMax - moveMin) * Double(min(max(distance / moveFar, 0), 1))",
       "    }",
       f"    /// The cursor's eased move over `distance`. With Reduce Motion on, use a straight glide instead.",
       "    public static func moveAnimation(distance: CGFloat) -> Animation {",
       "        Animation.timingCurve(easing.0, easing.1, easing.2, easing.3, duration: moveDuration(distance: distance))",
       "    }",
       "}", "",
       "nonisolated private func nsColor(_ hex: UInt32) -> NSColor {",
       "    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)",
       "}", "",
       "nonisolated private func rgbColor(_ hex: UInt32) -> Color { Color(nsColor: nsColor(hex)) }", "",
       "nonisolated private func dynamicColor(light: UInt32, dark: UInt32) -> Color {",
       "    Color(nsColor: NSColor(name: nil) { appearance in",
       "        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? nsColor(dark) : nsColor(light)",
       "    })",
       "}", ""]
open(os.path.join(OUT, "Yumi.swift"), "w", encoding="utf-8", newline="\n").write("\n".join(sw))

# ---------- Kotlin (Compose) ----------
SCHEME = [("primary", "accent"), ("onPrimary", "onAccent"), ("primaryContainer", "halo"), ("onPrimaryContainer", "ink"),
          ("inversePrimary", "accentText"), ("secondary", "brand"), ("onSecondary", "paper"),
          ("secondaryContainer", "surfaceRaised"), ("onSecondaryContainer", "ink"), ("tertiary", "coral"),
          ("onTertiary", "onAccent"), ("background", "paper"), ("onBackground", "ink"), ("surface", "surface"),
          ("onSurface", "ink"), ("surfaceVariant", "surfaceRaised"), ("onSurfaceVariant", "muted"),
          ("error", "hush"), ("onError", "onHush"), ("errorContainer", "hush"), ("onErrorContainer", "onHush"),
          ("outline", "line"), ("outlineVariant", "line"),
          # Every remaining role, so no Material default (purple tint, gray containers) shows through.
          ("tertiaryContainer", "halo"), ("onTertiaryContainer", "ink"), ("surfaceTint", "surface"),
          ("inverseSurface", "ink"), ("inverseOnSurface", "paper"), ("scrim", "ink"),
          ("surfaceBright", "surface"), ("surfaceDim", "paperDeep"), ("surfaceContainerLowest", "surface"),
          ("surfaceContainerLow", "surface"), ("surfaceContainer", "surface"), ("surfaceContainerHigh", "surface"),
          ("surfaceContainerHighest", "surfaceRaised")]
SCHEME_ARGS = "\n" + "".join(f"        {role} = {{p}}.{tok},\n" for role, tok in SCHEME) + "    "
kt = [f"// {HEADER}", "package ai.yumi.android.design", "",
      "import androidx.compose.animation.core.CubicBezierEasing",
      "import androidx.compose.animation.core.Easing",
      "import androidx.compose.material3.ColorScheme",
      "import androidx.compose.material3.Typography",
      "import androidx.compose.material3.darkColorScheme",
      "import androidx.compose.material3.lightColorScheme",
      "import androidx.compose.ui.graphics.Color",
      "import androidx.compose.ui.text.TextStyle",
      "import androidx.compose.ui.text.font.FontFamily",
      "import androidx.compose.ui.text.font.FontWeight",
      "import androidx.compose.ui.unit.dp",
      "import androidx.compose.ui.unit.sp", "",
      "/** Yumi's colors for one appearance. */",
      "data class YumiColors(", *[f"    val {k}: Color," for k in LIGHT], ")", "",
      "object YumiPalette {"]
for nm, pal in (("Light", LIGHT), ("Dark", DARK)):
    kt.append(f"    val {nm} = YumiColors(")
    kt += [f"        {k} = Color(0xFF{hx(v)})," for k, v in pal.items()]
    kt.append("    )")
kt += ["}", "",
       "/** Maps Yumi's colors onto Material 3. Errors use hush (lavender), never red. */",
       "fun yumiColorScheme(dark: Boolean): ColorScheme = if (dark) {",
       f"    darkColorScheme({SCHEME_ARGS.format(p='YumiPalette.Dark')})",
       "} else {",
       f"    lightColorScheme({SCHEME_ARGS.format(p='YumiPalette.Light')})",
       "}", "",
       "/** One cat's colors. The main cat is always ginger; ghost littermates use their own. */",
       "data class YumiCatPalette(val fur: Color, val markings: Color, val line: Color, val cheeks: Color)", "",
       "object YumiCats {"]
for name, cat in CATS.items():
    kt.append(f"    val {name} = YumiCatPalette(" + ", ".join(f"Color(0xFF{hx(cat[k])})" for k in CAT_KEYS) + ")")
kt += [f"    /** Ghost cursors take these in order. */",
       f"    val littermates = listOf({', '.join(T['cat']['littermates'])})", "}", "",
       "/** Text styles. Pass the loaded font families; the defaults fall back to the system fonts. */",
       "fun yumiTypography(display: FontFamily = FontFamily.Default, text: FontFamily = FontFamily.Default, mono: FontFamily = FontFamily.Monospace): Typography {",
       "    fun style(family: FontFamily, size: Int, line: Int, weight: Int) = TextStyle(fontFamily = family, fontSize = size.sp, lineHeight = line.sp, fontWeight = FontWeight(weight))"]
fam = {"display": "display", "text": "text", "mono": "mono"}
S = {s["name"]: s for s in T["type"]["scale"]}
st = lambda n: f"style({fam[S[n]['family']]}, {S[n]['size']}, {S[n]['lineHeight']}, {S[n]['weight']})"
kt += ["    return Typography(",
       f"        displaySmall = {st('display')},",
       f"        titleLarge = {st('title')},",
       f"        titleMedium = {st('headline')},",
       f"        bodyLarge = {st('body')},",
       f"        bodyMedium = {st('body')},",
       f"        labelLarge = {st('label')},",
       f"        bodySmall = {st('caption')},",
       f"        labelSmall = {st('data')},",
       "    )", "}", "",
       "object YumiSpace {"] + [f"    val {k} = {v}.dp" for k, v in T["space"].items()]
kt += ["}", "", "object YumiRadius {"] + [f"    val {k} = {v}.dp" for k, v in T["radius"].items()]
kt += ["}", "", "object YumiMotion {",
       f"    const val MOVE_MIN_MS = {m['moveMinMs']}", f"    const val MOVE_MAX_MS = {m['moveMaxMs']}",
       f"    const val MOVE_FAR_PT = {m['moveFarPt']}", f"    const val POUNCE_MS = {m['pounceMs']}",
       f"    const val FADE_OUT_MS = {m['fadeOutMs']}", f"    const val PANEL_MS = {m['panelMs']}",
       f"    const val AVOID_RADIUS_PT = {m['avoidRadiusPt']}",
       f"    const val AVOID_FADE_OPACITY = {m['avoidFadeOpacity']}f", f"    const val AVOID_FADE_MS = {m['avoidFadeMs']}",
       f"    const val AVOID_RETURN_MS = {m['avoidReturnMs']}",
       "    /** The symmetric ease in and out every move uses. */",
       f"    val easing: Easing = CubicBezierEasing({e[0]}f, {e[1]}f, {e[2]}f, {e[3]}f)", "}", ""]
open(os.path.join(OUT, "YumiTheme.kt"), "w", encoding="utf-8", newline="\n").write("\n".join(kt))

# ---------- Android resources ----------
for folder, pal in (("values", LIGHT), ("values-night", DARK)):
    d = os.path.join(OUT, "android", folder)
    os.makedirs(d, exist_ok=True)
    lines = ['<?xml version="1.0" encoding="utf-8"?>', f"<!-- {HEADER} -->", "<resources>"]
    lines += [f'    <color name="yumi_{k}">{v.upper()}</color>' for k, v in pal.items()]
    if folder == "values":
        lines += ['    <color name="ic_launcher_background">#F6DFBC</color>']
    lines += ["</resources>", ""]
    open(os.path.join(d, "yumi_colors.xml"), "w", encoding="utf-8", newline="\n").write("\n".join(lines))

# ---------- CSS ----------
kebab = lambda s: "".join("-" + c.lower() if c.isupper() else c for c in s)
css = [f"/* {HEADER} */", ":root {"]
css += [f"  --yumi-{kebab(k)}: {v};" for k, v in LIGHT.items()]
for name, cat in CATS.items():
    css += [f"  --yumi-cat-{name}-{k}: {cat[k]};" for k in CAT_KEYS]
css += [f"  --yumi-space-{k}: {v}px;" for k, v in T["space"].items()]
css += [f"  --yumi-radius-{k}: {v}px;" for k, v in T["radius"].items()]
css += [f'  --yumi-font-display: "{T["type"]["families"]["display"]}", system-ui, sans-serif;',
        f'  --yumi-font-text: "{T["type"]["families"]["text"]}", system-ui, sans-serif;',
        f'  --yumi-font-mono: "{T["type"]["families"]["mono"]}", ui-monospace, monospace;',
        f"  --yumi-move-min: {m['moveMinMs']}ms;", f"  --yumi-move-max: {m['moveMaxMs']}ms;", f"  --yumi-ease: cubic-bezier({', '.join(map(str, e))});", "}"]
dark_vars = [f"  --yumi-{kebab(k)}: {v};" for k, v in DARK.items()]
css += ["@media (prefers-color-scheme: dark) {", '  :root:not([data-theme="light"]) {'] + ["  " + l for l in dark_vars] + ["  }", "}"]
css += [':root[data-theme="dark"] {'] + dark_vars + ["}", ""]
open(os.path.join(OUT, "tokens.css"), "w", encoding="utf-8", newline="\n").write("\n".join(css))
print("Wrote", ", ".join(sorted(os.listdir(OUT))))
