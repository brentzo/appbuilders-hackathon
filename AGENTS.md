# Yumi

Yumi is a fully local, voice-driven AI companion for the Mac and Android phone, built for a local-AI hackathon.
You say "Hey Yumi" or use push-to-talk, Yumi repeats your goal back, and once you confirm, a cat-shaped cursor does the work across apps.
The Mac and phone control each other through an end-to-end encrypted bridge on our VPS.
All AI runs on the devices.
The harness, not the model, owns planning state, routing, checkpoints, and safety.

Start with [README.md](README.md) for the repo map, architecture, and key decisions.

## Where things are

| Path | What |
|---|---|
| `specs/` | Requirement specs with Gherkin scenarios. The source of truth for behavior |
| `objectives/` | Implementation objectives: tasks, expectations, status, assignee, Outcome |
| `docs/` | Design background. Older than the specs; the spec wins when they disagree |
| `protocol/`, `harness/`, `mac/`, `android/`, `iphone/`, `bridge/`, `character/`, `models/` | Products. Each has a README with its owner, boundaries, and plan |
| `scripts/objectives.py` | Regenerates objective tables and validates the docs |
| `scripts/verify.py` | Runs every check a change needs: docs, plus the build and tests of each product it touches |
| `.agents/skills/` | Repository skills. Read the matching skill before acting |

## Skills

Use the skill that matches what you are doing:

| Skill | Use it when |
|---|---|
| `objective-lifecycle` | Creating, editing, working, blocking, or finishing an objective, and writing its Outcome |
| `spec-lifecycle` | Adding or changing a spec, recording a decision, or resolving a conflict between specs |
| `product-lifecycle` | Adding a product, writing a product README, or changing an owner |
| `git-workflow` | Any commit, branch, rebase, merge, or conflict |
| `agent-orchestration` | Starting, watching, stopping, or integrating worker agents on an objective |
| `contracts-and-stand-ins` | Code that crosses products, or building against mocks and placeholders |
| `user-facing-errors` | Anything that can fail in front of a user |
| `grounding-and-verification` | Before stating a technical fact, choosing a model or library, or claiming something works |

## Team

- **Brent** is the lead. He decides and delegates.
- Everyone pushes their own work to `origin/main`.
- Owners are per product. See the owners table in [objectives/README.md](objectives/README.md).
- Each person writes code only in the products they own. Products meet at contracts in `protocol/`.

## Rules

- **Run `python3 scripts/verify.py` before every commit and again before every push.** It works out the checks from the files you changed: the docs check always, `npm run verify` for `protocol/` and `harness/` (a protocol change also runs the harness, which depends on it), the Gradle build, tests, and lint for `android/`, and the whisper tests for `models/whisper/`. A change to `specs/` also runs the protocol and Android tests, because they read SPEC-11. Never commit or push past a failure or a required check it could not run.
- **Push only your own work, after checks pass.** First run `git pull --rebase`, then `python3 scripts/verify.py` again on the rebased result, since someone else's push can break your change.
- **Never force-push.** An agent pushes only when its person asks in that session.
- **Never add `Co-Authored-By` or any agent attribution** to commits.
- **Specs win.** If a spec, objective, or doc disagree, or a spec is unclear, stop and raise it. Do not quietly change behavior or make product decisions.
- **Verify before claiming.** Read the file before citing it, run the build or test before saying it works, and check vendor sources for model, library, and device facts.
- **Generated tables are generated.** Never edit between `<!-- generated:... -->` markers. Run `python3 scripts/objectives.py index`.
- **Docs-only commits still run `python3 scripts/verify.py`.** It includes `python3 scripts/objectives.py check`.
- **Users never see internal errors:** no status codes, exception text, or vendor wording. Use SPEC-11 copy and structured error kinds.
- **Everything runs locally.** No cloud speech, no cloud models. The VPS only relays encrypted messages.

## Writing style

- Never use the em dash character. Use a plain dash.
- In Markdown, put each sentence on its own line.
- Times shown to users use am/pm.
- Never hand-edit `CHANGELOG.md` or files marked as generated.
