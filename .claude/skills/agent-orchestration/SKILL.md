---
name: agent-orchestration
description: How the orchestrator runs worker agents on Yumi objectives in parallel - choosing objectives, creating a worktree and branch, opening a herdr tab, starting a Claude agent, writing its brief, monitoring it, stopping it, and merging its branch back into local main. Use when the lead asks to start, stop, check on, or merge work on an objective with an agent.
---

# Agent orchestration

The orchestrator is the lead's main agent session.
It delegates each objective to a worker agent in its own git worktree and herdr tab, watches it, and brings the finished branch back to local `main`.
Read the git-workflow skill too.

## Before starting a worker

1. Confirm the objective with the lead, or pick it from the generated waves table in `objectives/README.md`: the assignee's earliest `todo` objective whose `depends-on` are all `done`.
2. Check nobody else is already on it. Ask the lead if a teammate might be: two people on one objective wastes work.
3. Make sure local `main` has the latest objective and spec files committed, since the worktree starts from it.
4. Check the toolchain the objective needs (for example `java -version`, `node -v`, `swift --version`, the Android SDK). Workers must not install system tools, so tell them what is missing.

## Starting a worker

```bash
# 1. Worktree and branch from local main
git worktree add -b obj-NN-<slug> ~/Developer/appbuilders.worktrees/obj-NN-<slug> main

# 2. herdr tab in the hackathon workspace (find the id with `herdr workspace list`)
herdr tab create --workspace <workspace-id> --cwd ~/Developer/appbuilders.worktrees/obj-NN-<slug> --label "OBJ-NN <short>" --no-focus
#    note the root pane id from the output, for example wZ:p6

# 3. Start Claude in that pane
herdr agent start obj-NN --kind claude --pane <pane-id> --timeout 60000

# 4. Send the brief (write it to a file first, then point the agent at it)
herdr agent prompt obj-NN "Read the file <brief path>. It is your full brief from the orchestrator. Follow it exactly."

# 5. Watch it in the background; you are notified when it stops
herdr agent wait obj-NN --until idle --until done --until blocked
```

## Writing the brief

Restate everything. The worker has no memory of this conversation.
Use [brief-template.md](brief-template.md) and fill in:

- Where it is: worktree path, branch, base commit, and the rule to never push or touch `main`.
- What Yumi is, in three or four sentences, and where to start reading (`CLAUDE.md`, root README, product README).
- The objective file to follow, and the extra reading it needs.
- Every stand-in it must use for `integrates-with` work that is not done.
- Environment facts: installed tools, missing tools, devices it cannot reach.
- Boundaries: the folders it may change, and folders other people are working in right now.
- How to finish: the objective-lifecycle skill's Outcome, and a short final report.

## Monitoring

- `herdr agent read obj-NN` shows recent output. `herdr agent get obj-NN` shows its state.
- If it is `blocked`, read its output, answer what you can from the specs and objectives, and ask the lead the rest. Never invent an answer to a product question.
- Never claim a worker finished or reported something until you have read it.

## Stopping a worker

1. `herdr agent send-keys obj-NN esc` to interrupt, then wait for `idle`.
2. Inspect the branch: `git -C <worktree> log --oneline main..HEAD` and `git -C <worktree> status --short`.
3. If nothing worth keeping: `herdr tab close <tab-id>`, `git worktree remove <path>`, `git branch -D <branch>`. If something is worth keeping, ask the lead first.

## Bringing a finished branch back

1. Read the worker's final report and the objective's Outcome.
2. Review the diff against the objective's tasks and expectations. Check boundaries: no changes outside its product except allowed tables.
3. Rebase onto local `main` and resolve conflicts (git-workflow skill). Run `python3 scripts/objectives.py index`, then `python3 scripts/verify.py`.
4. Fast-forward local `main` to the rebased branch.
5. Close the tab, remove the worktree, delete the branch.
6. Tell the lead what landed, what was not verified, and that `main` is ready to push.
