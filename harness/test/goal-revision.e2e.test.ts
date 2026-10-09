import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import type { GoalRestated } from "@yumi/protocol/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryLogger } from "../src/log.ts";
import { PLANNER_SYSTEM_PROMPT } from "../src/planner/prompt.ts";
import { fileHelperLane } from "../src/scheduler/lanes.ts";
import { tempDir } from "./helpers.ts";
import { startMockModelServer } from "./mock-model-server.ts";
import { content, finish, plan, startWithMac, type RunningHarness } from "./support/harness-run.ts";
import { until } from "./support/mock-mac.ts";

vi.setConfig({ testTimeout: 30_000 });

describe("OBJ-61 goal revision end to end", () => {
  let dir: { path: string; cleanup: () => void };
  let home: string;
  let model: Awaited<ReturnType<typeof startMockModelServer>>;
  let run: RunningHarness | undefined;

  beforeEach(async () => {
    dir = tempDir();
    home = join(dir.path, "home");
    mkdirSync(join(home, "Documents"), { recursive: true });
    model = await startMockModelServer();
  });

  afterEach(async () => {
    await run?.close();
    await model.close();
    dir.cleanup();
  });

  it.skipIf(platform() === "win32")(
    "interrupts, repeats back, confirms, replans, records the revision, and completes",
    async () => {
      let oldWorkerStarted = false;
      let revisedPlan = false;
      model.respond((body) => {
        const request = body as { messages: { content: string }[] };
        const system = request.messages[0]!.content;
        const prompt = request.messages[1]!.content;
        if (system.includes("revising the goal of a task"))
          return content({ goal: "write a note about the launch", leftBehindSubtaskIds: [] });
        if (system === PLANNER_SYSTEM_PROMPT) {
          revisedPlan = prompt.includes("write a note about the launch");
          return {
            kind: "content",
            content: revisedPlan
              ? plan({ id: "note", title: "Write a note", instruction: "Write a launch note in Documents." })
              : plan({ id: "old", title: "Old work", instruction: "Wait for the user." }),
          };
        }
        if (!oldWorkerStarted) {
          oldWorkerStarted = true;
          return { kind: "hang" };
        }
        return finish("Wrote the launch note.");
      });

      run = await startWithMac({
        dir: dir.path,
        home,
        logger: new MemoryLogger(),
        model,
        lanes: { helper: fileHelperLane({ home }) },
      });
      const task = run.startTask("do the old task");
      await until(() => oldWorkerStarted);
      expect(await run.mac.call("pause", { taskId: task.id, scope: "uiLanes" })).toEqual({});
      expect(run.harness.store.getTask(task.id)?.status).toBe("paused");

      expect(await run.mac.call("reviseGoal", { taskId: task.id, transcript: "write a note about the launch" })).toEqual({});
      await until(() => run!.mac.events.some((event) => event.event === "goalRestated"));
      const restated = run.mac.events.find((event) => event.event === "goalRestated")!.payload as GoalRestated;
      expect(restated.text).toBe("write a note about the launch");

      expect(
        await run.mac.call("replyToConfirmation", { taskId: task.id, reply: { kind: "button", choice: "goAhead" } }),
      ).toEqual({});
      await until(() => run!.harness.store.getTask(task.id)?.status === "done");
      const saved = run.harness.store.getTask(task.id)!;
      expect(revisedPlan).toBe(true);
      expect(saved.confirmedGoal).toBe("write a note about the launch");
      expect(saved.goalRevisions).toHaveLength(1);
      expect(saved.goalRevisions[0]).toMatchObject({
        userSaid: "write a note about the launch",
        goal: "write a note about the launch",
      });
      expect(run.harness.store.listActionLog(task.id).map((entry) => entry.description)).toContain(
        "Changed the goal to: write a note about the launch",
      );
    },
  );
});
