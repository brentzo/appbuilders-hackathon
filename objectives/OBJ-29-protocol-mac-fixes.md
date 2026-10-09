---
id: OBJ-29
title: Protocol v3, fit the contracts to real macOS
product: protocol
assignee: Brent
touches: [models]
specs: [SPEC-05, SPEC-07]
status: in-progress
priority: p0
depends-on: [OBJ-01]
integrates-with: [OBJ-03, OBJ-26]
tags: [objective, p0, protocol]
---

# OBJ-29 Protocol v3, fit the contracts to real macOS

**Product:** [Protocol](../protocol/README.md) · **Also touches:** [models](../models/README.md) · **Specs:** [SPEC-05](../specs/05-mac-gui-control.md), [SPEC-07](../specs/07-safety.md) · **Assignee:** Brent

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and the phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The contracts were written without a real Mac, and the first real runs show they do not fit how macOS and the model behave.
In [OBJ-26](OBJ-26-gui-smoke-test.md), the model picked the right button in a Keynote dialog but called the action `click`, which the schema rejects, so every run failed.
An audit of the schemas against Apple's accessibility API found more gaps of the same kind: the model cannot see dialogs or focus, cannot select a row in a list, and password fields would never be recognized.
This objective fixes them in one breaking change, protocol version 3, before the harness ([OBJ-03](OBJ-03-harness-skeleton.md)) and the Mac app build on the old shapes.
Decided by Brent on 2026-10-09; Brent leads the change in Jepoy's product.

## Read first

- [SPEC-05](../specs/05-mac-gui-control.md) requirements 1, 2, 7, and 12, and [SPEC-07](../specs/07-safety.md) requirements 4 and 8.
- [protocol/README.md](../protocol/README.md), especially "Versioning", and the schemas in `protocol/schemas/`.
- [models/gui/SMOKE-TEST.md](../models/gui/SMOKE-TEST.md), round 1 and round 2, and `models/gui/smoke.py`.
- Apple's accessibility constants in the local SDK: `HIServices.framework/Headers/AXRoleConstants.h`, `AXAttributeConstants.h`, `AXActionConstants.h`.

## Tasks

- [ ] **OBJ-29.1** Rename the element press: `axPress {element}` becomes `click {element}`, and the p1 vision `click {x, y}` becomes `clickAt {x, y}`. Describe that `click` on a row or cell selects it (the Mac app sets `AXSelected`), and presses everything else with `AXPress`.
- [ ] **OBJ-29.2** Add roles to `AXRole`: `row`, `cell`, `comboBox`, `menuButton`, `disclosureTriangle`, and the scrollable containers `scrollArea`, `table`, `list`, `outline`, so the model can select rows and scroll the thing that scrolls. Document how macOS roles map: a password field is `AXTextField` with subrole `AXSecureTextField` and maps to `secureTextField`; a search field maps to `textField`; a tab is an `AXRadioButton` in an `AXTabGroup` and maps to `radioButton`.
- [ ] **OBJ-29.3** Add optional fields to `Observation`: `app` (the app's name), `focused` (the element number with keyboard focus, absent when nothing in the tree has focus), and `layer` (`kind`: window, sheet, dialog, alert, or menu; optional `title`, `defaultButton`, and `cancelButton` as element numbers). A sheet usually has no title on macOS.
- [ ] **OBJ-29.4** Add a rule the harness can apply: a `type` action is refused when the focused element is a `secureTextField` (SPEC-05 r7). Put it in the schema where JSON Schema can express it, otherwise in the schema description and the README, and add a test either way.
- [ ] **OBJ-29.5** `open_app` takes exactly one of `bundleId` or `name`; the Mac app resolves a name through Launch Services. Apple's ids are inconsistent (`com.apple.mail`, `com.apple.Notes`), so the model should not have to guess them.
- [ ] **OBJ-29.6** `open_file` takes an optional `bundleId` to open the file with a named app, for example a PDF with Mail to start a message with it attached. Record that the Mail behavior is not verified on a real Mac yet.
- [ ] **OBJ-29.7** Add `enter` (the keypad Enter key, different from `return` on a Mac) to the key combo pattern. Aliases such as `Cmd+S`, `esc`, or `backspace` are normalized by the harness, not the schema: note that in the description.
- [ ] **OBJ-29.8** In the `Path` description: Mac volumes are case-insensitive by default, so name clashes (SPEC-07 r4) and "a file Yumi did not create" checks compare names case-insensitively; and documents such as `.key` and `.pages` are folders (packages), so file tools must handle folders.
- [ ] **OBJ-29.9** Bump `ProtocolVersion` to 3. Run `npm run generate`. Update every example in `protocol/examples/`, the mocks, the tests (add tests for each rule above), `protocol/README.md`, and `docs/task-record-schema.md`.
- [ ] **OBJ-29.10** Update SPEC-05: requirement 1.2 says the model clicks elements through the accessibility API; requirement 2's role list matches the schema; add a requirement that the model sees the focused element and the front sheet, dialog, or menu, with a scenario; record the changes under Decisions, dated 2026-10-09. Run the spec-lifecycle skill.
- [ ] **OBJ-29.11** Update `models/gui/smoke.py` to the new action names, so the next OBJ-26 run measures the real contract. Do not run the model.

## Expectations

- [ ] `python3 scripts/verify.py` passes, including the protocol generated-types check, typecheck, and tests.
- [ ] Every example validates, and every new rule has a test that a wrong value fails.
- [ ] `grep -rn axPress` finds nothing outside history (`models/gui/results/`, `models/gui/SMOKE-TEST.md`, and this objective).
- [ ] SPEC-05 and the schemas name the same roles and actions.

## Expected outcomes

- Protocol version 3 schemas, generated TypeScript, Swift, and Kotlin, examples, mocks, and tests.
- SPEC-05 and the docs updated to match.
- A list of what the Mac app (Patrick) and the harness (OBJ-03) must change, in the Outcome.

## Out of scope

- Harness code, including normalizing key aliases and case-insensitive name checks: [OBJ-03](OBJ-03-harness-skeleton.md).
- Mac app code: Patrick's objectives. Name what they must change in the Outcome.
- Running the model or a new smoke test round: [OBJ-26](OBJ-26-gui-smoke-test.md).
- Mail quirks to check on a real Mac first: the message body is likely a web area whose value cannot be set, and the To field is a token field whose value may hold placeholder characters instead of addresses. List them in the Outcome for OBJ-26.

## Outcome

_Not finished yet. When this objective is done, replace this line with the outcome, following the objective-lifecycle skill._
