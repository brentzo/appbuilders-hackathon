# Yumi design

The base design both apps share, so the Mac app, the Android app, and the cat look like one product.
[tokens.json](tokens.json) is the single source.
Change a value there, run `python character/design/build.py`, and every platform file updates.

## Files

| File | For | How to use it |
|---|---|---|
| [tokens.json](tokens.json) | Everyone | The source: colors (light and dark), cat palettes, type, spacing, radius, motion |
| [generated/Yumi.swift](generated/Yumi.swift) | Mac (SwiftUI) | Copy into `mac/Yumi`. Use `YumiColor.paper`, `YumiFont.body`, `YumiSpace.l`, `YumiRadius.panel`, `YumiMotion.moveAnimation`, `YumiCatColors.mint` |
| [generated/YumiTheme.kt](generated/YumiTheme.kt) | Android (Compose) | Copy into `android/app/src/main/java/ai/yumi/android/design/`. Wrap screens in `MaterialTheme(colorScheme = yumiColorScheme(isSystemInDarkTheme()), typography = yumiTypography())` |
| [generated/android/](generated/android) | Android (XML) | `values/` and `values-night/` color resources, including `ic_launcher_background` |
| [generated/tokens.css](generated/tokens.css) | Web, artifacts | CSS custom properties with light and dark values |

The app folders belong to their owners, so the generated files are copied in, not written there from here.
The Swift and Kotlin files are generated but have not been compiled yet; check them the first time you add them.

## Color rules

- **Ginger means go.** `accent` is the one action color: the primary button, listening, progress. Use one ginger button per panel, with `onAccent` text.
- **Never red.** Stuck, paused, and errors use `hush` lavender with `onHush` text and plain words (SPEC-04, SPEC-11). On Android, Material's `error` role is mapped to `hush`.
- **Coral is a coordinate.** `coral` appears only where the cat's paws land on a click, and on the cat's cheeks.
- **Cocoa, never black.** Headings and the wordmark use `brand`. Body text uses `ink`, secondary text uses `muted`, and `faint` is only for captions at 18 px or larger.
- **Paper, not white.** Screens sit on `paper`; cards and panels on `surface`; recessed areas on `paperDeep`.
- Every text pair passes WCAG AA (4.5:1) in both themes; `build.py` checks it and fails if a change breaks it.

## The cat's colors

| Palette | Fur | Markings | Line | Use |
|---|---|---|---|---|
| `ginger` | `#F0A76A` | `#F6DBB5` | `#6E413E` | The main cat, always |
| `mint` | `#86D6BE` | `#DDF3EA` | `#2F5A50` | First ghost cursor |
| `sky` | `#93BCF0` | `#E0EBFB` | `#30466B` | Second ghost cursor |
| `slate` | `#AEB4BE` | `#EEF0F3` | `#3B4049` | Third ghost cursor |

All cats keep coral cheeks.
Ghost labels use the ghost's fur as the chip color with its `labelText` color.
These are also the values for the Rive file's ghost color input.

## Type

- **Mac:** the system font everywhere, at the sizes in the type scale, so panels feel native.
- **Android and marketing:** Bricolage Grotesque for `display`, `title`, and `headline`; Instrument Sans for `body`, `label`, and `caption`; JetBrains Mono for `data` such as times and states.
- Times shown to users use am and pm.

## Spacing, shape, and motion

- Spacing is a 4-point scale: `xs` 4, `s` 8, `m` 12, `l` 16, `xl` 24, `xxl` 32.
- Radius by role: `control` 7 for Mac buttons, `field` 10, `panel` 16 for Mac panels, `card` 24 for Android cards, `pill` for chips.
- The cursor moves on a symmetric ease-in-out curve with an arc, in 350 ms for a short hop up to 700 ms across the screen (`moveDuration(distance:)`), and cursors fade out within 1 second (SPEC-04).
- With Reduce Motion on, leaps and pounces become simple glides.

## Logo and icons

The logo, its color variants, and every app icon are in [../assets](../assets/README.md).
The cat's states live in the Rive file, not in images.
