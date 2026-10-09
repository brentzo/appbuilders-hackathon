---
name: spec-lifecycle
description: How to write, change, and decide on Yumi requirement specs in specs/, including requirements, Gherkin scenarios, tags, decisions, open questions, and resolving conflicts between specs. Use whenever you add or edit a spec, record a decision, answer an open question, or find two specs that disagree.
---

# Spec lifecycle

Specs in `specs/` define what Yumi must do.
They are the source of truth for behavior; objectives, docs, and code follow them.
The index is [specs/README.md](../../../specs/README.md).

## File shape

- One spec per feature: `specs/NN-<kebab-slug>.md`, with id `SPEC-NN`. Never reuse or renumber a spec id.
- Frontmatter: `id`, `title`, `priority` (`p0`, `p1`, `p2`; a spec with parts can list several), `devices` (`mac`, `android`, `iphone`), `status` (`draft`), and `tags` (`spec`, priorities, devices, areas).
- Sections in this order: `# SPEC-NN Title`, `## Summary`, `## Requirements`, `## Scenarios`, then optional reference sections (such as an error copy table or option tables), `## Decisions`, `## Open questions`, and optional `## Later (p1)` or `## Revisit after the hackathon`.
- Add every new spec to the table in `specs/README.md`.

## Requirements

- Numbered, one requirement per item, plain language, testable.
- Sub-parts of a spec (for example Part A and Part B) use `###` headings, but numbering continues across the whole spec.
- Inserting a requirement shifts later numbers. Before renumbering, search the repo for references (`rg -n "SPEC-NN" . | rg -i requirement`) and update every one in the same commit.

## Scenarios

- Gherkin inside fenced ```gherkin blocks, one `Feature` per block.
- The first line of each block is its tags, matching the frontmatter vocabulary: priority, devices, and areas (for example `@p0 @voice @mac`).
- Scenario names are unique within a spec. Objectives quote them exactly, so renaming a scenario means updating every objective that names it.
- Spoken and on-screen copy in scenarios is real copy. Errors use the exact copy from SPEC-11.
- Steps describe what the user sees and hears, not internal implementation.

## Decisions

- Every settled question becomes a bullet under `## Decisions`: the decision, the reason in one or two sentences, and `Decided YYYY-MM-DD.`
- When a decision replaces an earlier one, say so: "replacing the earlier ...".
- Remove the matching item from `## Open questions` in the same commit.
- If the decision changes requirements or scenarios, change them in the same commit.

## Open questions

- Keep only questions that are really open, each as one bullet.
- Never answer an open question yourself unless the lead asked you to decide. Present options with a recommendation instead.

## Conflicts between specs

1. When two specs disagree, do not silently pick one in code or in an objective.
2. Write the conflict down: which requirement or scenario in each spec, and what each says.
3. The lead decides (or explicitly delegates the decision). Record it under `## Decisions` in each affected spec, with the date.
4. Update every affected spec, doc, product README, and objective in one commit, and list the resolution in the "Resolved conflicts between specs" section of `objectives/README.md`.

## Ownership and teammates

- Specs are shared. Teammates edit them too, and their edits arrive through `git pull --rebase`.
- When a teammate's spec change conflicts with local work, keep their structure and wording, and apply only the minimal fix needed. Flag anything you think is wrong instead of rewriting it.

## After any spec change

- Update objectives whose tasks or expectations depend on the change.
- Run `python3 scripts/objectives.py check` (it validates links and spec references).
- Commit with `docs(spec-NN): <what changed>`.
