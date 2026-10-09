---
id: OBJ-44
title: Mac GUI execution
product: mac
assignee: Patrick
touches: []
specs: [SPEC-05, SPEC-11]
status: in-progress
priority: p0
depends-on: [OBJ-14, OBJ-18]
integrates-with: [OBJ-26, OBJ-41]
tags: [objective, p0, mac, gui]
---

# OBJ-44 Mac GUI execution

**Product:** [Yumi for Mac](../mac/README.md) · **Specs:** [SPEC-05](../specs/05-mac-gui-control.md), [SPEC-11](../specs/11-user-facing-errors.md) · **Assignee:** Patrick

## Project context

> Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
> You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps the way a person would.
> It can split into parallel "ghost" cursors and invisible helpers, and the Mac and phone control each other through an end-to-end encrypted VPS bridge.
> All AI runs on the devices: Qwen3.5-9B on the Mac (16 GB), plus Whisper and native on-device speech recognition for voice.
> The Android phone (12 GB) starts as a tool host and voice remote with no model (p0) and gets its own model later (p1).
> The harness, not the model, owns planning state, routing, checkpoints, and safety.
> Repo map: [README.md](../README.md). Full overview: [docs/yumi.md](../docs/yumi.md).

## Why this objective

The harness decides what to do, but only the Mac app can touch other apps.
This objective builds the Mac side of every GUI action: a trimmed, numbered accessibility tree, `AXPress` and `AXValue` on those elements, tagged keystrokes for the main cursor, and the typed direct tools that open apps, files, URLs, and Finder folders.
It turns a `ModelAction` from the harness's `gui_act` sub-agent ([OBJ-41](OBJ-41-gui-act-sub-agent.md)) into a real effect in Keynote, Mail, and Notes, while the cat shows where Yumi works and the user's own mouse stays put.
Until OBJ-41 exists, build and test against the mock harness from [OBJ-01](OBJ-01-task-record-schemas.md).

## Read first

- [SPEC-05](../specs/05-mac-gui-control.md), requirements 1-3, 6, 7, and 11, the "Demo tasks", and the "Mac GUI control" scenarios.
- [SPEC-03](../specs/03-lane-routing.md) requirement 7: only `main` sends keystrokes.
- [SPEC-06](../specs/06-user-control.md) requirements 3 and 4: Yumi tags its own input, and types in short chunks so a pause lands between chunks. The pause itself is [OBJ-40](OBJ-40-mac-stop-and-take-over.md).
- [SPEC-11](../specs/11-user-facing-errors.md), the "Accessibility permission missing (Mac)" row.
- [docs/task-record-schema.md](../docs/task-record-schema.md), "What the model sees", "Actions", and "Typed tools".
- [OBJ-01](OBJ-01-task-record-schemas.md): `Observation`, `TreeElement`, `ModelAction`, `ResolvedElement`, the typed tool schemas, and the RPC methods `observeWindow`, `executeAction` (which carries the `cursorId` to animate first; OBJ-01 folded `animateCursorTo` into it), and `readFieldValues`. Implement those; never hand-write a contract type (see the contracts-and-stand-ins skill).
- [OBJ-26](OBJ-26-gui-smoke-test.md) Outcome and its throwaway trimming script in `models/gui/`, if done.
- The Outcome of [OBJ-14](OBJ-14-mac-app-shell.md) (RPC client, error presenter), [OBJ-18](OBJ-18-cursor-overlay-and-motion.md) (click point), and [OBJ-27](OBJ-27-mac-native-services.md) (`probeAppCapability` and window services, which this objective reuses and does not rebuild).

## Tasks

- [x] **OBJ-44.1** Tree reader: walk the target window's `AXUIElement` tree and keep only visible elements with an actionable role (button, menu item, text field, link, checkbox, pop-up button). Skip empty layout groups, number the kept elements, and stop at 200 (SPEC-05 r2). Keep each element's full accessibility path on the Mac side only, so a later action can resolve its number. Include an open menu's items, so "Export To" then "PDF..." in Keynote works, and record how menus are walked in the Outcome.
- [x] **OBJ-44.2** `observeWindow`: return an `Observation` with the window title and the trimmed elements. An `AXSecureTextField` appears with no `value`, ever (SPEC-05 r7). Never read its contents, not even into a log.
- [x] **OBJ-44.3** `executeAction` for element actions, resolving the number from the last observation of that window: `axPress` performs `AXPress`, `setValue` sets `AXValue`, and `scroll` scrolls through the accessibility API. Refuse `setValue` on a secure text field with a structured error kind. Return the `ResolvedElement` (path, role, label) so the harness can check its risk and log it.
- [x] **OBJ-44.4** Before every element action, animate the cursor to the element's center and act only after it arrives. The real mouse pointer never moves for accessibility actions (SPEC-05 r3).
- [x] **OBJ-44.5** Keystrokes for the `main` lane only: `type` sends text with `CGEvent` in short chunks, and `key` sends one combo. Reject both for any other lane. Tag every event Yumi sends (for example with `kCGEventSourceUserData`), and check a cancel flag between chunks so typing stops before the next chunk. [OBJ-40](OBJ-40-mac-stop-and-take-over.md) sets the flag.
- [x] **OBJ-44.6** Typed direct tools: `open_app` (bundle id), `open_file`, `open_url`, and `reveal_in_finder`, with `NSWorkspace`. Each takes only its schema arguments. There is no shell, AppleScript, or `Process` call anywhere in this code.
- [x] **OBJ-44.7** `readFieldValues`: read the current To and Cc values of a Mail draft through the accessibility API. The harness builds the send approval from these, never from model text (SPEC-07 r13).
- [x] **OBJ-44.8** Missing Accessibility permission: every method that needs it returns a structured error kind, and the app shows the SPEC-11 "Accessibility permission missing (Mac)" copy through the [OBJ-14](OBJ-14-mac-app-shell.md) error presenter, with "Open settings" opening the Accessibility pane.
- [x] **OBJ-44.9** A debug window that shows the trimmed tree of the frontmost window with its numbers and presses an element by number. Use it to check Keynote, Mail, and Notes by hand.
- [ ] **OBJ-44.10** Tests: trimming against a recorded tree fixture with more than 1,500 elements, secure field handling, the lane check for keystrokes, event tagging, and typing stopping on the cancel flag. Run every method against the mock harness, then against the real harness when [OBJ-41](OBJ-41-gui-act-sub-agent.md) is done.

## Expectations

- [ ] SPEC-05 scenario "The model sees a trimmed tree" passes on a real Keynote window, at the Mac level.
- [ ] SPEC-05 scenario "Accessibility is used before vision" passes at the Mac level: the menu items are pressed through the accessibility API, the cursor animation moves to each item, the real mouse does not move, and no screenshot is taken.
- [x] SPEC-05 scenario "Direct tool is used when available" passes at the Mac level: `reveal_in_finder` opens the Downloads folder and no element is pressed.
- [ ] SPEC-05 scenario "Accessibility permission is missing" passes: the user sees "I need permission to control your Mac before I can help with this." and "Open settings" opens the Accessibility pane.
- [x] A secure text field never has a `value` in any observation, log line, or RPC payload, and `setValue` on it is refused.
- [x] Every event Yumi sends carries the tag, and `type` or `key` from a ghost lane is rejected.
- [x] Every method matches its OBJ-01 contract and validates against the schema.

## Expected outcomes

- The tree reader, `observeWindow`, `executeAction`, `readFieldValues`, and the direct tools in the Mac app.
- Tagged, chunked keystroke sending with a cancel flag for OBJ-40.
- A debug window for the trimmed tree.

## Out of scope

- The step loop, the 10-step limit, the no-effect check, and the structured result: [OBJ-41](OBJ-41-gui-act-sub-agent.md) (Brent).
- Permission levels and file tools: [OBJ-42](OBJ-42-permission-gate-and-file-tools.md) (Brent). `moveToTrash` and the approval card: [OBJ-45](OBJ-45-mac-approval-cards.md).
- `probeAppCapability`, `openNewWindow`, and window frames: [OBJ-27](OBJ-27-mac-native-services.md).
- Watching the user's input and pausing: [OBJ-40](OBJ-40-mac-stop-and-take-over.md).
- Vision fallback, screenshots for the model, coordinate conversion, and the moved-window check (SPEC-05 r12 and r13, p1). Until then the `click` action is rejected.
- Chromium DevTools control for ghosts: not specified yet.

## Outcome

- **Result:** In progress.
  OBJ-44.1 to OBJ-44.9 are built and the main paths are tested.
  OBJ-44.10 is open: its tests are in, but the mock harness never calls the app's GUI methods, and the real harness run waits for [OBJ-41](OBJ-41-gui-act-sub-agent.md).
  Three expectations wait for Patrick's hand check in Keynote, Mail, and Notes (steps below), because Keynote is not installed on this Mac and the built app has no Accessibility permission here.
- **Delivered:**
  - `mac/Yumi/GUI/`: `TreeTrimmer` (the trimming rules over any `TreeNode`), `LiveNode` (an `AXUIElement`, read in one request per element), `WindowReader` (target app and window, front layer, focus, default and cancel buttons), `ElementPath`, `GuiExecutor` (`observeWindow`, `executeAction`, `readFieldValues`), `KeystrokeSender` and `KeyCombo`, `DirectTools`, and `GuiDebugWindow`.
  - `mac/Yumi/Native/AppMethodServer.swift`: serves the three methods. A `GuiFailure` becomes -32000 with its SPEC-11 kind.
  - `mac/Yumi/Overlay/ElementLocator.swift`: `AccessibilityElementLocator` replaces the OBJ-18 stand-in, so a cursor moved to an element path goes to the element itself.
  - "GUI debug…" in the menu of Debug builds.
  - Tests in `mac/YumiTests/GuiExecutionTests.swift`.
- **Commits:**
  - `673d4d8 docs(objectives): start OBJ-44`
  - `1e7dfc1 feat(mac): read trimmed accessibility trees and act on numbered elements (work in progress)`
  - `c09352e feat(mac): serve observeWindow, executeAction and readFieldValues to the harness`
  - `928b27c feat(mac): add a GUI debug window that reads and presses elements by number`
  - `e95aaeb test(mac): cover trimming, password fields, the keystroke lane, event tags and the permission error`
  - `c8da5c7 docs(mac): document GUI control and its debug window, and the real harness default`
  - and the commit that records this outcome.
- **How menus are walked (OBJ-44.1):**
  - The app's menu bar item whose menu is open reports `AXSelected`; its `AXMenu` child is read instead of the window.
  - A menu item whose submenu is open also reports `AXSelected`; the submenu's items follow the parent menu's items, up to 4 levels.
  - Separators (menu items with no title) are skipped.
  - With no menu open, the app's menu bar items come last in the tree, so the model can open one.
  - Checked live in TextEdit: pressing "Format" gave a menu layer with its 9 items, and pressing "Font" added the 16 items of its submenu, with paths such as `AXMenuBar/AXMenuBarItem[4]/AXMenu[0]/AXMenuItem[0]/AXMenu[0]/AXMenuItem[1]`.
    Keynote's "Export To" then "PDF…" is the same pattern, not yet checked in Keynote.
- **Checked live:** with a command-line build of the same `Yumi/GUI` and `Yumi/Overlay` sources, using this shell's Accessibility permission:
  - TextEdit, Notes, and Finder windows read as 27, 53, and 59 to 77 elements in 160 to 840 ms.
  - On a scratch TextEdit file: `open_file`, `setValue` on the text area, `type` from the main cursor, `readFieldValues` reading the text back, a menu opened and closed with `key escape`, and `cmd+w`.
    `type` and `key` from a ghost cursor were refused.
    The real mouse pointer did not move.
  - `reveal_in_finder ~/Downloads` opened the Downloads folder, and `open_app` by name opened TextEdit.
  - Those observations and the `readFieldValues` and `executeAction` results validate against the schemas with the protocol's own `validate()`.
  - The debug window, rendered with TextEdit's real tree in light mode. The dark render drew no window background offscreen, so dark mode is checked only for the list and fields.
- **Tests:** 67 tests in 14 suites; the GUI suite has 9 tests.
  The full run had 66 passing and one failing because the fixture had 1,445 elements, under the 1,500 the test asks for; after enlarging the fixture, the GUI suite passed on its own run (9 of 9).
- **Expectations:**
  - "The model sees a trimmed tree": a fixture of 1,565 elements trims to 200 numbered, visible, actionable elements whose paths lead back to them, and real TextEdit, Notes, and Finder windows trim the same way.
    Not checked on a Keynote window.
  - "Accessibility is used before vision": menu items are pressed with `AXPress`, the cursor moves to each one first and the action waits 0.35 s for it, the real mouse does not move, and no screenshot is ever taken.
    Checked in TextEdit, not Keynote.
  - "Direct tool is used when available": checked live, see above. Nothing is pressed.
  - "Accessibility permission is missing": every method returns -32000 with `accessibilityPermissionMissing`, and the app shows the SPEC-11 copy with "Open settings" mapped to the Accessibility pane, at most once a minute (`GuiExecutionTests`).
    The window and the pane opening are not checked by hand.
  - Secure text fields: listed with no `value`, their value is never requested (the fixture counts reads), `setValue` and `type` into them are refused with `blockedAction`, typing stops if focus moves to one, and the log has element counts only.
  - Tags and lanes: every key event carries `0x59554D49` in `kCGEventSourceUserData` (`KeystrokeSender.eventTag`); `type` and `key` from a ghost or unknown cursor are refused with `blockedAction`.
  - Contracts: params and results are the generated types, and real outputs validate against the schemas.
- **Hand check for Patrick (Keynote, Mail, Notes):**
  1. Build Debug with your `Signing.local.xcconfig`, so the permission sticks across builds.
     Install Keynote from the App Store if needed: it is not on this Mac.
  2. Open `mac/build/Build/Products/Debug/Yumi.app` (add `--args -YumiMockHarness YES` if the real harness is not set up), and allow Yumi in System Settings > Privacy & Security > Accessibility.
  3. Permission check first: before allowing it, choose "GUI debug…", pick any app, and press Read.
     You should see "I need permission to control your Mac before I can help with this.", and "Open settings" should open the Accessibility pane.
  4. Keynote: open a deck, choose "GUI debug…", pick Keynote, and press Read.
     Expect at most 200 elements, "front: window", and the menu bar items at the end.
     Press Click on "File": the list should switch to "front: menu "File"".
     Click "Export To", then "PDF…".
     Expect "front: sheet" with a default button (Next…) and a cancel button.
     Watch the cat cursor move to each item before it is pressed, while your own pointer stays still.
     Click Cancel.
  5. Mail: pick Mail, type `cmd+n` in Key, and press "Press key" for a new message, then press Read.
     Put the number of the To field in Element and `ana@example.com` in the text field, and press "Set value".
     Select the To row and press "Read value of selected": it should show the address.
     Check whether the message body is listed; it may be a web area, which the trimmed tree does not list (see Not verified).
     Close the draft without sending.
  6. Notes: pick Notes, press `cmd+n` the same way, then Read.
     Click the note body (a text area), type a test sentence with Type, and check it appears; then try "Set value" on it.
     Delete the test note afterwards.
  7. A password field, for example a sign-in sheet: its row has no "=" value line, and "Set value" on it says "Refused with blockedAction".
- **Not verified:**
  - Keynote at all, and Mail and Notes write actions (I did not change the user's notes or open Mail): see the hand check.
  - The built app with Accessibility permission, including the debug window as a live panel; the live checks used a command-line build of the same sources.
  - The cursor animation as seen on screen (no screen capture here); the mouse staying still was checked in code.
  - Mail's To and Cc as token fields: when the value holds token characters, the tokens' own text is read instead; not tried on a real draft.
  - Mail's message body: if it is an `AXWebArea`, it is not listed and the model cannot type into it by number.
  - `scroll` and row selection on real apps; context menus (right-click); a ghost pressing a menu, which activates the ghost's app.
  - Key combos on a non-US keyboard layout: `key` uses US key codes; `type` sends characters, so it does not depend on the layout.
  - A 1,500-element Keynote window's read time (Notes took 840 ms).
  - Running the methods through the mock harness (it never calls them) and through the real harness (OBJ-41).
- **Decisions and deviations:**
  - The element press is `click`, as in protocol version 3, not `axPress` as in the task text, and `open_app` also takes an app name.
    `click` on a row or cell sets `AXSelected`, on a text field or text area it sets `AXFocused` (so `type` goes there), and on everything else it performs `AXPress`.
  - The lane is the cursor's kind from `spawn`: the main cursor is the main lane, and an unknown cursor is refused.
    Confirmed with the orchestrator; an explicit lane is raised with Jepoy.
  - Failure kinds: missing permission is `accessibilityPermissionMissing`; an app that is not running or a window that is not found is `stuckOnScreen`; a password field or a ghost keystroke is `blockedAction`.
    Element problems (gone, changed role, not supported) return outcome `error` with one line, so the step loop can observe again.
    `ask`, `finish`, `clickAt`, and the harness's own tools return `invalidOutput`.
    Typing that stops early returns `blocked` with how many characters went out.
  - The front layer is read alone: an open menu, else a sheet, else the window (a dialog by subrole).
  - A row is listed once, labelled with its text, and the cells inside it are not, to stay under 200.
  - Window title bar buttons are labelled close, minimize, zoom, and full screen from their subroles.
  - A path step counts only siblings with the same role.
  - A window id is matched to its accessibility window by frame, with no private API.
  - Labels are cut at 120 characters and values at 300.
  - Other apps get 1.5 s to answer an accessibility call instead of 6.
  - The app shows the Accessibility error itself, at most once a minute, because a step loop would otherwise hit it on every step.
  - The target app is activated before a menu press and before keystrokes: menus open only in the active app, and keystrokes go to the active app.
- **Protocol asks, for Jepoy:**
  - The harness cannot learn an element's path: `TreeElement` has none (paths stay on the Mac by design), and `ExecuteActionResult` does not return the `ResolvedElement`.
    So `RecordedAction.element.path` and `readFieldValues.elementPaths` cannot be filled by the harness today.
    The app resolves numbers itself and checks the harness's role; it ignores the path.
    Suggested: return `element: ResolvedElement` in `ExecuteActionResult`, and let `readFieldValues` take element numbers too.
  - An explicit lane in `ExecuteActionParams`.
  - A mock script that calls `observeWindow`, `executeAction`, and `readFieldValues`, so OBJ-44.10's mock run can happen.
- **For the next objectives:**
  - [OBJ-40](OBJ-40-mac-stop-and-take-over.md): call `harness.gui.keystrokes.cancelTyping()` to stop typing before its next chunk, and ignore events whose `kCGEventSourceUserData` is `KeystrokeSender.eventTag`.
  - [OBJ-41](OBJ-41-gui-act-sub-agent.md): the step loop calls `observeWindow` then `executeAction` with the same `Target`; numbers resolve against the last observation of that window.
  - [OBJ-45](OBJ-45-mac-approval-cards.md): `showApprovalCard` and `moveToTrash` still answer -32601 in `AppMethodServer`.
