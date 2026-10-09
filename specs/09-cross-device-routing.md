---
id: SPEC-09
title: Cross-device routing
priority: p0
devices: [mac, android]
status: draft
tags: [spec, p0, harness, bridge, mac, android]
---

# SPEC-09 Cross-device routing

## Summary

Each device advertises the tools it offers.
The device the user spoke to (the origin device) is the brain for that goal.
A brain either runs the goal itself, or delegates the whole confirmed goal to the other device's brain.
The result, approvals, and progress always come back to the origin device.

"Phone" means Android or iPhone. iPhone specifics are in [SPEC-12](12-iphone-companion.md).

## Requirements

### Tools

1. On connect, each device sends its tool list to the other through the bridge.
2. The Mac brain sees the phone's tools as a single `phone(tool, args)` tool, so the orchestrator stays within the 8-tool cap from [SPEC-05](05-mac-gui-control.md). The phone's tool list is described in that tool's schema.

### Who plans

3. A goal spoken on the Mac is planned on the Mac and may call phone tools.
4. A goal spoken on the phone is decided by the phone brain:
   - **p0:** a fixed rule, no model. Set alarm, set timer, and open app run on the phone through Android intents. Every other goal is delegated to the Mac.
   - **p1:** the phone's own model ([SPEC-10](10-android-companion.md) part B) decides instead of the rule.
5. Delegation sends the confirmed goal as text. The Mac does not ask the user to confirm it again.
6. A brain never plans the other device's individual steps. Only whole goals are delegated; only single tool calls cross the other way.

### Where the user sees things

7. The result is spoken on the origin device.
8. A goal from the phone that runs on the Mac spawns the visible cursor on the Mac.
9. While a delegated goal runs, the origin device shows "Working on your Mac" with the current subtask title and a **Stop** button.
10. Risky actions ([SPEC-07](07-safety.md)) ask for approval on the origin device. The executing device shows only a banner, "Waiting for your OK on your phone", with no buttons. The approval is a signed bridge message tied to that one action. If no approval arrives within 5 minutes, the task pauses.

### Stop from the other device

11. Stop on the origin device pauses the task on every device, as in [SPEC-06](06-user-control.md).
12. The origin device shows "Paused" only after the executing device confirms it paused. An action already in progress finishes; no new action starts.
13. If the executing device cannot be reached, the origin device says so and points to the stop shortcut on that device. It never claims the task is paused.

### Offline, busy, and timeouts

14. If the Mac is busy with another task, a delegated goal is queued behind it, and the origin device says so.
15. If the target device is offline, the goal becomes a queued goal held on the origin device, not on the VPS.
    - One queued goal per origin device. A new one replaces the old one after asking.
    - When the device reconnects, the goal is sent. If it waited more than 30 minutes, the user is asked again first.
16. Single tool calls (commands) expire after 2 minutes and are never queued. If the target is offline, the call fails at once and the brain tells the user.
17. If a delegated goal gets no progress update for 2 minutes, the origin device shows the reply-timeout error from [SPEC-11](11-user-facing-errors.md).

### Mac asleep (p1)

18. When the Mac is unreachable, the phone brain still runs phone-only goals. Goals that need the Mac become queued goals.
19. "Mac, gising" (or "wake up my Mac") sends Wake-on-LAN from the phone over the local Wi-Fi. The VPS cannot wake the Mac.
20. If the Mac wakes but is locked, the phone says "Your Mac is awake but locked. Unlock it and I'll continue." Yumi never stores or types the user's password.

## Scenarios

```gherkin
@p0 @harness @mac @android
Feature: Mac to phone

  Scenario: Set an alarm on the phone from the Mac
    Given the Mac and phone are paired and connected
    When the user says on the Mac "set an alarm on my phone for 6:30 am"
    And confirms the goal
    Then the Mac calls the phone tool "set_alarm"
    And an alarm for 6:30 am exists on the phone
    And the Mac says "Your alarm is set for 6:30 am on your phone."

  Scenario: Phone is offline when the Mac calls a tool
    Given the phone is offline
    When the Mac brain calls the phone tool "set_alarm"
    Then the call fails within 2 minutes without being queued
    And the Mac says the offline error from SPEC-11
```

```gherkin
@p0 @harness @mac @android
Feature: Phone to Mac

  Scenario: Phone-only goal runs on the phone
    Given the Yumi app is open on the phone
    When the user says "set a timer for 10 minutes"
    And confirms the goal
    Then the phone sets the timer with the set-timer intent
    And nothing is sent to the Mac

  Scenario: Phone goal is delegated to the Mac
    Given the Mac and phone are paired and connected
    When the user says on the phone "export my Keynote deck as a PDF"
    And confirms the goal
    Then the confirmed goal is sent to the Mac as text
    And the Mac does not ask for confirmation again
    And a cursor spawns on the Mac and exports the deck
    And the phone shows "Working on your Mac" with the current subtask title
    And the phone says "Done. Your deck is exported as a PDF on your Mac."

  Scenario: Approval is asked on the phone
    Given the user asked on the phone "email the Q3 deck to Ana"
    And the Mac has drafted the email
    When the next action is pressing Send
    Then the phone says "I'm about to send this email to Ana. Should I send it?"
    And shows "Send" and "Don't send" buttons
    And the Mac shows "Waiting for your OK on your phone" with no buttons
    When the user taps "Send" on the phone
    Then the Mac sends the email

  Scenario: No answer to an approval
    Given the phone is waiting for an approval
    When 5 minutes pass with no answer
    Then the task pauses
    And the phone shows "Resume" and "Cancel" buttons

  Scenario: Stop from the phone pauses the Mac
    Given a delegated goal is running on the Mac
    When the user taps "Stop" on the phone
    Then the Mac finishes the action in progress and starts no new one
    And the Mac confirms it paused
    And only then does the phone show "Paused"

  Scenario: Stop when the Mac cannot be reached
    Given a delegated goal is running on the Mac
    And the bridge is down
    When the user taps "Stop" on the phone
    Then the phone says "I can't reach your Mac to pause it. Use the stop shortcut on your Mac."
    And the phone does not show "Paused"

  Scenario: Mac is busy
    Given the Mac is running another task
    When the user delegates "export my Keynote deck as a PDF" from the phone
    Then the phone says "Your Mac is busy with another task. I'll start this right after."

  Scenario: Mac is offline
    Given the Mac is asleep
    When the user says on the phone "export my Keynote deck as a PDF"
    Then the phone says the offline error from SPEC-11
    And shows "Run it when my Mac is back" and "Cancel" buttons

  Scenario: Queued goal waited too long
    Given a queued goal has waited 3 hours on the phone
    When the Mac reconnects
    Then the phone says "Your Mac is back. Still want me to export your Keynote deck?"
    And nothing is sent until the user says yes
```

```gherkin
@p1 @harness @mac @android
Feature: Later cross-device goals

  Scenario: Fetch photos from the phone
    Given the Mac and phone are paired and connected
    When the user says on the Mac "send me the last 3 photos from my phone"
    And confirms the goal
    Then the phone sends the 3 most recent photos, resized to at most 2048 px
    And they appear in "Downloads/From phone" on the Mac

  Scenario: Goal that needs both devices
    Given the Mac and phone are paired and connected
    When the user says on the phone "send the PDF I just made on my laptop to Ana on WhatsApp"
    Then the goal is delegated to the Mac
    And the Mac sends the PDF to the phone
    And the phone opens WhatsApp with the PDF attached through the share intent
    And the user picks Ana and sends it

  Scenario: Wake the Mac from the phone
    Given the Mac is asleep and the phone is on the same Wi-Fi
    When the user says on the phone "Mac, gising"
    Then the phone sends Wake-on-LAN to the Mac
    And when the Mac reconnects the queued goal is sent

  Scenario: Mac wakes up locked
    Given the phone woke the Mac
    And the Mac is locked
    Then the phone says "Your Mac is awake but locked. Unlock it and I'll continue."
```

## Open questions

- Which phone-only goals belong in the p0 rule beyond alarm, timer, and open app?
