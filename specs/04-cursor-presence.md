---
id: SPEC-04
title: Cursor presence
priority: p0
devices: [mac]
status: draft
tags: [spec, p0, ux, gui, mac]
---

# SPEC-04 Cursor presence

## Summary

Yumi is visible as a cursor that moves like a person would.
Its motion, states, and labels are the main way the user understands what it is doing.
All of it is drawn by the harness on a transparent overlay; the model only chooses actions.

## Requirements

1. The main cursor spawns near the user's pointer when the user starts speaking a goal.
2. Movement to a target uses an eased curve over about 300 ms. It never teleports.
3. Each cursor has a visible state: listening, thinking, moving, acting, waiting for the user, paused.
4. The thinking state is shown while the model works, so a 1-4 second step never looks frozen.
5. Ghost cursors have their own color and a short label with the subtask title.
6. Helpers show as small status chips, not cursors.
7. The overlay never blocks clicks meant for the user's own pointer.
8. The overlay looks correct on every connected display, at every scale factor, in light and dark mode.
9. Cursors fade in and out. No cursor stays on screen after its task ends.
10. Every Yumi cursor is a custom pointer with Yumi's character attached: a cat.
11. Yumi's personality is playful and creative. The cat moves around the screen like a cat would: trotting, leaping, pouncing.
12. The cat's pose and expression show the cursor's state (see "Cat behaviors").
13. A click is a pounce. The paw tip is the click point, and it is always clear exactly where Yumi will click.
14. Playfulness never slows a task. Leaps fit inside the normal movement time, and idle play happens only while Yumi is thinking.
15. Ghost cursors are the same cat in their own color, like littermates.
16. The cat is drawn with vector animation, so it stays sharp at every display scale.
17. If the user has "Reduce motion" turned on, leaps and pounces become simple glides.
18. The same cat appears in the Android app.

## Scenarios

```gherkin
@p0 @ux @mac
Feature: Cursor presence

  Scenario: Cursor moves smoothly to a target
    Given the main cursor is idle at one point
    When the next action is a click on a button across the screen
    Then the cursor moves there along an eased path in about 300 ms
    And the click happens after the cursor arrives

  Scenario: Thinking state during a slow step
    Given the model takes 3 seconds to choose the next action
    Then the cursor shows the thinking state for those 3 seconds

  Scenario: Ghost cursors are labeled
    Given a ghost cursor is working on "Fill expense form"
    Then it is drawn in its own color
    And it shows the label "Fill expense form"

  Scenario: Overlay does not block the user
    Given cursors are visible on screen
    When the user clicks with their own pointer anywhere
    Then the click reaches the app under the pointer

  Scenario: Cursor works on a second display
    Given a task targets a window on an external display
    Then the cursor moves onto that display and is drawn at the correct size

  Scenario: Cursors leave when the task ends
    Given a task has finished
    Then every cursor for that task fades out within 1 second
```

```gherkin
@p0 @ux @mac
Feature: Cursor character

  Scenario: Cat reacts to the wake word
    Given the main cursor is idle
    When the user says "Hey Yumi"
    Then the cat's ears perk up
    When Yumi starts choosing the next action
    Then the cat's tail swishes

  Scenario: Click is a pounce on the exact point
    Given the next action is a click on a button
    When the cat pounces
    Then its paw tip lands on the click point
    And the click happens where the paw lands

  Scenario: Playfulness does not slow the task
    Given the cat leaps to a target across the screen
    Then the leap takes no longer than a normal move of about 300 ms

  Scenario: Ghost cursors are littermates
    Given a ghost cursor spawns
    Then it is the same cat drawn in the ghost's own color

  Scenario: Reduce motion
    Given the user has "Reduce motion" turned on
    When the cursor moves to a target
    Then it glides without leaping or pouncing

  Scenario: Cat stays sharp
    Given the cursor is on a display with a scale factor of 2
    Then the cat is drawn without blur or pixelation

  Scenario: Stuck cat is gentle
    Given the main cursor is stuck on a screen
    Then the cat does a confused paw-tap
    And no red or warning colors are used
```

## Cat behaviors

First draft, to be replaced by the real design.

| State | Cat behavior |
|---|---|
| Idle | Sits calmly, occasional blink |
| Listening | Ears perk up |
| Thinking | Tail swishes, eyes follow something |
| Moving | Trots or leaps to the target |
| Clicking | Pounces, paw lands on the click point |
| Waiting for the user | Sits and tilts its head |
| Paused | Curls up |
| Done | Stretches, looks pleased |
| Stuck or error | Confused paw-tap, never alarming |

## Animation tools

| Tool | Use | Notes |
|---|---|---|
| **Rive** (chosen) | Live cursor and phone app | Built-in state machine matches the cursor states, smooth blending between states, small files, native macOS and Android runtimes. Check current plans, since some export features may need a paid tier |
| Lottie (alternative) | Live cursor and phone app | Designed in After Effects or LottieFiles, plays natively on macOS and Android. Plays clips, so our code switches clips and smooths transitions |
| Remotion | Demo and pitch video only | Renders React to video. Not a live animation runtime, so not for the cursor |

## Decisions

- Yumi's character is a cat: playful, creative, moves around the screen like a cat. Decided 2026-10-09.
- Animation is vector based (SVG style), not ASCII. Decided 2026-10-09.
- **Rive** is the animation tool for the live cursor on the Mac and in the Android app. Decided 2026-10-09.
  - The cat's states are built as a Rive state machine. The app only sets the current state, and Rive blends the transitions.
  - We design with AI help through Rive's MCP server, which lets Claude Code or Cursor build artboards, shapes, state machines, and keyframes inside the Rive Editor.
  - The MCP server is only a design-time tool. It runs from the Rive desktop editor, which must be open. At runtime, Yumi plays the exported `.riv` file with Rive's native runtimes, fully offline.
  - Rive's MCP integration is in Early Access, so expect rough edges. Check current setup docs before connecting.
- The cat is a round ginger cat: ginger fur, three even cream stripes on the forehead, a cream patch over the right eye, cream bib and paw tips, cocoa outlines, and coral cheeks. This replaces the earlier black-and-white decision. The master art is `character/art/yumi-cat.svg`. Decided 2026-10-09 by Patrick.
- Ghost littermates are the same cat with its fur, markings, and lines recolored in the ghost's own color, such as mint or sky. The coral cheeks stay. This answers the open question about how ghost colors combine with the cat. Decided 2026-10-09 by Patrick.

## Open questions

- Final animation timing. To be designed later.
