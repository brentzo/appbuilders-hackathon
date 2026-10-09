# Wiki

Reports and findings that are worth keeping but are not specs, objectives, or design docs.
A report records what was measured or observed, when, on which device, and what it means for the project.
Specs still decide behavior: if a report shows a spec is wrong, raise it and change the spec.

| Report | What it covers |
|---|---|
| [Android background survival](android-background-survival.md) | Whether Yumi's foreground service stays alive with the app in the background, on the development phone |
| [Android voice intake and wake word](android-voice-intake.md) | Push-to-talk, the wake word, battery, CPU, misses, false triggers, and traffic on the demo phone |
| ["Hey Yumi" on Android with Vosk](android-hey-yumi-vosk.md) | The Vosk spotter that replaces the "Hey Jarvis" stand-in: library, model, licences, and how often it wakes |
| [Yumi's neural voice on the Mac](mac-neural-voice.md) | The voice models compared, the one Brent picked, and its speed and memory next to Qwen3.5-9B |
| [Setup for judges](judges-setup.md) | How to run Yumi on your own Mac and Android phone, and how to run the tests |
| [Demo readiness](demo-readiness.md) | What works end to end for the hackathon demo, what is missing, the risks, and the actions before demo day |
| [Bridge acceptance](bridge-acceptance.md) | The relay's live check against SPEC-08, and the runbook and report for the run on the real Mac and phone |
| [Bridge deployment](bridge-deployment.md) | The relay on Brent's VPS: where it runs, the Snap Docker changes, and the live checks |
