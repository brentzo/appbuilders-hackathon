---
type: design
status: draft
created: 2026-10-09
updated: 2026-10-09
tags: [idea, yumi, harness, design, schema]
---

# Task Record Schema

Part of [Yumi](yumi.md).
Used by the [Lane Router](lane-router.md).

The task record is the single source of truth for long-running work.
It lives on disk in SQLite, so a crash, a "stop", or a reboot can resume where it left off.
Any worker can pick up the next step by reading the record plus a fresh look at the screen.
Workers never share conversations, only this record.

The shapes below are design sketches in Swift.
The source of truth is the JSON Schema in [protocol](../protocol/README.md), built by [OBJ-01](../objectives/OBJ-01-task-record-schemas.md).

## Shape

```
Task (one per confirmed goal)
 └── Subtask (one per plan item, routed to a lane)
      └── Step (one per model action)
WindowLock (one per locked window)
AppCapability (cached probe result per app)
Approval (one per risky action waiting for the user)
ActionLogEntry (one per action that ran, was blocked, or was declined)
```

## Task

```swift
struct Task: Codable {
    let id: UUID
    let originDeviceId: DeviceId     // where the user spoke: confirms, approvals, progress, and the result go here (SPEC-09)
    var goal: String                 // what the user said, transcribed
    var confirmedGoal: String        // what Yumi repeated back and the user accepted
    var status: TaskStatus
    var plan: [UUID]                 // subtask ids, in plan order
    var summary: String?             // final summary spoken on the origin device
    var createdAt: Date
    var updatedAt: Date
}

enum TaskStatus: String, Codable {
    case awaitingConfirmation        // goal repeated back, waiting for yes or a correction
    case queued                      // delegated goal waiting while the Mac is busy (SPEC-09 r14)
    case planning
    case running
    case waitingForUser              // an approval or a question is pending
    case paused                      // stop shortcut, menu bar Stop, Stop from the other device, or the user took the mouse
    case done
    case failed
    case cancelled
}
```

## Subtask

```swift
struct Subtask: Codable {
    let id: UUID
    let taskId: UUID
    var title: String                // short, shown on the dashboard and cursor label
    var instruction: String          // narrow prompt for the worker
    var dependsOn: [UUID]            // must be done before this one starts
    var proposedLane: Lane           // from the planner
    var lane: Lane?                  // set by the router
    var routeReason: RouteReason?
    var target: Target?              // nil for helpers
    var status: SubtaskStatus
    var workerId: String?            // which worker holds it right now
    var attempts: Int                // one gui_act call is one attempt, see limits
    var result: SubtaskResult?       // structured, never a transcript (SPEC-05 r4)
    var lastGoodStep: UUID?          // where a handoff resumes from
}

struct Target: Codable {
    var bundleId: String             // e.g. com.apple.mail
    var windowId: Int?               // CGWindowID on the Mac
}

enum SubtaskStatus: String, Codable {
    case pending                     // dependencies not done
    case ready                       // can be routed
    case queued                      // routed, waiting for a lock or capacity
    case running
    case needsApproval               // risky action waiting for the user's approval
    case handoff                     // failed on one lane, moving to main
    case done
    case failed
}

struct SubtaskResult: Codable {
    var status: ResultStatus
    var files: [String]              // paths created or changed
    var note: String                 // at most 200 characters
}

enum ResultStatus: String, Codable {
    case done, partial, stuck, blocked
}
```

The harness builds `SubtaskResult` from the step log.
Screenshots, step history, and raw screen text never reach the orchestrator.

## What the model sees

Each step starts with a fresh, short context:

1. The confirmed goal.
2. The subtask instruction.
3. The last 3-5 step entries (action, observation, outcome only).
4. An observation of the target window.
5. Only the tools allowed for this lane.

```swift
struct Observation: Codable {
    var app: String?                 // the app's name, e.g. Keynote
    var windowTitle: String
    var focused: Int?                // element number with keyboard focus, absent when not in the tree
    var layer: Layer?                // what is in front: the window, or a sheet, dialog, alert, or menu
    var elements: [TreeElement]      // trimmed tree, at most 200 (SPEC-05 r2)
    var screenshotPath: String?      // p1 only, for the vision fallback
}

struct Layer: Codable {
    let kind: LayerKind              // window, sheet, dialog, alert, menu
    var title: String?               // a sheet usually has none
    var defaultButton: Int?          // element number of AXDefaultButton
    var cancelButton: Int?           // element number of AXCancelButton
}

struct TreeElement: Codable {
    let n: Int                       // short number the model answers with
    let role: AXRole                 // button, menuItem, menuBarItem, textField, secureTextField, textArea, link, checkbox, radioButton, popUpButton,
                                     // comboBox, menuButton, disclosureTriangle, row, cell, scrollArea, table, list, outline
    let label: String
    var value: String?               // never set for secure text fields
    var enabled: Bool
}
```

The trimmed tree holds visible, actionable elements only, and skips empty layout groups.
Secure text fields are listed so Yumi can ask the user to type there, but their value is never read (SPEC-05 r7).
How macOS roles and subroles map to `AXRole` (a password field is an `AXTextField` with subrole `AXSecureTextField`, a tab is an `AXRadioButton`) is in [protocol/README.md](../protocol/README.md), "How macOS roles map".
A step has no effect when the trimmed tree and the window title are the same before and after the action (SPEC-05 r6).

## Actions

There are two shapes.
The model outputs a `ModelAction`, which refers to elements by number.
The harness resolves it into a `RecordedAction` before running it, so the risk check and the action log see the real element.

```swift
enum ModelAction: Codable {
    case click(element: Int)         // AXPress, or selects a row or cell
    case setValue(element: Int, text: String)
    case type(text: String)          // main lane only, refused when the focused element is a secure text field
    case key(combo: String)          // main lane only
    case scroll(element: Int, direction: ScrollDirection)
    case tool(ToolCall)              // typed tools only, see below
    case ask(question: String)       // pauses for the user
    case finish(status: FinishStatus, note: String)  // ends this gui_act attempt: done or stuck; the harness sets partial and blocked
    case clickAt(x: Int, y: Int)     // p1 vision fallback only
}

struct RecordedAction: Codable {
    let action: ModelAction
    var element: ResolvedElement?    // for element actions, and the focused element for type
    var permission: PermissionLevel  // decided by the harness, never the model (SPEC-07 r1)
}

struct ResolvedElement: Codable {
    let path: String                 // stable accessibility path
    let role: AXRole
    let label: String                // used for the risk check (SPEC-07 r6)
}

enum PermissionLevel: String, Codable {
    case allowed, ask, blocked
}
```

## Typed tools

There is no shell and no AppleScript (SPEC-05 r1, SPEC-07 r3).
Every tool has its own argument schema, so the harness can check every call.

| Tool | Arguments | Level |
|---|---|---|
| `open_app` | exactly one of `bundleId` or `name` (resolved through Launch Services) | Allowed |
| `open_file` | `path`, optional `bundleId` to open it with that app | Allowed |
| `open_url` | `url` | Allowed |
| `reveal_in_finder` | `path` | Allowed |
| `read_file` | `path` | Allowed, blocked for secret locations |
| `list_dir` | `path` | Allowed, blocked for secret locations |
| `write_new_file` | `path`, `content` | Allowed, never replaces a file |
| `copy` | `from`, `to` | Allowed, a taken name gets a number |
| `move` | `from`, `to` | Allowed, a taken name gets a number |
| `move_to_trash` | `paths` (exact, no wildcards) | Ask every time, tap only |
| `phone` | `call`: one phone tool call (`set_alarm` with `time`, `set_timer` with `seconds`, `open_app` with `app`) | Depends on the phone tool (SPEC-09 r2) |

SPEC-07 requirement 3 says `open`; it is split here into `open_app`, `open_file`, and `open_url` from SPEC-05.
The phone call is a closed union of the p0 phone tools rather than free-form arguments, so the Mac brain can check every argument; p1 tools are added as new variants.

## Step

One row per model action.
This is the log the next worker reads, so each entry stays short.

```swift
struct Step: Codable {
    let id: UUID
    let subtaskId: UUID
    let index: Int
    let lane: Lane
    var action: RecordedAction
    var observation: String?         // one line: what changed after the action; nil until it finished
    var outcome: StepOutcome?        // nil until the action finished
    var screenshotPath: String?      // p1, kept for debugging and the dashboard
    var startedAt: Date
    var durationMs: Int?
}

enum StepOutcome: String, Codable {
    case ok
    case noEffect                    // tree and window title unchanged
    case invalidOutput               // model output failed schema validation
    case blocked                     // the harness refused it (SPEC-07 r5)
    case declined                    // the user said no to an approval
    case error
}
```

## Approvals

Risky actions wait for the user on the origin device (SPEC-07, SPEC-09 r10).
The approval text is built by the harness from real data, never from model text.

```swift
struct Approval: Codable {
    let id: UUID
    let stepId: UUID
    let kind: ApprovalKind           // send or delete
    var recipients: [String]?        // send: read from the real To and Cc fields
    var files: FileSummary?          // delete: built from the real file list
    var text: String                 // what the user hears and sees
    var requestedAt: Date
    var expiresAt: Date              // 5 minutes, then the task pauses (SPEC-09 r10)
    var decision: ApprovalDecision?
}

struct FileSummary: Codable {
    var folder: String
    var count: Int
    var firstNames: [String]         // at most 5
    var allPaths: [String]           // the exact list the approval covers, checked again right before acting
}

enum ApprovalKind: String, Codable { case send, delete }

struct ApprovalDecision: Codable {
    var approved: Bool
    var method: ApprovalMethod       // a delete is only approved by a tap (SPEC-07 r11)
    var decidedAt: Date
}

enum ApprovalMethod: String, Codable { case tap, voice }
```

Pausing cancels every pending approval (SPEC-06 r5).
An approval covers its exact list once; if the recipients or files changed, Yumi asks again.

## Locks and capabilities

```swift
struct WindowLock: Codable {
    let windowId: Int
    let subtaskId: UUID
    let lane: Lane
    var acquiredAt: Date
    var expiresAt: Date              // stale locks expire, so a crashed worker cannot block a window
}

struct AppCapability: Codable {
    let bundleId: String
    let appVersion: String
    var accessibility: Bool          // actionable AX tree found
    var devtools: Bool               // Chromium DevTools protocol available
    var probedAt: Date
}
```

## Action log

```swift
struct ActionLogEntry: Codable {
    let time: Date                   // shown as am/pm
    let deviceId: DeviceId
    let lane: Lane?
    let description: String          // plain language, e.g. "Clicked Export in Keynote"
    var paths: [String]?             // every path for deletes (SPEC-07 r18)
    var outcome: StepOutcome
}
```

Text typed into password fields is never logged.

## Limits

| Limit | Default | On breach |
|---|---|---|
| Steps per `gui_act` attempt | 10 | Return `partial` (SPEC-05 r5) |
| Steps per subtask, across attempts | 25 | Mark `failed`, tell the user |
| Attempts per subtask | 3 | Mark `failed` |
| Invalid output | Retry once with the validation error (SPEC-02) | A second invalid output in a row: a ghost hands off to `main` (SPEC-03 r8) |
| Consecutive `noEffect` | 3 | Hand off to `main`, or ask the user if already on `main` |
| Subtask depth (subtasks spawning subtasks) | 1 | Reject the new subtask |
| Visible cursors | 3 | Queue |
| Approval wait | 5 minutes | Pause the task |

## Checkpointing

- Write the step row before executing the action, then update the outcome after.
- On restart, any step without an outcome is treated as `noEffect`, and the screen is observed again before continuing.
- A step that needed approval and has no outcome is never retried automatically. Yumi asks the user whether it happened (SPEC-07 r21, p1).
- Every status change also emits an event for the dashboard and the voice narration.

## Open questions

- Screenshots: SPEC-02 r10 keeps them forever, SPEC-07 r20 (p1) deletes them after 7 days. In p0 there are no vision steps, so screenshots are only for debugging. Pick one rule.
- What happens after two invalid outputs in a row on the `main` lane? Suggest: the attempt ends with `stuck`.
