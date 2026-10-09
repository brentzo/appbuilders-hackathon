// Runs gui_act on the real Mac app and the real model server (OBJ-36.11): one subtask in one app, N times, with the
// harness's own task store, gate, and step loop. Prints one JSON line per run: status, steps, attempts, seconds, the
// files it reported, and each step's action kind and outcome. Screen text stays in the task store and the log.
//
// Run: npm run gui:run -- --app Keynote --instruction "In Keynote, export ..." [--goal "..."] [--runs 5] [--first 41]
// "{run}" in the instruction becomes the run's number, from --first on, so each run can name its own file.
// --cancel id,id cancels tasks first, the way the app's cancelTask does, for test tasks left over from earlier runs.
// With --cancel alone, it cancels and stops without waiting for the Mac app.
// The lane router picks the lane, as in a real task.
// Start the model server first (README, "The local model server"), then this script, then the Mac app, which
// connects to harness.sock in YUMI_SUPPORT_DIR (default ~/Library/Application Support/Yumi). The script refuses to
// start while another harness is listening there.
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.ts";
import { startHarness } from "../src/harness.ts";
import { FileLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import { fileHelperLane } from "../src/scheduler/lanes.ts";

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    instruction: { type: "string" },
    goal: { type: "string" },
    runs: { type: "string", default: "1" },
    first: { type: "string", default: "1" },
    cancel: { type: "string" },
  },
});
const cancels = values.cancel?.split(",").filter(Boolean) ?? [];
if ((!values.app || !values.instruction) && cancels.length === 0) {
  console.error('Usage: npm run gui:run -- --app Keynote --instruction "..." [--goal "..."] [--runs 5]');
  process.exit(2);
}

const config = loadConfig();
const logger = new FileLogger(config.logPath);
const home = homedir();
// The harness with work, as a confirmed task would run: the lane router, the approval flow (OBJ-38), the pause and
// cancel methods, and gui_act on the connected Mac app.
const harness = await startHarness(config, logger, {
  work: {
    client: new ModelClient(config.model, logger),
    logger,
    deviceId: "mac-local",
    home,
    lanes: { helper: fileHelperLane({ home, logger }) },
    slots: 1,
  },
});
for (const taskId of cancels) {
  await harness.tasks.cancel(taskId);
  console.error(`Cancelled ${taskId}: ${harness.store.getTask(taskId)?.status}`);
}
if (!values.app || !values.instruction) {
  await harness.close();
  process.exit(0);
}
console.error(`Listening on ${config.socketPath}. Start the Mac app now. Log: ${config.logPath}`);
for (let waited = 0; harness.server.readyConnections === 0; waited += 250) {
  if (waited > 120_000) throw new Error("The Mac app did not connect within 2 minutes");
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const first = Number(values.first);
for (let run = first; run < first + Number(values.runs); run++) {
  const instruction = values.instruction.replaceAll("{run}", String(run));
  const goal = values.goal ?? instruction;
  const task = harness.store.createTask({ originDeviceId: "mac-local", goal });
  harness.store.setTaskStatus(task.id, "planning", { confirmedGoal: goal });
  const { subtasks } = harness.store.savePlan(task.id, [
    {
      title: instruction.slice(0, 60),
      instruction,
      proposedLane: "ghost",
      targetApp: { name: values.app },
      status: "ready",
    },
  ]);
  // The plan is fixed, so the planner does not vary between runs: the saved plan runs the way a resume runs it.
  harness.store.setTaskStatus(task.id, "paused");
  const started = Date.now();
  harness.tasks.resume(task.id);
  const outcome = (await harness.tasks.settled(task.id))!;
  const subtask = harness.store.getSubtask(subtasks[0]!.id)!;
  const steps = harness.store.listSteps(subtask.id);
  console.log(
    JSON.stringify({
      run,
      taskId: task.id,
      outcome: outcome.outcome,
      ...(outcome.outcome === "failed" ? { error: outcome.userError.kind } : {}),
      result: subtask.result,
      lane: subtask.lane,
      attempts: subtask.attempts,
      steps: steps.length,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      trace: steps.map((step) => `${step.action.action.kind}:${step.outcome}`),
    }),
  );
}
await harness.close();
