---
id: OBJ-29
title: Protocol v3, fit the contracts to real macOS
product: protocol
assignee: Brent
touches: [models]
specs: [SPEC-05, SPEC-07]
status: done
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

- [x] **OBJ-29.1** Rename the element press: `axPress {element}` becomes `click {element}`, and the p1 vision `click {x, y}` becomes `clickAt {x, y}`. Describe that `click` on a row or cell selects it (the Mac app sets `AXSelected`), and presses everything else with `AXPress`.
- [x] **OBJ-29.2** Add roles to `AXRole`: `row`, `cell`, `comboBox`, `menuButton`, `disclosureTriangle`, and the scrollable containers `scrollArea`, `table`, `list`, `outline`, so the model can select rows and scroll the thing that scrolls. Document how macOS roles map: a password field is `AXTextField` with subrole `AXSecureTextField` and maps to `secureTextField`; a search field maps to `textField`; a tab is an `AXRadioButton` in an `AXTabGroup` and maps to `radioButton`.
- [x] **OBJ-29.3** Add optional fields to `Observation`: `app` (the app's name), `focused` (the element number with keyboard focus, absent when nothing in the tree has focus), and `layer` (`kind`: window, sheet, dialog, alert, or menu; optional `title`, `defaultButton`, and `cancelButton` as element numbers). A sheet usually has no title on macOS.
- [x] **OBJ-29.4** Add a rule the harness can apply: a `type` action is refused when the focused element is a `secureTextField` (SPEC-05 r7). Put it in the schema where JSON Schema can express it, otherwise in the schema description and the README, and add a test either way.
- [x] **OBJ-29.5** `open_app` takes exactly one of `bundleId` or `name`; the Mac app resolves a name through Launch Services. Apple's ids are inconsistent (`com.apple.mail`, `com.apple.Notes`), so the model should not have to guess them.
- [x] **OBJ-29.6** `open_file` takes an optional `bundleId` to open the file with a named app, for example a PDF with Mail to start a message with it attached. Record that the Mail behavior is not verified on a real Mac yet.
- [x] **OBJ-29.7** Add `enter` (the keypad Enter key, different from `return` on a Mac) to the key combo pattern. Aliases such as `Cmd+S`, `esc`, or `backspace` are normalized by the harness, not the schema: note that in the description.
- [x] **OBJ-29.8** In the `Path` description: Mac volumes are case-insensitive by default, so name clashes (SPEC-07 r4) and "a file Yumi did not create" checks compare names case-insensitively; and documents such as `.key` and `.pages` are folders (packages), so file tools must handle folders.
- [x] **OBJ-29.9** Bump `ProtocolVersion` to 3. Run `npm run generate`. Update every example in `protocol/examples/`, the mocks, the tests (add tests for each rule above), `protocol/README.md`, and `docs/task-record-schema.md`.
- [x] **OBJ-29.10** Update SPEC-05: requirement 1.2 says the model clicks elements through the accessibility API; requirement 2's role list matches the schema; add a requirement that the model sees the focused element and the front sheet, dialog, or menu, with a scenario; record the changes under Decisions, dated 2026-10-09. Run the spec-lifecycle skill.
- [x] **OBJ-29.11** Update `models/gui/smoke.py` to the new action names, so the next OBJ-26 run measures the real contract. Do not run the model.

## Expectations

- [x] `python3 scripts/verify.py` passes, including the protocol generated-types check, typecheck, and tests.
- [x] Every example validates, and every new rule has a test that a wrong value fails.
- [x] `grep -rn axPress` finds nothing outside history (`models/gui/results/`, `models/gui/SMOKE-TEST.md`, and this objective).
- [x] SPEC-05 and the schemas name the same roles and actions.

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

- **Result:** Done.
- **Delivered:**
  - Protocol version 3 in `protocol/schemas/`: `click {element}` and `clickAt {x, y}` in `action.json`; 19 `AXRole` values with the macOS mapping in the description; `Observation.app`, `focused`, and `layer` with the new `Layer` and `LayerKind` types in `observation.json`; `open_app` by exactly one of `bundleId` or `name` and `open_file` with an optional `bundleId` in `tools.json`; `enter` in the key pattern; the case-insensitive and package notes on `Path` in `common.json`.
  - `RecordedAction` now carries the focused element for a `type` action, and rejects a `type` or `setValue` whose element is a `secureTextField`.
  - `HelloParams.protocolVersion` accepts any positive integer, so a Mac app on another version gets the harness's `UserError` (`-32000`) instead of a `-32602` contract error. `HelloResult` and the bridge types keep the `ProtocolVersion` const (added at the orchestrator's request).
  - Regenerated TypeScript, Swift, and Kotlin in `protocol/generated/`, and the crypto vectors in `protocol/vectors/bridge-crypto-v2.json` for the new version.
  - Examples: every `axPress` is now `click`, `ModelAction.click-at-p1`, and new `ModelAction.click-row`, `ModelAction.key-enter`, `Layer.export-sheet`, `Observation.export-sheet`, `Observation.mail-inbox`, `Observation.password-dialog`, `RecordedAction.type-into-subject`, `ToolCall.open-app-by-name`, `ToolCall.open-app-by-bundle-id`, and `ToolCall.open-file-with-mail`.
  - The mock Mac app sends the generated `PROTOCOL_VERSION` in `hello` instead of a literal.
  - `protocol/README.md`: "Rules the schemas cannot express", "How macOS roles map", and the version 3 and `hello` notes under "Versioning". `docs/task-record-schema.md` matches.
  - SPEC-05: requirement 1.2 (click, row selection), requirement 2 (role list), requirement 7 (no typing while a password field has focus), new requirement 15 (focus and front layer), scenarios "The model sees the focus and the front sheet" and "Rows are selected by clicking", and a decision dated 2026-10-09. SPEC-07 requirement 4 says names compare case-insensitively.
  - `models/gui/smoke.py` uses `click`, keeps `comboBox` and `menuButton` as their own roles, and sends the keypad key code (76) for `enter`.
- **Commits:**
  - `b20f4f2 docs(objectives): start OBJ-29`
  - `b94ca6d feat(protocol)!: protocol v3, fit the action and observation contracts to real macOS`
  - `841e392 docs(spec-05): click elements, select rows, and see focus and the front sheet`
  - `f8ad265 fix(models): use the protocol v3 action names in the GUI smoke test`
  - `docs(objectives): finish OBJ-29` (this commit)
- **Expectations:**
  - `python3 scripts/verify.py` passes: docs check, protocol generated types, typecheck, 248 tests, and the Android build, tests, and lint. The Swift and Kotlin round trips were not run (Docker is not running); CI runs them on push.
  - Every example validates (`test/examples.test.ts`). Wrong-value tests in `test/validation.test.ts`: `axPress` rejected, `click` with coordinates and `clickAt` with an element rejected, raw macOS role names rejected, key aliases (`Cmd+S`, `esc`, `backspace`, `Enter`) rejected, `type` into a secure text field rejected, an element on `key` or `finish` rejected, `open_app` with neither or both fields rejected, an empty or unknown `open_file` app rejected, and an unknown layer kind, empty layer title, zero element number, and empty app name rejected. `test/types-check.ts` proves `axPress` and `clickAt {element}` no longer type-check. `test/mocks.test.ts` proves a hello from another version validates and gets a `-32000` `UserError`.
  - `grep -rn axPress` finds only history and deliberate mentions: the allowed files, the done objectives OBJ-01 and OBJ-26 (left as written, since they record what was true then), the version 3 note in `protocol/README.md`, and the two tests that check the old name is rejected.
  - SPEC-05 requirement 2 lists the same 19 roles as `AXRole`, and requirement 1 names `click`; the decision names `click` and `clickAt`. Compared by hand against `protocol/schemas/action.json`.
- **Not verified:**
  - The Swift and Kotlin round trips: run `npm run compile:swift` and `npm run compile:kotlin` in `protocol/` with Docker running, or let CI run them.
  - `models/gui/smoke.py` was not run against a model or a real app, as the objective says. It compiles, and with pyobjc stubbed out, `parse_action` accepts `click`, rejects `axPress`, and maps `enter` to key code 76. OBJ-26 runs it for real.
  - macOS behavior the SDK headers do not document, taken from the audit: rows usually do not support `AXPress`, a sheet usually has no `AXTitle`, and a tab is an `AXRadioButton` in an `AXTabGroup`. The constants themselves (`kAXRowRole`, `kAXSecureTextFieldSubrole`, `kAXSearchFieldSubrole`, `kAXSheetRole`, `kAXDialogSubrole`, `kAXSystemDialogSubrole`, `kAXFocusedUIElementAttribute`, `kAXDefaultButtonAttribute`, `kAXCancelButtonAttribute`, `kAXSelectedAttribute`, `kAXPressAction`, `kVK_ANSI_KeypadEnter`) were read in the local macOS SDK. Patrick can confirm the behavior with Accessibility Inspector on the demo apps.
  - Opening a PDF with Mail through `open_file` with `bundleId: com.apple.mail` starting a new message with the file attached. Check on a real Mac in OBJ-26.
  - Whether `.key` and `.pages` documents on the demo Mac are packages (folders) or single files. Both are possible, so file tools must handle folders either way.
- **Decisions and deviations:**
  - The type rule is in the schema: `RecordedAction.element` holds the focused element for a `type` action, and a `secureTextField` there fails validation. The harness still has to look up `Observation.focused` itself, because one schema cannot see two messages.
  - `alert` is in `LayerKind` as the objective says, but macOS has no alert role or subrole in `AXRoleConstants.h` or AppKit's `NSAccessibilityConstants.h`. The schema says the Mac app reports an alert as `sheet` or `dialog` unless it can tell. Raised as a question for Brent.
  - The new SPEC-05 requirement is number 15, appended so requirements 12 to 14, which other objectives cite, keep their numbers.
  - The crypto vectors file keeps its name `bridge-crypto-v2.json`: the crypto scheme and its domains did not change, only the `protocolVersion` value inside the vectors.
  - Rows, cells, and the scrollable containers are not read by `smoke.py`; none of the three demo tasks needs them, and adding them would change what the next OBJ-26 round compares against round 2. The smoke test keeps its flat `{"action": "click", "element": N}` reply shape rather than the real `WorkerOutput` (`{"action": {"kind": ...}}`), so round 3 compares with rounds 1 and 2.
  - SPEC-07 requirement 4 gained one sentence on case-insensitive names, to match the `Path` note (OBJ-29.8).
- **For the next objectives:**
  - **Harness (OBJ-03):**
    - Use `click` and `clickAt` in the prompt, validation, risk check, and action log. `click` on a row or cell selects; `scroll` should target a `scrollArea`, `table`, `list`, or `outline`.
    - Normalize key aliases before validating a `key` action: case (`Cmd+S` to `cmd+s`), `command`/`option`/`control` to `cmd`/`opt`/`ctrl`, `esc` to `escape`, `backspace` to `delete`. Keep `enter` and `return` distinct. Add `enter` to the per-app risk lists wherever `return` is (SPEC-07 r6).
    - Refuse `type` when `Observation.focused` names a `secureTextField`, and record the focused element as `RecordedAction.element` for `type`.
    - Check that `focused`, `layer.defaultButton`, and `layer.cancelButton` are element numbers in the observation.
    - Compare file names case-insensitively for name clashes (SPEC-07 r4) and for "a file Yumi did not create"; treat a package path as a folder in every file tool, including counting files inside it for deletes (SPEC-07 r8).
    - Show the model `app`, `focused`, and `layer` in the prompt. Prefer `open_app` by `name`.
    - Refuse a `hello` with another version with a `UserError` (the mock uses kind `unexpected`), now that the params validate.
  - **Mac app (Patrick):**
    - Map roles and subroles as in `protocol/README.md`, "How macOS roles map": secure text fields by subrole, search fields to `textField`, tabs to `radioButton`, combo boxes and menu buttons to their own roles, and rows, cells, and the four scrollable containers.
    - Carry out `click` on a row or cell by setting `AXSelected` to true, and on everything else with `AXPress`.
    - Fill `Observation.app`, `focused` (from `AXFocusedUIElement`), and `layer` (sheet, dialog window subroles, open menu, `AXDefaultButton`, `AXCancelButton`; most sheets have no title).
    - Resolve `open_app` by `name` through Launch Services, and open `open_file` with the app given by `bundleId`.
    - Send `PROTOCOL_VERSION` (3) in `hello`.
  - **OBJ-26 (Mail quirks to check on a real Mac first):** the message body is likely a web area whose value cannot be set with `setValue`; the To field is a token field whose value may hold placeholder characters instead of addresses, which matters for reading recipients (SPEC-07 r13); and whether `open_file` with Mail starts a new message with the file attached.
  - **Bridge (Jepoy):** the relay's `authenticate` frame and `PairingOffer` still use the `ProtocolVersion` const, so per `protocol/docs/pairing.md` a device on another version fails the schema check (`invalidFrame`) before the relay can answer `unsupportedVersion`, and the phone cannot tell a version mismatch from a bad QR code. Envelopes keep the const, which no doc contradicts. Not changed here; raised for Brent.
