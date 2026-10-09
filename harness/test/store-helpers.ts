import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { RecordedAction, Step, Subtask, Task } from "@yumi/protocol/types";
import { MemoryLogger } from "../src/log.ts";
import { TaskStore } from "../src/store/task-store.ts";
import { PROTOCOL_DIR } from "./helpers.ts";

/** The protocol's example recorded action: clicking "Export To" in Keynote. */
export function exampleAction(): RecordedAction {
  const step = JSON.parse(readFileSync(join(PROTOCOL_DIR, "examples", "Step.press-export.json"), "utf8")) as Step;
  return step.action;
}

/** A clock the test moves by hand. */
export class TestClock {
  constructor(public time = new Date("2026-10-09T07:40:00.000Z")) {}
  now = (): Date => new Date(this.time);
  advance(ms: number): void {
    this.time = new Date(this.time.getTime() + ms);
  }
  set(iso: string): void {
    this.time = new Date(iso);
  }
}

export function openStore(dir: string, clock = new TestClock(), logger = new MemoryLogger()): TaskStore {
  return TaskStore.open({ dir, logger, now: clock.now });
}

/** A confirmed task with one running subtask, ready for steps. */
export function runningSubtask(store: TaskStore, goal = "export my Keynote deck as a PDF"): { task: Task; subtask: Subtask } {
  const task = store.createTask({ originDeviceId: "mac-brent", goal });
  store.setTaskStatus(task.id, "planning", { confirmedGoal: goal });
  const subtask = store.addSubtask({
    taskId: task.id,
    title: "Export deck as PDF",
    instruction: "In Keynote, export the open deck to PDF in Downloads.",
    proposedLane: "main",
    status: "ready",
  });
  store.setTaskStatus(task.id, "running");
  store.setSubtaskStatus(subtask.id, "running", { lane: "main", workerId: "main-1", attempts: 1 });
  return { task: store.getTask(task.id)!, subtask: store.getSubtask(subtask.id)! };
}

/** A real, decodable PNG of `width` by `height` grey pixels, generated here so no binary fixture is checked in. */
export function tinyPng(width = 2, height = 2): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
