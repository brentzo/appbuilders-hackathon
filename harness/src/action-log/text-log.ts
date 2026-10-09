import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ActionLogEntry, DeviceId, Lane, Step, Task, TaskStatus } from "@yumi/protocol/types";
import { describeError, type Logger } from "../log.ts";
import type { TaskStore } from "../store/task-store.ts";
import { LEGACY_MAC_DEVICE_ID } from "../device.ts";

/**
 * The action log file (SPEC-07 r18, OBJ-38.7): every action Yumi ran, blocked, or was told not to run, as plain
 * lines the user can open and read, one file per day in the support folder:
 *
 *   Action log/2026-10-09.txt
 *
 *   3:42 pm, Mac, main cursor: Clicked Export in Keynote
 *   3:43 pm, Mac, helper: Moved 2 files from Downloads to the Trash
 *       /Users/ana/Downloads/old-invoice.pdf
 *       /Users/ana/Downloads/old-receipt.pdf
 *   3:44 pm, Mac, task done ("export the deck as a PDF"): Read 3 files and clicked 12 times
 *
 * The task store is the source of truth; this file is written from it as each line is committed, and a task's count
 * line is written when the task ends. Times are local and am/pm. A delete lists every path on its own line. Nothing
 * here can hold typed text: descriptions never include it (src/scheduler/describe.ts).
 */

/** The folder for the action log files, in the support folder. */
export const ACTION_LOG_DIR = "Action log";

const LANE_NAMES: Record<Lane, string> = { helper: "helper", ghost: "ghost cursor", main: "main cursor" };

const ENDINGS: Partial<Record<TaskStatus, string>> = { done: "done", failed: "stopped", cancelled: "cancelled" };

/** "3:42 pm", in local time. */
export function clockTime(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
}

/** The day's file name, in local time: "2026-10-09.txt". */
export function dayFile(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.txt`;
}

/** One entry as lines: "3:42 pm, Mac, main cursor: Clicked Export in Keynote", then every path of a delete. */
export function formatEntry(entry: ActionLogEntry, device: string): string {
  const who = entry.lane ? `${device}, ${LANE_NAMES[entry.lane]}` : device;
  const line = `${clockTime(new Date(entry.time))}, ${who}: ${entry.description}`;
  return [line, ...(entry.paths ?? []).map((path) => `    ${path}`)].join("\n");
}

/** What counts as one activity of each kind, in the order the count line names them. */
const ACTIVITIES: readonly { key: string; one: string; many: (n: number) => string }[] = [
  { key: "read_file", one: "read 1 file", many: (n) => `read ${n} files` },
  { key: "list_dir", one: "looked in 1 folder", many: (n) => `looked in ${n} folders` },
  { key: "write_new_file", one: "created 1 file", many: (n) => `created ${n} files` },
  { key: "copy", one: "copied 1 file", many: (n) => `copied ${n} files` },
  { key: "move", one: "moved 1 file", many: (n) => `moved ${n} files` },
  { key: "move_to_trash", one: "moved 1 file to the Trash", many: (n) => `moved ${n} files to the Trash` },
  { key: "open_app", one: "opened 1 app", many: (n) => `opened ${n} apps` },
  { key: "open_file", one: "opened 1 file", many: (n) => `opened ${n} files` },
  { key: "open_url", one: "opened 1 web page", many: (n) => `opened ${n} web pages` },
  { key: "reveal_in_finder", one: "showed 1 item in Finder", many: (n) => `showed ${n} items in Finder` },
  { key: "phone", one: "used the phone once", many: (n) => `used the phone ${n} times` },
  { key: "click", one: "clicked once", many: (n) => `clicked ${n} times` },
  { key: "type", one: "typed once", many: (n) => `typed ${n} times` },
  { key: "key", one: "pressed 1 key", many: (n) => `pressed ${n} keys` },
  { key: "scroll", one: "scrolled once", many: (n) => `scrolled ${n} times` },
];

/**
 * The task's activity counts (SPEC-07 "Task summary includes activity counts"): "Read 3 files and clicked 12
 * times". Only actions that ran count. `trashed` is how many files each Trash step moved, from its log entry.
 */
export function activityCounts(steps: readonly Step[], trashed: (step: Step) => number = () => 1): string {
  const counts = new Map<string, number>();
  const add = (key: string, n = 1) => counts.set(key, (counts.get(key) ?? 0) + n);
  for (const step of steps) {
    if (step.outcome !== "ok") continue;
    const { action } = step.action;
    switch (action.kind) {
      case "tool":
        add(action.call.tool, action.call.tool === "move_to_trash" ? trashed(step) : 1);
        break;
      case "click":
      case "clickAt":
        add("click");
        break;
      case "type":
      case "setValue":
        add("type");
        break;
      case "key":
      case "scroll":
        add(action.kind);
        break;
      default:
        break;
    }
  }
  const parts = ACTIVITIES.filter((activity) => (counts.get(activity.key) ?? 0) > 0).map((activity) => {
    const n = counts.get(activity.key)!;
    return n === 1 ? activity.one : activity.many(n);
  });
  if (parts.length === 0) return "Did nothing on your devices";
  const sentence =
    parts.length === 1
      ? parts[0]!
      : parts.length === 2
        ? `${parts[0]} and ${parts[1]}`
        : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
  return sentence[0]!.toUpperCase() + sentence.slice(1);
}

export interface ActionLogFileOptions {
  /** The support folder. The files go in its `Action log` folder. */
  supportDir: string;
  store: TaskStore;
  logger: Logger;
  /** This Mac's device id, once known. Lines from it say "Mac", others say "phone". */
  macDeviceId?: () => DeviceId | undefined;
}

/**
 * Writes the action log file from the task store: each line as it is committed, and each task's count line when
 * it ends. Writing never fails a task: a file that cannot be written is logged, and the store keeps every line.
 */
export class ActionLogFile {
  readonly dir: string;
  private readonly stops: (() => void)[] = [];

  constructor(private readonly options: ActionLogFileOptions) {
    this.dir = join(options.supportDir, ACTION_LOG_DIR);
  }

  /** Starts writing every committed action log line and every task's count line. */
  start(): this {
    const { store } = this.options;
    this.stops.push(
      store.onActionLogged((entry) => this.write(new Date(entry.time), formatEntry(entry, this.device(entry.deviceId)))),
    );
    this.stops.push(
      store.onStatusChanged((event) => {
        if (event.subtaskId === undefined && ENDINGS[event.status]) this.writeCounts(event.taskId);
      }),
    );
    return this;
  }

  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  /** The count line for a task that ended: "3:44 pm, Mac, task done ("goal"): Read 3 files and clicked 12 times". */
  countLine(task: Task, at: Date): string {
    const { store } = this.options;
    const steps = store.listSubtasks(task.id).flatMap((subtask) => store.listSteps(subtask.id));
    // A Trash step counts every file it moved: the paths on its action log line.
    const counts = activityCounts(steps, (step) => store.getStepActionLog(step.id)?.paths?.length ?? 1);
    const goal = (task.confirmedGoal ?? task.goal).replace(/\s+/g, " ").trim();
    const shown = goal.length > 80 ? `${goal.slice(0, 77)}...` : goal;
    return `${clockTime(at)}, ${this.device(store.listActionLog(task.id).at(-1)?.deviceId)}, task ${ENDINGS[task.status]} ("${shown}"): ${counts}`;
  }

  private writeCounts(taskId: string): void {
    const task = this.options.store.getTask(taskId);
    if (!task) return;
    // When the task ended, by the store's clock.
    const at = new Date(task.updatedAt);
    this.write(at, this.countLine(task, at));
  }

  private device(deviceId: DeviceId | undefined): string {
    const mac = this.options.macDeviceId?.();
    return deviceId === undefined || mac === undefined || deviceId === mac || deviceId === LEGACY_MAC_DEVICE_ID ? "Mac" : "phone";
  }

  private write(at: Date, text: string): void {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      appendFileSync(join(this.dir, dayFile(at)), `${text}\n`, { mode: 0o600 });
    } catch (error) {
      this.options.logger.error("actionLog.writeFailed", describeError(error));
    }
  }
}
