You are implementing objective OBJ-NN for Yumi, a hackathon project. I am the orchestrator agent coordinating several agents working in parallel; <lead> is the human lead and <assignee> owns this objective.

## Where you are

- Repo: a git worktree at <worktree path>, on branch `<branch>`, created from `main` at <short sha>.
- Work and commit only on this branch. Never push. Never check out, commit to, or rebase `main`.
- Read CLAUDE.md at the repo root first, then follow the git-workflow and objective-lifecycle skills in .claude/skills/.
- Others are working at the same time: <who is doing what, and in which folders>. Stay inside <allowed folders> plus your objective file and the generated tables, so merges stay clean.

## What Yumi is

<three or four sentences, including what this product does>

## Your objective

Read and follow objectives/<file> exactly. In short: <one or two sentences>.
Also read before starting: <extra reading>.

## Stand-ins

- <each integrates-with dependency that is not done, and exactly what to use instead>

## Environment

- <installed tools and versions>
- <missing tools: do not install system tools; record what could not be verified>
- <devices or services you cannot reach, and how to record those checks for the lead>

## How to finish

Follow the objective-lifecycle skill: verify every expectation, write the Outcome section, set the status to done, run `python3 scripts/objectives.py index` and `check`, and commit.
If a spec or the objective is wrong or unclear, stop and say so instead of quietly changing behavior.

End with a short report: what was done, the commits on the branch, anything not verified, and any questions for <lead>.
