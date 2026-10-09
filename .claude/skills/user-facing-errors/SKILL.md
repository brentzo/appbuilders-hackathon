---
name: user-facing-errors
description: Yumi's rules for every error, warning, or failure message a user can see or hear, on the Mac, Android, or iPhone - copy from SPEC-11, structured error kinds, recovery buttons, logging, and how to test errors. Use whenever you write code that can fail in front of a user, add or change error copy, map an error to UI or speech, or write tests for failure paths.
---

# User-facing errors

The person using Yumi is not a developer.
They do not know what a status code is, they cannot read a stack trace, and they did not cause the failure.
[SPEC-11](../../../specs/11-user-facing-errors.md) is the source of truth for every error a user can hit.

## Rules

1. **Never show or speak internal detail:** no status codes, exception messages, stack traces, transport strings, library names, or vendor wording.
2. **Every error answers three questions** in plain language: what happened, why, and what to do next.
3. **Recovery is a button, not a sentence.** Where SPEC-11 lists buttons, render them. Every button also works by voice (saying its label).
4. **Use SPEC-11 copy exactly.** The copy lives in one place in code per app, and a test checks it matches the SPEC-11 table. Fill `{device}` with the other device from the user's point of view ("your Mac" on the phone, "your phone" on the Mac).
5. **Show errors on the origin device**, the one the user spoke to.
6. **Unknown errors** use the "Unexpected" copy, which names the last action. Never claim nothing changed.
7. **Log the detail where the team can read it:** the device's local log (harness log file, macOS unified logging, Android logging). Never put payloads, secrets, or keys in logs.

## Structured kinds, not strings

- Every failure that can reach a user is a structured error with a kind that maps to one SPEC-11 row (for example `bridgeDown`, `otherDeviceOffline`, `stuckOnScreen`, `taskTookTooLong`).
- Detect failures from structured data (error types, codes, response fields), never by matching message text. Messages are not contracts and change without warning.
- Each app has one error presenter that maps kinds to copy and buttons.
- A catch-all that echoes an exception message to the UI is a bug. Name the failures you expect and map each one; everything else is "Unexpected".

## Adding a new error

1. Add a row to the SPEC-11 table (failure, copy, buttons) through the spec-lifecycle skill.
2. Add the kind to the protocol's `userError` contract if it crosses products.
3. Add the copy to each app's copy file and its presenter mapping.
4. Add a test for it.

## Testing errors

- Mock the error object the real client actually throws, with the same shape and fields. A mock with a friendlier shape passes while the real path is broken.
- Test that the raw detail (for example "ECONNRESET") appears nowhere in UI text or speech, and that it is in the log.
- Test that each recovery button does what it says.
