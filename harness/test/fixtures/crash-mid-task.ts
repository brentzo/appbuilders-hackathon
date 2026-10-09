// Run by test/resume-and-limits.test.ts as a separate process: runs a confirmed task through the real planner,
// scheduler, and typed file tools, against the test's mock model server, and kills itself with SIGKILL after its
// fourth step began and before that step's tool ran. No cleanup runs, like a crash.
// Usage: crash-mid-task.ts <support folder> <model base URL> <home folder> <goal>
import { FileLogger } from "../../src/log.ts";
import { ModelClient } from "../../src/model/client.ts";
import { fileHelperLane, type LaneRunner } from "../../src/scheduler/lanes.ts";
import { runTask } from "../../src/scheduler/run-task.ts";
import { TaskStore } from "../../src/store/task-store.ts";
import { modelConfig } from "../helpers.ts";

const [dir, baseUrl, home, goal] = process.argv.slice(2);
if (!dir || !baseUrl || !home || !goal)
  throw new Error("Usage: crash-mid-task.ts <support folder> <model base URL> <home> <goal>");

const logger = new FileLogger(`${dir}/harness.log`);
const store = TaskStore.open({ dir, logger });
const task = store.createTask({ originDeviceId: "mac-brent", goal });
store.setTaskStatus(task.id, "planning", { confirmedGoal: goal });

const files = fileHelperLane({ home, logger });
let calls = 0;
const lane: LaneRunner = {
  observe: () => Promise.resolve({ windowTitle: "Before the crash", elements: [] }),
  tools: {
    tools: files.tools.tools,
    run: async (call, signal) => {
      if (++calls === 4) {
        // The step is on disk without an outcome; the action would run here.
        await new Promise<void>((resolve) => process.stdout.write(`crashing ${task.id}\n`, () => resolve()));
        process.kill(process.pid, "SIGKILL");
      }
      return files.tools.run(call, signal);
    },
  },
};

await runTask(task.id, {
  store,
  client: new ModelClient(modelConfig(baseUrl), logger),
  logger,
  deviceId: "mac-brent",
  route: () => Promise.resolve({ lane: "helper", reason: "noUI" }),
  home,
  lanes: { helper: lane },
  slots: 1,
  voice: { speak: () => undefined, userError: () => undefined },
});
throw new Error("The task finished without crashing");
