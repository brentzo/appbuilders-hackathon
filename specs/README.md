# Specs

Requirement specs for Yumi.
Design background lives in [docs](../docs/yumi.md).

Each spec is one feature.
It has frontmatter tags, plain-language requirements, and Gherkin scenarios.
Scenarios carry the same tags as Gherkin `@tags`, so they can later move into `.feature` files unchanged.

## Tags

| Tag | Meaning |
|---|---|
| `p0` | Needed for the hackathon demo |
| `p1` | Should have, build after every `p0` works end to end |
| `p2` | Later |
| `mac`, `android`, `iphone` | Device the requirement applies to |
| `voice`, `harness`, `gui`, `bridge`, `safety`, `ux` | Area |

## Index

| ID | Spec | Priority | Devices |
|---|---|---|---|
| SPEC-01 | [Voice intake and confirmation](01-voice-intake.md) | p0 | mac, android |
| SPEC-02 | [Task lifecycle and resume](02-task-lifecycle.md) | p0 | mac, android |
| SPEC-03 | [Lane routing and handoff](03-lane-routing.md) | p0 | mac |
| SPEC-04 | [Cursor presence](04-cursor-presence.md) | p0 | mac |
| SPEC-05 | [Mac GUI control](05-mac-gui-control.md) | p0 | mac |
| SPEC-06 | [User control and interrupts](06-user-control.md) | p0 | mac, android |
| SPEC-07 | [Safety and action log](07-safety.md) | p0 | mac, android |
| SPEC-08 | [Device bridge](08-device-bridge.md) | p0 | mac, android |
| SPEC-09 | [Cross-device routing](09-cross-device-routing.md) | p0 | mac, android |
| SPEC-10 | [Yumi on Android](10-android-companion.md) | p0 (part A), p1 (part B) | android |
| SPEC-11 | [User-facing errors](11-user-facing-errors.md) | p0 | mac, android |
| SPEC-12 | [Yumi on iPhone](12-iphone-companion.md) | p2 | iphone |

## Conventions

- The product is called **Yumi**. The wake word is "Hey Yumi".
- Spoken and on-screen copy in scenarios is real copy, not placeholders. Change it here first, then in code.
- Every error a user can hit follows [SPEC-11](11-user-facing-errors.md): what happened, why, what to do next. No status codes, exception text, or vendor wording ever reaches the user.
- Times shown to users use am/pm.
