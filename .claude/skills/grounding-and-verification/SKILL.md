---
name: grounding-and-verification
description: Rules that keep agents from guessing in the Yumi repo - where the truth lives, how to verify facts about models, libraries, APIs, devices, and versions, how to mark estimates, and how to report what was and was not verified. Use before stating any technical fact, choosing a library or model, citing a spec or scenario, or claiming that something works or is done.
---

# Grounding and verification

Small mistakes compound across agents.
A wrong model size, an invented API, or a misquoted scenario becomes someone else's broken objective.
Ground every claim in a source you actually read.

## Where the truth lives

In order of authority:

1. **Specs** (`specs/`) for behavior, including their Decisions sections.
2. **Contracts** (`protocol/schemas/`) for every shape that crosses products.
3. **Objectives** (`objectives/`) for the work and its status, and their Outcome sections for what was actually built.
4. **Product READMEs** for boundaries, owners, and technical plans.
5. **Design docs** (`docs/`) for background. They may be older than the specs; when they disagree, the spec wins.

If two sources disagree, say so and ask. Do not pick one silently.

## Read before you claim

- Before naming a file, function, field, requirement number, or scenario, open it and check it exists with that exact name.
- Quote scenario names and error copy exactly. Do not paraphrase them.
- Before using a library API, check its current documentation or source. Do not rely on memory for method names, parameters, or defaults.
- Before saying something works, run it: the build, the test, the command. Report the actual output.

## Facts that change often

These go stale fast. Verify them against the vendor's own page (model card, official docs, release notes) before relying on them, and cite the source:

- Model names, sizes, quantized memory use, benchmark scores, and licenses.
- Library versions, package names and scopes, and platform APIs (macOS, Android, iOS versions and permissions).
- Pricing, free tiers, and terms of third-party services.
- Device specs. Example from this project: a phone sold as "12 GB + 6 GB" has 12 GB of real RAM; the extra 6 GB is storage used as swap.

## Estimates and unknowns

- Mark estimates as estimates, with the basis ("about 2.7 GB at 4-bit, estimated from parameter count").
- When you do not know, say so and say how to find out. A clear "not verified" is better than a confident guess.
- Never fill a gap in a spec with your own product decision. Present options with a recommendation and let the lead decide.

## Reporting

Every report or Outcome separates three things:

- **Done and verified:** with how it was verified.
- **Done but not verified:** with why, and exact steps for who can verify it.
- **Not done:** with the reason.

Never mark a checkbox, an objective, or a task as done to look finished.

## Tools that check for you

- `python3 scripts/objectives.py check` validates objective frontmatter, dependencies, status rules, generated tables, Markdown links, spec references, and the no-em-dash rule. Run it before committing documentation.
- `python3 scripts/verify.py` runs each touched product's build and tests (documented in its README). Run it before claiming code works.
