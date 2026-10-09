// Run by test/window-locks.test.ts as a separate process: opens the store in the folder given as the first argument,
// takes Keynote's window 4182 for a running main subtask for a minute, prints the subtask id, and kills itself with
// SIGKILL while it holds the lock. No cleanup runs.
import { FileLogger } from "../../src/log.ts";
import { TaskStore } from "../../src/store/task-store.ts";
import { runningSubtask } from "../store-helpers.ts";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: crash-holding-lock.ts <store folder>");

const store = TaskStore.open({ dir, logger: new FileLogger(`${dir}/harness.log`) });
const { subtask } = runningSubtask(store);
const now = Date.now();
const result = store.acquireWindowLock({
  windowId: 4182,
  subtaskId: subtask.id,
  lane: "main",
  acquiredAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
});
if (!result.acquired) throw new Error("The window was already locked");
process.stdout.write(`locked ${subtask.id}\n`, () => {
  // The worker would act in the window here. The process dies holding the lock.
  process.kill(process.pid, "SIGKILL");
});
