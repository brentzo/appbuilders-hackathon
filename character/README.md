# Yumi Character

Yumi is a cat: playful, creative, and always moving around the screen the way a cat would.
This product is the animated cat itself, a Rive file that both the Mac cursor and the Android app play.

Owner: Patrick.

Status: master art and video assets are done; the Rive file is next ([OBJ-10](../objectives/OBJ-10-yumi-cat-v0.md)).

## Responsibilities

- The Rive file (`yumi-cat.riv`) with a state machine covering every cursor state.
- The **state machine contract**: input names, types, and meanings that the apps rely on. Changing it is a breaking change for [mac](../mac/README.md) and [android](../android/README.md).
- The click point (hotspot): exactly where the paw tip is, so a pounce lands on the click.

## Cat behaviors

First draft from [SPEC-04](../specs/04-cursor-presence.md), to be replaced by the real design.

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

## Decisions

- Vector animation in Rive, not ASCII or video. Rive's state machine matches the cursor states, and Rive blends transitions.
- We design with AI help through Rive's MCP server, which runs from the Rive desktop editor (Early Access). It is a design-time tool only. The apps play the exported `.riv` file offline.
- Remotion is only for the demo or pitch video.
- The cat is black and white. Decided 2026-10-09 by Patrick, recorded in [SPEC-04](../specs/04-cursor-presence.md) Decisions.
- How the ghost littermates' own colors combine with black and white is still open in [SPEC-04](../specs/04-cursor-presence.md) Open questions.

## Assets

| Path | What |
|---|---|
| [art/yumi-cat.svg](art/yumi-cat.svg) | Layered master art, about 8 KB, every part named. The source for everything else |
| [assets/](assets/README.md) | Background-free stand-ins for the apps: one SVG, PNG set, and looping WebM per cursor state |
| [remotion/](remotion/README.md) | Remotion project for the demo and pitch video |

## Workflow

1. Open the Rive desktop editor with MCP enabled (follow Rive's current setup docs, since the connection address has changed between versions).
2. Connect Claude Code or Cursor to Rive's MCP server.
3. Edit artboards, shapes, the state machine, and keyframes.
4. Export `yumi-cat.riv` into this folder and update the contract below if inputs changed.

## State machine contract

To be defined in [OBJ-10](../objectives/OBJ-10-yumi-cat-v0.md).

## Specs

- [SPEC-04 Cursor presence](../specs/04-cursor-presence.md)

## Objectives

<!-- generated:product-objectives:start -->
| ID | Objective | Assignee | Status |
|---|---|---|---|
| [OBJ-10](../objectives/OBJ-10-yumi-cat-v0.md) | Yumi cat v0 in Rive | Patrick | todo |
<!-- generated:product-objectives:end -->
