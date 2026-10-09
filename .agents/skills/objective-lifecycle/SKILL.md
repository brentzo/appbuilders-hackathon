---
name: objective-lifecycle
description: How to create, edit, start, block, work, and finish a Yumi objective in objectives/. Use whenever you write or change an objective file, pick up an objective to implement, change an objective's status or assignee, or finish one and write its Outcome.
---

# Objective lifecycle

Objectives turn specs into work.
Each one is a short, actionable group of tasks for one product and one assignee, written so a fresh session with no memory can pick it up and finish it.
Specs say what Yumi must do and are the source of truth for behavior; objectives say how we get there.

## Files and generated tables

- One file per objective: `objectives/OBJ-NN-<kebab-slug>.md`. `NN` is two digits and never reused, even if an objective is deleted.
- The template is [template.md](template.md). Copy it; do not invent sections.
- The frontmatter is the source of truth for status, assignee, and dependencies.
- The tables in `objectives/README.md` and in each product README sit between `<!-- generated:...:start -->` and `<!-- generated:...:end -->` markers. Never edit them by hand.
- After any objective change, run `python3 scripts/objectives.py index`, then `python3 scripts/objectives.py check`. Commit only when `python3 scripts/verify.py` passes.

## Frontmatter fields

| Field | Rule |
|---|---|
| `id` | `OBJ-NN`, matching the file name |
| `title` | Short, starts with a noun or verb phrase. Quote it if it contains quotes |
| `product` | Exactly one top-level product folder (a folder whose README has an `Owner:` line) |
| `assignee` | One person. Defaults to the product owner. Must be a product owner name |
| `touches` | Other products whose code this objective changes. Prefer `[]`: each person writes code only in their own product |
| `specs` | The specs it implements, as `SPEC-NN` |
| `status` | `todo`, `in-progress`, `blocked`, or `done` |
| `priority` | `p0` (needed for the demo), `p1`, or `p2` |
| `depends-on` | Hard dependencies: objectives that must be `done` before this one starts |
| `integrates-with` | Soft dependencies: work built against a stand-in now and connected later. Never a reason to wait |
| `tags` | `objective`, the priority, the product, and areas such as `voice`, `gui`, `bridge`, `ux`, `safety` |

## Creating an objective

1. Only create objectives for specs whose decisions are final. If a spec still has open questions that affect the work, raise them instead.
2. Take the next unused `NN`. Check with `ls objectives/`.
3. Keep it small: 5 to 10 tasks, one product, one assignee. If it needs more, split it.
4. Fill every section of the template:
   - **Project context:** copy the shared brief exactly from an existing objective. If the brief itself needs to change, change it in every objective in one commit.
   - **Why this objective:** where it fits and what it unlocks, in 2 to 4 sentences.
   - **Read first:** real paths only. Check each one exists.
   - **Tasks:** numbered `OBJ-NN.1`, `OBJ-NN.2`, in the order to do them. Each task is one concrete action with a clear end.
   - **Expectations:** verifiable checkboxes. Name Gherkin scenarios exactly as written in the spec (copy, do not paraphrase).
   - **Expected outcomes:** the files, modules, interfaces, or documents that should exist when done.
   - **Out of scope:** what not to do here, with a link to the objective or spec where it belongs.
   - **Outcome:** leave the placeholder line from the template.
5. Minimize cross-person blocking. If the work needs something another person owns, prefer a contract in `protocol/` plus a stand-in (see the contracts-and-stand-ins skill) and list it under `integrates-with`, not `depends-on`.
6. Run `index` and `check`, then commit with `docs(objectives): add OBJ-NN <short title>`.

## Editing an objective

- Never renumber an objective. If you insert or remove tasks, renumber the tasks within that objective in order, then search the repo for references to the old task ids (`rg -n "OBJ-NN\." .`).
- If you change `depends-on`, `integrates-with`, `assignee`, or `status`, run `index` and `check`.
- If a spec changes under an objective, update the objective's tasks and expectations in the same commit, and say what changed in the commit message.
- Reassigning is fine. Update `assignee` and run `index`.

## Working an objective

1. Pick a `todo` objective assigned to you whose `depends-on` objectives are all `done`.
2. Read everything under "Read first", the product README, and the specs it lists. Read the Outcome of every objective it depends on or integrates with that is already done.
3. Set `status: in-progress`, run `index`, and commit (`docs(objectives): start OBJ-NN`).
4. Work the tasks in order. Check each box when its task is complete, not before.
5. Use stand-ins for every `integrates-with` objective that is not done yet, exactly as the objective names them.
6. Verify each expectation. A named Gherkin scenario must pass as written. Check a box only after you verified it.
7. If something cannot be verified in your environment (a physical phone, a missing tool), leave the box unchecked and record it under "Not verified" in the Outcome, with exact steps for the person who can.

## Blocking

- If you cannot continue because of something outside the objective, set `status: blocked`.
- Replace the Outcome placeholder with a short "Blocked" note: what blocks it, who can unblock it, and what was already done.
- When unblocked, set it back to `in-progress` and remove the note.

## Finishing: writing the Outcome

An objective is `done` only when every task and expectation is checked and the Outcome is written.
Replace the placeholder with this structure:

```markdown
## Outcome

- **Result:** Done.
- **Delivered:** what now exists, with paths (for example `harness/src/store/`, `protocol/schemas/task.json`).
- **Commits:** the commits on the branch, as `abc1234 subject`.
- **Expectations:** one line per expectation saying how it was verified (test name, command, manual check).
- **Not verified:** anything that could not be verified here and why, with exact steps for who can. Write "Nothing." if none.
- **Decisions and deviations:** choices made that the objective left open, and anything that differs from the objective or spec, with the reason. Write "None." if none.
- **For the next objectives:** what dependents and integrators need to know: interfaces, file locations, commands, gotchas.
```

Then set `status: done`, run `index` and `check`, and commit (`docs(objectives): finish OBJ-NN`).
If some expectations could not be verified, the objective can still be `done` only if the unverified items are listed and the lead agrees. Otherwise leave it `in-progress`.

## Never

- Never mark a task or expectation checked without doing or verifying it.
- Never change a spec's behavior from inside an objective. Raise it with the spec-lifecycle skill.
- Never edit generated tables by hand.
- Never leave the Outcome placeholder on a `done` objective. The check script fails on it.
