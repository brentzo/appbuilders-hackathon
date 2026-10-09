# Yumi

Yumi is a local voice companion that does goals for the user across apps on the Mac and phone.
This glossary fixes the words for how the user talks to Yumi and controls its work; the specs in `specs/` say what Yumi does.

## Language

### Goals and tasks

**Goal**:
What the user asked Yumi to do, in their own words.
_Avoid_: Command, request, prompt

**Task**:
The work Yumi does for one confirmed goal, from planning to done.
_Avoid_: Job, run

**Revised goal**:
The single new goal Yumi writes after an interruption, from the original goal, what is already done, and what the user just said, whether they replaced, added to, or asked for something separate.
_Avoid_: Amended goal, follow-up goal, second task

**Repeat-back**:
Yumi saying the goal back in its own words and waiting for a yes, a correction, or a cancel before any work starts.
_Avoid_: Confirmation prompt, echo

### Lanes

**UI lane**:
A cursor that works in an app's interface: the main cursor or a ghost cursor.
_Avoid_: Visible lane

**Helper**:
Work that runs without a cursor, such as reading a file.
_Avoid_: Background lane, invisible worker

### Control

**Take-over**:
The user moving the mouse or typing while a cursor works, which pauses the UI lanes silently.
_Avoid_: Manual override

**Interruption**:
The user starting to talk to Yumi, by wake word or push-to-talk, while a task runs; the UI lanes pause the moment it starts, and helpers keep running.
_Avoid_: Barge-in, voice override
