// Run by test/task-store.test.ts as a separate process: opens the store in the folder given as the first argument,
// begins a step, prints its id, and kills itself with SIGKILL before the step's outcome is written. No cleanup runs.
import { FileLogger } from "../../src/log.ts";
import { TaskStore } from "../../src/store/task-store.ts";
import { exampleAction, runningSubtask } from "../store-helpers.ts";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: crash-mid-step.ts <store folder>");

const store = TaskStore.open({ dir, logger: new FileLogger(`${dir}/harness.log`) });
const { subtask } = runningSubtask(store);
const step = store.beginStep({ subtaskId: subtask.id, lane: "main", action: exampleAction() });
process.stdout.write(`began ${step.id}\n`, () => {
  // The action would run here. The process dies before finishStep.
  process.kill(process.pid, "SIGKILL");
});
