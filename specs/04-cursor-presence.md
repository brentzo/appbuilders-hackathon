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

1. The main cursor appears when the user starts speaking a goal: it comes out of the island (requirement 19) and leaps to a spot near the user's pointer.
2. Movement to a target eases in and out on a symmetric curve, cubic-bezier(0.65, 0, 0.35, 1), along a short arc. It takes 350 ms for a short hop and grows with distance up to 700 ms. It never teleports.
3. Each cursor has a visible state: listening, thinking, moving, acting, waiting for the user, paused.
4. The thinking state is shown while the model works, so a 1-4 second step never looks frozen.
5. Ghost cursors have their own color and a short label with the subtask title.
6. Helpers show as small status chips, not cursors.
7. The overlay never blocks clicks meant for the user's own pointer.
8. The overlay looks correct on every connected display, at every scale factor, in light and dark mode.
9. Cursors never pop in or out: they come out of the island, and leave by leaping back into it or fading out. No cursor stays on screen after its task ends.
10. Every Yumi cursor is a custom pointer with Yumi's character attached: a cat.
11. Yumi's personality is playful and creative. The cat moves around the screen like a cat would: trotting, leaping, pouncing.
12. The cat's pose and expression show the cursor's state (see "Cat behaviors").
13. A click is a pounce. The paw tip is the click point, and it is always clear exactly where Yumi will click.
14. Playfulness never slows a task. Leaps fit inside the normal movement time, and idle play happens only while Yumi is thinking.
15. Ghost cursors are the same cat in their own color, like littermates.
16. The cat is drawn from vector art and rendered for every display scale, so it stays sharp.
17. If the user has "Reduce motion" turned on, leaps, pounces, and arcs become straight glides, including the way into and out of the island.
18. The same cat appears in the Android app.
19. Cursors spawn from the camera notch "island": a pill grows out of the notch, the cat drops out of it and leaps to its spot. When a task finishes, its ghosts leap back into the island within 1 second. A display without a notch uses a pill at the top center, just under the menu bar.
20. Yumi speaks with a natural, warm, playful voice that fits the cat, made by a neural voice model running on the device. It is never the robotic system voice, and no speech is sent anywhere. If the voice cannot start, Yumi stays quiet instead of using the system voice, and shows the "Voice didn't load (Mac)" warning from [SPEC-11](11-user-facing-errors.md).
21. Yumi's cats never cover what the user is pointing at. When the user's pointer moves toward a cat and comes within about 24 points of the cat's body, the cat fades in place until the user can see through it, and fades back about a second after the pointer leaves. It never moves out of the way, in any state, so its click point, bubble, and thoughts panel stay where they are. An idle, thinking, or paused cat also lays its ears back, like a cat that does not want to be petted. A cat that appears next to a pointer that is not moving stays as it is. "Reduce motion" changes nothing here, since fading is not motion.

## Scenarios

```gherkin
@p0 @ux @mac
Feature: Cursor presence

  Scenario: Cursor moves smoothly to a target
    Given the main cursor is idle at one point
    When the next action is a click on a button across the screen
    Then the cursor moves there along an eased arc in 350 to 700 ms, depending on the distance
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

  Scenario: Cursors come out of the island
    Given the Mac has a camera notch
    When a ghost cursor spawns
    Then a pill grows out of the notch
    And the cat drops out of it and leaps to its spot
    When the ghost's task finishes
    Then the ghost leaps back into the island within 1 second

  Scenario: Island on a display without a notch
    Given the display has no camera notch
    When a cursor spawns
    Then the island is a pill at the top center, just under the menu bar
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
    Then the leap takes no longer than a normal move of that distance, at most 700 ms

  Scenario: Ghost cursors are littermates
    Given a ghost cursor spawns
    Then it is the same cat drawn in the ghost's own color

  Scenario: Reduce motion
    Given the user has "Reduce motion" turned on
    When the cursor moves to a target
    Then it glides in a straight line without leaping or pouncing

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
| **Vector poses** (chosen) | Live cursor and phone app | One pose per cursor state, drawn from the layered cat art and rendered for each display scale, moved with the platform's own animation (Core Animation on the Mac, Compose on Android). No animation runtime to ship |
| Rive (dropped) | Live cursor and phone app | Out of scope: see Decisions |
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
- Moves ease in and out on a symmetric curve, cubic-bezier(0.65, 0, 0.35, 1), with an arc, and take 350 to 700 ms by distance (requirement 2, design tokens `moveMinMs`, `moveMaxMs`, `moveFarPt`). With Reduce Motion on they are straight glides. This replaces the earlier "about 300 ms" and answers the open question on animation timing. Decided 2026-10-09 by Patrick.
- Cursors spawn from the camera notch "island" (requirement 19): a pill grows from the notch, the cat drops out and leaps to its spot, and on finish ghosts leap back in within 1 second. Displays without a notch use a pill at the top center under the menu bar. Decided 2026-10-09 by Patrick.
- Yumi's voice is a neural voice model on the device (Kokoro is the planned model, already named in the Mac README), not `AVSpeechSynthesizer`'s system voice, which sounded robotic in testing (requirement 20). Decided 2026-10-10 by Brent.
- Yumi's voice is Kokoro-82M with the af_heart voice, at speed 1.1, raised 7 semitones in total (4 inside the model with livelier intonation, 3 on playback), so it sounds small and cute. Its opening line (the first repeat-back of a goal) starts with the cat's meow sound, unless "Play sounds" is off. Brent picked it from voice samples. Decided 2026-10-10 by Brent.
- If Yumi's voice fails to load, Yumi says nothing rather than falling back to the system voice, so it never sounds broken. The Mac shows the "Voice didn't load (Mac)" warning (SPEC-11) in a panel that does not take focus, with Try again; the details go to the log. Decided 2026-10-10 by Brent.
- Cats avoid the user's pointer instead of covering content: idle, thinking, and paused cats scoot away, acting cats fade (requirement 21). Decided 2026-10-10 by Brent.
- How the dodge feels (requirement 21, OBJ-54): the hop is a quick, startled hop of about 200 ms (design token `avoidHopMs`), while the drift back keeps the normal move curve and duration; listening, moving, waiting-for-the-user, done, and stuck cats fade in place like acting ones; and a cat reacts only when the pointer moves toward it, measured from the cat's body, not its center, at about 24 points (`avoidRadiusPt`). So a cat that appears next to a still pointer, as the main cat does near the pointer (requirement 1), stays put. Decided 2026-10-10 by Brent.
- No cat hops out of the pointer's way any more: every cat, in every state and with or without Debug mode, fades in place when the user's pointer comes near and never moves away (requirement 21), replacing the earlier scoot and the startled hop above. A hopping cat took its bubble with it, so in Debug mode the user could not click it to see what the cat was thinking (SPEC-07 r23); fading keeps every bubble clickable and every click point still. The `avoidHopPt` and `avoidHopMs` design tokens are gone. Decided 2026-10-10 by Brent.

- Rive is out of scope and will not be implemented, replacing the earlier Rive decision above. The cat is drawn as vector poses, one per cursor state, rendered from the layered cat art for each display scale (`mac/scripts/render-cursor-cat.py` on the Mac), and moved with the platform's own animation: Core Animation on the Mac, Compose on Android. The Mac cursor already works this way, so a Rive file, its runtimes, and its state machine contract would add work without changing what the user sees. Requirement 16 now says the cat is drawn from vector art rather than with vector animation. Decided 2026-10-10 by Patrick.

## Open questions

None.
