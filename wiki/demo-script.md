# Demo script

The hackathon demo, step by step: the exact line to say, what the audience should see, and what to do if a step fails.
Written 2026-10-10, 6 am, against `main`, from the live runs recorded in the objective Outcomes.
Each step says whether it has worked live.

## Before you start

Set up 15 minutes before, on the demo Mac and the paired phone ([setup guide](judges-setup.md)):

- The model server is running (`curl http://127.0.0.1:8080/health` answers `healthy`), and nothing else heavy is: no emulator, no Gradle, no Xcode build.
- Yumi is open from a Release build, without the mock, and the menu's status line no longer says "Yumi is getting ready".
- The phone is paired, on the internet, and Yumi's home screen is open on it.
- Keynote is open with the "Q3 Report" deck, the deck used in every live run.
- The Downloads folder has a handful of files with readable names.
- Auto mode is off in Settings, so the audience hears every repeat-back.
- Debug mode is on if you want to click a cat and show what it is thinking.
- Delete any `Q3 Report.pdf` left from a rehearsal, so the new one is visible.
- Have a screen recording of a good rehearsal ready to play; every "play the recording" fallback below means that recording.

## The script

### 1. The opener: Spotify from the phone

**Status: being fixed now** ([OBJ-75](../objectives/OBJ-75-vision-fallback.md)).
Spotify draws its own interface, so Yumi must click from a screenshot; that path is built and tested, but has not worked live yet.
Run this step only if Brent confirms it worked in the last rehearsal.

- **Say, to the phone:** "Hey Yumi, open my Spotify and play Discover Weekly."
- **The audience sees:** the phone says "You said: "open my Spotify and play Discover Weekly". Should I send it to your Mac?"
  After "Yes", the phone shows "Working on your Mac" with the current step, a cat appears on the Mac, opens Spotify, and starts the playlist.
- **If it fails:** tap Stop on the phone, say "Spotify draws its own screen, so Yumi has to work from a screenshot; we're finishing that now", and go straight to step 2 with the phone.

### 2. Keynote from the phone

**Status: worked live** on 2026-10-10 over the live relay (task `b1d6d145`, [OBJ-68](../objectives/OBJ-68-harness-delegated-goals.md)).

- **Say, to the phone:** "Hey Yumi, export my Q3 Report deck as a PDF."
- **The audience sees:** the phone says "You said: "export my Q3 Report deck as a PDF". Should I send it to your Mac?"
- **Say:** "Yes." (or tap Send)
- **The audience sees:** the phone shows "Working on your Mac" with each step's title.
  On the Mac, the cat comes out, and in Keynote opens File, Export To, PDF…, presses Save…, types the name, and presses Export.
  `Q3 Report.pdf` is saved, and the phone shows and says the summary.
  Nothing is said on the Mac for a phone goal; that is by design.
- **If it fails:**
  - The phone says it cannot reach the Mac, or stays on "Starting": the venue internet is the usual cause. Say the same goal on the Mac instead (step 3), which needs no internet.
  - The cat stops with "I'm stuck": press Resume once; if it stops again, play the recording.

### 3. Take-over and resume

**Status: Stop and Resume from the phone worked live** in the same run (task `b1d6d145`).
Taking the mouse on the Mac is built and tested, but has no recorded live run.

Do this in the middle of step 2, or of step 4.

- **Do:** tap Stop on the phone.
- **The audience sees:** the phone shows Paused only once the Mac has stopped, with Resume and Cancel; the cats on the Mac freeze.
- **Do:** tap Resume. The cat carries on from where it was.
- **Then, on the Mac:** while the cat works, take the mouse and move it across the screen.
- **The audience sees:** the cats freeze at once, and a panel says "Paused." with Resume and Cancel. Press Resume, and the cat carries on.
- **If it fails:** press Control-Option-Escape. Yumi says "Paused. Say continue when you're ready, or cancel to stop for good." Say "continue", or press Resume.

### 4. Keynote on the Mac, by voice

**Status: the export worked live**, in the measured runs on 2026-10-10 (3 of the 4 that got going saved a correct, named PDF, and run 61 saved it next to the deck, [OBJ-36](../objectives/OBJ-36-gui-act-sub-agent.md)) and from the phone in step 2.
The repeat-back and "Go ahead" on the Mac worked live ([OBJ-17](../objectives/OBJ-17-goal-confirmation.md)), but no run from "Hey Yumi" on the Mac to the saved PDF is recorded, so rehearse it once.
Skip this step if step 2 already showed the export and time is short.

- **Say, to the Mac:** "Hey Yumi, export my Q3 Report deck as a PDF."
- **The audience sees:** a cat appears by the pointer, meows, and says "You want me to export your Q3 Report deck as a PDF. Should I go ahead?", with Go ahead, Change it, and Cancel.
  The model writes the middle of that sentence, so the wording can differ a little.
- **Say:** "Go ahead."
- **The audience sees:** the cat works through Keynote's export as in step 2, and a summary card in the top right says what it did.
- **If it fails:**
  - Yumi did not hear "Go ahead": press the button.
  - "Hey Yumi" does nothing: hold ⌥Space, say the goal, and let go.
  - The cat stops: press Resume once, then play the recording.

### 5. A list into a note

**Status: built and tested; the final build has not been run live yet** ([OBJ-74](../objectives/OBJ-74-save-list-to-note.md)).
Earlier live tries failed (a "yes" that was not heard, and a click on "New Note" that lost the window), and both were fixed; the note is now written by a fixed script, not by the model.
Rehearse it once before the demo.

- **Say, to the Mac:** "Hey Yumi, list the files in my Downloads folder."
- **The audience sees:** the repeat-back offers the note: "You want me to list the files in your Downloads folder. Want it in a note too?"
- **Say:** "Yes." (a yes here means yes to the note)
- **The audience sees:** Yumi reads the folder, then the cat opens Notes, makes a new note, and types the full list.
  The summary says "I put the full list in a new note called" and the note's title, and the card shows the list.
- **If it fails:**
  - Yumi did not hear "Yes": say "Hey Yumi, yes", or hold ⌥Space and say it. The card stays up until it is answered.
  - The note fails: answer the same goal with "just list them" next time, then press "Save to Notes" on the card, or say "save it".
  - Still nothing: show the list on the card and move on.

### 6. Close

- **Say:** "Everything you just saw ran on this Mac and this phone. The relay in the middle only ever saw sealed messages."
- **Show, if asked:** the action log in `~/Library/Application Support/Yumi/Action log/`, one line per action.

## What not to promise on stage

- Approvals on the phone: an approval for a phone goal shows on the Mac.
- Alarms, timers, or anything that runs on the phone itself: every phone goal goes to the Mac.
- Sending mail: the approval card cannot read a Mail draft's recipients yet, so a send does not run.
- Several goals queued up: a second goal starts at once and competes for the model.
