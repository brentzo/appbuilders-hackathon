---
type: design
status: draft
created: 2026-10-09
tags: [idea, yumi, harness, design, schema]
---

# Task Record Schema

Part of [Yumi](yumi.md).
Used by the [Lane Router](lane-router.md).

The task record is the single source of truth for long-running work.
It lives on disk in SQLite, so a crash, a "stop", or a reboot can resume where it left off.
Any worker can pick up the next step by reading the record plus a fresh screenshot.
Workers never share conversations, only this record.

## Shape

```
Task (one per user goal)
 └── Subtask (one per plan item, routed to a lane)
      └── Step (one per model action)
WindowLock (one per locked window)
AppCapability (cached probe result per app)
```

## Task

```swift
struct Task: Codable {
    let id: UUID
    var goal: String                 // what the user said, transcribed
    var confirmedGoal: String        // what Yumi repeated back and the user accepted
    var status: TaskStatus
    var plan: [UUID]                 // subtask ids, in plan order
    var summary: String?             // final summary spoken to the user
    var createdAt: Date
    var updatedAt: Date
}

enum TaskStatus: String, Codable {
    case awaitingConfirmation        // goal repeated back, waiting for yes or a correction
    case planning
    case running
    case waitingForUser              // a confirmation or a question is pending
    case paused                      // user said stop, or took the mouse
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
    var attempts: Int                // capped, see limits
    var result: String?              // short structured result for the planner, never a full transcript
    var lastGoodStep: UUID?          // where a handoff resumes from
}

struct Target: Codable {
    var bundleId: String             // e.g. com.apple.mail
    var windowId: CGWindowID?
}

enum SubtaskStatus: String, Codable {
    case pending                     // dependencies not done
    case ready                       // can be routed
    case queued                      // routed, waiting for a lock or capacity
    case running
    case needsConfirmation           // destructive action waiting for the user
    case handoff                     // failed on one lane, moving to main
    case done
    case failed
}
```

## Step

One row per model action.
This is the log the next worker reads, so each entry stays short.

```swift
struct Step: Codable {
    let id: UUID
    let subtaskId: UUID
    let index: Int
    let lane: Lane
    var action: Action
    var observation: String          // one line: what changed after the action
    var outcome: StepOutcome
    var screenshotPath: String?      // kept for debugging and the dashboard, not sent to later steps
    var startedAt: Date
    var durationMs: Int
}

enum Action: Codable {
    case click(x: Int, y: Int)
    case axPress(elementPath: String)
    case setValue(elementPath: String, text: String)
    case type(text: String)          // main lane only
    case key(combo: String)          // main lane only
    case scroll(dx: Int, dy: Int)
    case toolCall(server: String, name: String, argsJSON: String)
    case ask(question: String)       // pauses for the user
}

enum StepOutcome: String, Codable {
    case ok
    case noEffect                    // screen did not change as expected
    case invalidOutput               // model output failed schema validation
    case error
}
```

## Locks and capabilities

```swift
struct WindowLock: Codable {
    let windowId: CGWindowID
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

## What a worker receives

Each step starts with a fresh, short context:

1. The confirmed goal.
2. The subtask instruction.
3. The last 3-5 step entries (action, observation, outcome only).
4. A fresh screenshot and accessibility tree of the target window.
5. Only the 5-10 tools allowed for this lane.

The worker returns exactly one `Action`, validated against a JSON schema.

## Limits

| Limit | Default | On breach |
|---|---|---|
| Steps per subtask | 25 | Mark `failed`, tell the user |
| Consecutive `invalidOutput` | 2 | Hand off to `main` |
| Consecutive `noEffect` | 3 | Hand off to `main`, or ask the user if already on `main` |
| Attempts per subtask | 3 | Mark `failed` |
| Subtask depth (subtasks spawning subtasks) | 1 | Reject the new subtask |
| Visible cursors | 3 | Queue |

## Checkpointing

- Write the step row before executing the action, then update the outcome after.
- On restart, any step without an outcome is treated as `noEffect`, and the screen is re-captured before continuing.
- Every status change also emits an event for the dashboard and the voice narration.
