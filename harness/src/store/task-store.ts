import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { validate } from "@yumi/protocol";
import type {
  ActionLogEntry,
  AppCapability,
  DeviceId,
  Lane,
  Path,
  RecordedAction,
  RouteReason,
  Step,
  StepOutcome,
  Subtask,
  SubtaskResult,
  SubtaskStatus,
  Target,
  Task,
  TaskDetail,
  TaskStatus,
  TaskStatusChanged,
  Uuid,
  WindowLock,
} from "@yumi/protocol/types";
import { describeError, type Logger } from "../log.ts";
import { migrate } from "./migrations.ts";
import {
  canChangeSubtaskStatus,
  canChangeTaskStatus,
  IllegalTransitionError,
  INITIAL_SUBTASK_STATUSES,
  INITIAL_TASK_STATUSES,
} from "./transitions.ts";

/**
 * The task store: the single source of truth for long-running work (SPEC-02), in SQLite through Node's built-in
 * `node:sqlite`. This is the only module that holds SQL. Every record it writes is checked against the protocol
 * schema first, every status change follows the table in transitions.ts and emits one `taskStatusChanged` event,
 * and nothing is ever deleted: tasks, subtasks, steps, the action log, and screenshots are kept forever (SPEC-02 r10).
 *
 * On disk, in the store's folder (the user's Application Support folder by default):
 *   tasks.db                            the database (with tasks.db-wal and tasks.db-shm while open)
 *   screenshots/<task id>/<step id>.png step screenshots, referenced by Step.screenshotPath
 *
 * Every write is synchronous and committed before the method returns, so a step written by `beginStep` is on disk
 * before its action runs (SPEC-02 r3).
 */

export const DATABASE_FILE = "tasks.db";
export const SCREENSHOTS_DIR = "screenshots";

const DEFAULT_PAGE_SIZE = 50;

export interface TaskStoreOptions {
  /** The folder for the database and the screenshots. Created if missing. */
  dir: string;
  logger: Logger;
  /** The clock, for tests. */
  now?: () => Date;
}

export interface NewTask {
  id?: Uuid;
  originDeviceId: DeviceId;
  goal: string;
  confirmedGoal?: string;
  /** Defaults to awaitingConfirmation. A goal confirmed on the other device can start queued or planning. */
  status?: TaskStatus;
}

/** Fields that change together with a task's status: the confirmed goal when it leaves awaitingConfirmation, and the summary when it ends. */
export interface TaskStatusFields {
  confirmedGoal?: string;
  summary?: string;
}

export interface NewSubtask {
  id?: Uuid;
  taskId: Uuid;
  title: string;
  instruction: string;
  dependsOn?: Uuid[];
  proposedLane: Lane;
  /** From the planner: the subtask needs keystrokes, so it runs on main (SPEC-03 r17). */
  needsKeyboard?: boolean;
  /** Defaults to pending. */
  status?: SubtaskStatus;
  target?: Target;
}

/** Subtask fields other than its status, set by the router and the workers. */
export interface SubtaskFields {
  lane?: Lane;
  routeReason?: RouteReason;
  target?: Target;
  workerId?: string;
  attempts?: number;
  result?: SubtaskResult;
  lastGoodStep?: Uuid;
}

export interface NewStep {
  id?: Uuid;
  subtaskId: Uuid;
  lane: Lane;
  action: RecordedAction;
}

/** What the action log needs from the caller when a step finishes. The time, task, lane, and outcome come from the step. */
export interface StepLogLine {
  deviceId: DeviceId;
  /** Plain language, for example "Clicked Export in Keynote". Never text typed into a password field. */
  description: string;
  /** Every path, for deletes. */
  paths?: Path[];
}

/**
 * How a step ended. An action that ran, was blocked, or was declined gets an action log line in the same
 * transaction. An invalid model output ran nothing, so it has none.
 */
export type StepResult =
  | { outcome: "invalidOutput"; observation?: string; durationMs?: number }
  | {
      outcome: Exclude<StepOutcome, "invalidOutput">;
      observation?: string;
      /** What a typed tool returned, for the next steps of this subtask. At most 4000 characters. */
      toolOutput?: string;
      durationMs?: number;
      log: StepLogLine;
    };

/** A task with everything recorded about it: the protocol's `TaskDetail`, always with its action log. */
export interface TaskHistory extends TaskDetail {
  /** In plan order. */
  subtasks: Subtask[];
  /** Grouped by subtask in plan order, then by step index. */
  steps: Step[];
  /** Oldest first. */
  actionLog: ActionLogEntry[];
}

export type StatusListener = (event: TaskStatusChanged) => void;

/** A record that breaks the protocol contract. A bug in the caller; nothing was written. */
export class InvalidRecordError extends Error {
  constructor(
    readonly typeName: string,
    readonly errors: string[],
  ) {
    super(`Invalid ${typeName}: ${errors.join("; ")}`);
    this.name = "InvalidRecordError";
  }
}

/** A request the store refuses because it would break the task record's rules, for example finishing a step twice. */
export class StoreRuleError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(message);
    this.name = "StoreRuleError";
  }
}

export class TaskStore {
  readonly dir: string;
  readonly dbPath: string;
  readonly screenshotsDir: string;
  private readonly db: DatabaseSync;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly listeners = new Set<StatusListener>();
  private readonly statements = new Map<string, StatementSync>();

  private constructor(options: TaskStoreOptions) {
    this.dir = resolve(options.dir);
    this.dbPath = join(this.dir, DATABASE_FILE);
    this.screenshotsDir = join(this.dir, SCREENSHOTS_DIR);
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    // Task records can hold private details, so only this user can read the file. SQLite gives the -wal and -shm
    // files the database file's permissions.
    closeSync(openSync(this.dbPath, "a", 0o600));
    this.db = new DatabaseSync(this.dbPath, { timeout: 5_000 });
  }

  /** Opens (or creates) the database in `dir` and brings its schema up to date. */
  static open(options: TaskStoreOptions): TaskStore {
    const store = new TaskStore(options);
    try {
      // WAL with full sync: a committed step survives a crash and a power loss.
      store.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
      store.db.function("yumi_matches", { deterministic: true }, (text, query) =>
        matchesQuery(String(text ?? ""), String(query ?? "")) ? 1 : 0,
      );
      const applied = migrate(store.db);
      store.logger.info("store.opened", { dbPath: store.dbPath, migrationsApplied: applied });
      return store;
    } catch (error) {
      store.db.close();
      throw error;
    }
  }

  close(): void {
    if (!this.db.isOpen) return;
    this.db.close();
    this.logger.info("store.closed", { dbPath: this.dbPath });
  }

  /** Calls `listener` after every committed status change. Returns a function that stops it. */
  onStatusChanged(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Tasks

  /** Creates a task. Its first status counts as a status change and emits one event. */
  createTask(input: NewTask): Task {
    const status = input.status ?? "awaitingConfirmation";
    if (!INITIAL_TASK_STATUSES.includes(status)) {
      throw this.illegal(new IllegalTransitionError("task", input.id ?? "(new)", "(new)", status));
    }
    const time = this.now();
    const task: Task = {
      id: input.id ?? randomUUID(),
      originDeviceId: input.originDeviceId,
      goal: input.goal,
      ...optional("confirmedGoal", input.confirmedGoal),
      status,
      plan: [],
      createdAt: time.toISOString(),
      updatedAt: time.toISOString(),
    };
    this.check("Task", task);
    this.stmt(
      `INSERT INTO tasks (id, origin_device_id, goal, confirmed_goal, status, plan, summary, created_at, created_ms, updated_at)
       VALUES ($id, $origin, $goal, $confirmed, $status, $plan, NULL, $createdAt, $createdMs, $updatedAt)`,
    ).run({
      id: task.id,
      origin: task.originDeviceId,
      goal: task.goal,
      confirmed: task.confirmedGoal ?? null,
      status: task.status,
      plan: JSON.stringify(task.plan),
      createdAt: task.createdAt,
      createdMs: time.getTime(),
      updatedAt: task.updatedAt,
    });
    this.emit({ taskId: task.id, status: task.status });
    return task;
  }

  getTask(id: Uuid): Task | undefined {
    const row = this.stmt("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
    return row && taskFromRow(row);
  }

  /** Changes a task's status, with the fields that change with it. Refuses and logs a change the table does not allow. */
  setTaskStatus(id: Uuid, status: TaskStatus, fields: TaskStatusFields = {}): Task {
    const task = this.transaction(() => {
      const current = this.requireTask(id);
      if (!canChangeTaskStatus(current.status, status)) {
        throw this.illegal(new IllegalTransitionError("task", id, current.status, status));
      }
      const next: Task = {
        ...current,
        ...optional("confirmedGoal", fields.confirmedGoal),
        ...optional("summary", fields.summary),
        status,
        updatedAt: this.now().toISOString(),
      };
      this.check("Task", next);
      this.stmt(
        "UPDATE tasks SET status = $status, confirmed_goal = $confirmed, summary = $summary, updated_at = $updatedAt WHERE id = $id",
      ).run({
        id,
        status: next.status,
        confirmed: next.confirmedGoal ?? null,
        summary: next.summary ?? null,
        updatedAt: next.updatedAt,
      });
      return next;
    });
    this.emit({ taskId: task.id, status: task.status });
    return task;
  }

  // Subtasks

  /** Adds a subtask at the end of its task's plan. Its first status counts as a status change and emits one event. */
  addSubtask(input: NewSubtask): Subtask {
    const subtask = this.newSubtask(input);
    const task = this.transaction(() => {
      const current = this.requireTask(input.taskId);
      this.insertSubtasks(current, [subtask]);
      return current;
    });
    this.emit({ taskId: task.id, status: task.status, subtaskId: subtask.id, subtaskStatus: subtask.status });
    return subtask;
  }

  /**
   * Saves a checked plan and starts the task (SPEC-02 r1): adds every subtask, in order, and moves the task from
   * planning to running, in one transaction, so a crash never leaves half a plan. The task must be planning and
   * have no subtasks yet. After the commit, emits one event for the task, then one per subtask.
   */
  savePlan(taskId: Uuid, subtasks: readonly Omit<NewSubtask, "taskId">[]): { task: Task; subtasks: Subtask[] } {
    const created = subtasks.map((input) => this.newSubtask({ ...input, taskId }));
    const task = this.transaction(() => {
      const current = this.requireTask(taskId);
      if (current.status !== "planning")
        throw this.illegal(new IllegalTransitionError("task", taskId, current.status, "running"));
      if (current.plan.length > 0) throw this.refuse("planAlreadySaved", `Task ${taskId} already has a plan`);
      this.insertSubtasks(current, created);
      const next: Task = { ...current, plan: created.map((s) => s.id), status: "running", updatedAt: this.now().toISOString() };
      this.check("Task", next);
      this.stmt("UPDATE tasks SET status = $status, updated_at = $updatedAt WHERE id = $id").run({
        id: taskId,
        status: next.status,
        updatedAt: next.updatedAt,
      });
      return next;
    });
    this.emit({ taskId, status: task.status });
    for (const subtask of created)
      this.emit({ taskId, status: task.status, subtaskId: subtask.id, subtaskStatus: subtask.status });
    return { task, subtasks: created };
  }

  getSubtask(id: Uuid): Subtask | undefined {
    const row = this.stmt("SELECT * FROM subtasks WHERE id = ?").get(id) as SubtaskRow | undefined;
    return row && subtaskFromRow(row);
  }

  /** A task's subtasks in plan order. */
  listSubtasks(taskId: Uuid): Subtask[] {
    const rows = this.stmt("SELECT * FROM subtasks WHERE task_id = ? ORDER BY position").all(taskId) as unknown as SubtaskRow[];
    return rows.map(subtaskFromRow);
  }

  /** Changes a subtask's status, with any other fields that change with it. Refuses and logs a change the table does not allow. */
  setSubtaskStatus(id: Uuid, status: SubtaskStatus, fields: SubtaskFields = {}): Subtask {
    const { subtask, task } = this.transaction(() => {
      const current = this.requireSubtask(id);
      if (!canChangeSubtaskStatus(current.status, status)) {
        throw this.illegal(new IllegalTransitionError("subtask", id, current.status, status));
      }
      const next = this.writeSubtask({ ...current, ...definedFields(fields), status });
      return { subtask: next, task: this.requireTask(next.taskId) };
    });
    this.emit({ taskId: task.id, status: task.status, subtaskId: subtask.id, subtaskStatus: subtask.status });
    return subtask;
  }

  /** Changes a subtask's other fields. Its status only changes through `setSubtaskStatus`. */
  updateSubtask(id: Uuid, fields: SubtaskFields): Subtask {
    return this.transaction(() => this.writeSubtask({ ...this.requireSubtask(id), ...definedFields(fields) }));
  }

  // Steps

  /**
   * The first half of the checkpoint rule (SPEC-02 r3): writes the step, with no outcome, before its action runs.
   * The step gets the next index in its subtask. The subtask must be running, and its previous step must have finished.
   */
  beginStep(input: NewStep): Step {
    return this.transaction(() => {
      const subtask = this.requireSubtask(input.subtaskId);
      if (subtask.status !== "running") {
        throw this.refuse("stepNeedsRunningSubtask", `Subtask ${subtask.id} is ${subtask.status}, not running`);
      }
      const unfinished = this.stmt("SELECT id FROM steps WHERE subtask_id = ? AND outcome IS NULL").get(subtask.id) as
        { id: string } | undefined;
      if (unfinished) {
        throw this.refuse("previousStepUnfinished", `Step ${unfinished.id} of subtask ${subtask.id} has no outcome yet`);
      }
      const { next } = this.stmt("SELECT count(*) AS next FROM steps WHERE subtask_id = ?").get(subtask.id) as { next: number };
      const time = this.now();
      const step: Step = {
        id: input.id ?? randomUUID(),
        subtaskId: subtask.id,
        index: next,
        lane: input.lane,
        action: input.action,
        startedAt: time.toISOString(),
      };
      this.check("Step", step);
      this.stmt(
        `INSERT INTO steps (id, subtask_id, step_index, lane, action, started_at, started_ms)
         VALUES ($id, $subtaskId, $index, $lane, $action, $startedAt, $startedMs)`,
      ).run({
        id: step.id,
        subtaskId: step.subtaskId,
        index: step.index,
        lane: step.lane,
        action: JSON.stringify(step.action),
        startedAt: step.startedAt,
        startedMs: time.getTime(),
      });
      return step;
    });
  }

  /**
   * The second half of the checkpoint rule: records how the step ended and how long it took, and writes its action
   * log line, in one transaction. The duration defaults to the time since the step began.
   */
  finishStep(id: Uuid, result: StepResult): Step {
    return this.transaction(() => {
      const row = this.requireStepRow(id);
      const current = stepFromRow(row);
      if (current.outcome !== undefined) {
        throw this.refuse("stepAlreadyFinished", `Step ${id} already has the outcome ${current.outcome}`);
      }
      const time = this.now();
      const step: Step = {
        ...current,
        outcome: result.outcome,
        ...optional("observation", result.observation),
        ...optional("toolOutput", "toolOutput" in result ? result.toolOutput : undefined),
        durationMs: result.durationMs ?? Math.max(0, time.getTime() - row.started_ms),
      };
      this.check("Step", step);
      this.stmt(
        "UPDATE steps SET outcome = $outcome, observation = $observation, tool_output = $toolOutput, duration_ms = $durationMs WHERE id = $id",
      ).run({
        id,
        outcome: step.outcome!,
        observation: step.observation ?? null,
        toolOutput: step.toolOutput ?? null,
        durationMs: step.durationMs!,
      });
      if (result.outcome !== "invalidOutput") {
        const subtask = this.requireSubtask(step.subtaskId);
        this.insertActionLog(
          {
            time: time.toISOString(),
            deviceId: result.log.deviceId,
            taskId: subtask.taskId,
            lane: step.lane,
            description: result.log.description,
            ...optional("paths", result.log.paths),
            outcome: result.outcome,
          },
          time,
          step.id,
        );
      }
      return step;
    });
  }

  /**
   * Saves a step's screenshot (PNG or JPEG bytes) as a file next to the database and keeps its path on the step.
   * A step has at most one screenshot, and a file is never replaced.
   */
  saveStepScreenshot(id: Uuid, image: Uint8Array): Step {
    const extension = imageExtension(image);
    if (!extension) throw this.refuse("screenshotNotAnImage", `Screenshot for step ${id} is not a PNG or JPEG`);
    return this.transaction(() => {
      const step = stepFromRow(this.requireStepRow(id));
      if (step.screenshotPath) throw this.refuse("screenshotAlreadySaved", `Step ${id} already has a screenshot`);
      const subtask = this.requireSubtask(step.subtaskId);
      const folder = join(this.screenshotsDir, subtask.taskId);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const path = join(folder, `${step.id}.${extension}`);
      const next: Step = { ...step, screenshotPath: path };
      this.check("Step", next);
      // "wx" never replaces a file. The file is written before the row, so a saved path always points at a file.
      writeFileSync(path, image, { flag: "wx", mode: 0o600, flush: true });
      this.stmt("UPDATE steps SET screenshot_path = $path WHERE id = $id").run({ id, path });
      return next;
    });
  }

  getStep(id: Uuid): Step | undefined {
    const row = this.stmt("SELECT * FROM steps WHERE id = ?").get(id) as StepRow | undefined;
    return row && stepFromRow(row);
  }

  /** A subtask's steps in order. */
  listSteps(subtaskId: Uuid): Step[] {
    const rows = this.stmt("SELECT * FROM steps WHERE subtask_id = ? ORDER BY step_index").all(subtaskId) as unknown as StepRow[];
    return rows.map(stepFromRow);
  }

  /** Steps that began but never got an outcome: the process stopped while their action ran (for resume, OBJ-06). */
  listUnfinishedSteps(): Step[] {
    const rows = this.stmt("SELECT * FROM steps WHERE outcome IS NULL ORDER BY started_ms, rowid").all() as unknown as StepRow[];
    return rows.map(stepFromRow);
  }

  // Action log

  /** Appends a line for an action that is not a step (a step's line is written by `finishStep`). The time is now. */
  appendActionLog(entry: Omit<ActionLogEntry, "time">): ActionLogEntry {
    const time = this.now();
    return this.transaction(() => this.insertActionLog({ ...entry, time: time.toISOString() }, time, undefined));
  }

  /** A task's action log, oldest first. */
  listActionLog(taskId: Uuid): ActionLogEntry[] {
    const rows = this.stmt("SELECT * FROM action_log WHERE task_id = ? ORDER BY id").all(taskId) as unknown as ActionLogRow[];
    return rows.map(actionLogFromRow);
  }

  // History

  /** Past tasks, newest first. `before` pages back: only tasks created before that time. */
  listTasks(options: { limit?: number; before?: string } = {}): Task[] {
    const before = options.before === undefined ? Number.MAX_SAFE_INTEGER : Date.parse(options.before);
    const rows = this.stmt("SELECT * FROM tasks WHERE created_ms < ? ORDER BY created_ms DESC, rowid DESC LIMIT ?").all(
      before,
      options.limit ?? DEFAULT_PAGE_SIZE,
    ) as unknown as TaskRow[];
    return rows.map(taskFromRow);
  }

  /**
   * Past tasks whose goal, confirmed goal, summary, or subtask titles contain every word of the query, newest first.
   * Matching ignores case and accents.
   */
  searchTasks(options: { query: string; limit?: number }): Task[] {
    const rows = this.stmt(
      `SELECT * FROM tasks AS t
       WHERE yumi_matches(
         t.goal || char(10) || coalesce(t.confirmed_goal, '') || char(10) || coalesce(t.summary, '') || char(10) ||
           coalesce((SELECT group_concat(s.title, char(10)) FROM subtasks AS s WHERE s.task_id = t.id), ''),
         $query)
       ORDER BY t.created_ms DESC, t.rowid DESC
       LIMIT $limit`,
    ).all({ query: options.query, limit: options.limit ?? DEFAULT_PAGE_SIZE }) as unknown as TaskRow[];
    return rows.map(taskFromRow);
  }

  /** Everything recorded about a task: subtasks, steps, and the action log. */
  getTaskHistory(taskId: Uuid): TaskHistory | undefined {
    const task = this.getTask(taskId);
    if (!task) return undefined;
    const steps = this.stmt(
      `SELECT steps.* FROM steps JOIN subtasks ON subtasks.id = steps.subtask_id
       WHERE subtasks.task_id = ? ORDER BY subtasks.position, steps.step_index`,
    ).all(taskId) as unknown as StepRow[];
    return {
      task,
      subtasks: this.listSubtasks(taskId),
      steps: steps.map(stepFromRow),
      actionLog: this.listActionLog(taskId),
    };
  }

  // Window locks and app capabilities: working state for the lane router (OBJ-07, OBJ-08), not history.

  /** Records a window lock, replacing any lock on the same window. */
  putWindowLock(lock: WindowLock): WindowLock {
    this.check("WindowLock", lock);
    this.stmt(
      `INSERT OR REPLACE INTO window_locks (window_id, subtask_id, lane, acquired_at, expires_at)
       VALUES ($windowId, $subtaskId, $lane, $acquiredAt, $expiresAt)`,
    ).run({ ...lock });
    return lock;
  }

  getWindowLock(windowId: number): WindowLock | undefined {
    const row = this.stmt("SELECT * FROM window_locks WHERE window_id = ?").get(windowId) as WindowLockRow | undefined;
    return row && windowLockFromRow(row);
  }

  listWindowLocks(): WindowLock[] {
    const rows = this.stmt("SELECT * FROM window_locks ORDER BY window_id").all() as unknown as WindowLockRow[];
    return rows.map(windowLockFromRow);
  }

  /** Releases a window lock. Returns false if the window was not locked. */
  releaseWindowLock(windowId: number): boolean {
    return Number(this.stmt("DELETE FROM window_locks WHERE window_id = ?").run(windowId).changes) > 0;
  }

  /** Records an app's probe result, replacing the earlier one for the same app version. */
  putAppCapability(capability: AppCapability): AppCapability {
    this.check("AppCapability", capability);
    this.stmt(
      `INSERT OR REPLACE INTO app_capabilities (bundle_id, app_version, accessibility, devtools, probed_at)
       VALUES ($bundleId, $appVersion, $accessibility, $devtools, $probedAt)`,
    ).run({
      ...capability,
      accessibility: capability.accessibility ? 1 : 0,
      devtools: capability.devtools ? 1 : 0,
    });
    return capability;
  }

  getAppCapability(bundleId: string, appVersion: string): AppCapability | undefined {
    const row = this.stmt("SELECT * FROM app_capabilities WHERE bundle_id = ? AND app_version = ?").get(bundleId, appVersion) as
      AppCapabilityRow | undefined;
    return (
      row && {
        bundleId: row.bundle_id,
        appVersion: row.app_version,
        accessibility: row.accessibility === 1,
        devtools: row.devtools === 1,
        probedAt: row.probed_at,
      }
    );
  }

  // Internals

  private stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private emit(event: TaskStatusChanged): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // The change is committed; a failing listener must not undo it or stop the others.
        this.logger.error("store.statusListenerFailed", { ...event, ...describeError(error) });
      }
    }
  }

  private check(typeName: string, value: unknown): void {
    const result = validate(typeName, value);
    if (result.valid) return;
    const error = new InvalidRecordError(typeName, result.errors);
    this.logger.error("store.invalidRecord", { typeName, errors: result.errors });
    throw error;
  }

  private illegal(error: IllegalTransitionError): IllegalTransitionError {
    this.logger.error("store.illegalTransition", { record: error.record, id: error.id, from: error.from, to: error.to });
    return error;
  }

  private refuse(rule: string, message: string): StoreRuleError {
    this.logger.error("store.refused", { rule, detail: message });
    return new StoreRuleError(rule, message);
  }

  private requireTask(id: Uuid): Task {
    const task = this.getTask(id);
    if (!task) throw this.refuse("unknownTask", `No task ${id}`);
    return task;
  }

  private requireSubtask(id: Uuid): Subtask {
    const subtask = this.getSubtask(id);
    if (!subtask) throw this.refuse("unknownSubtask", `No subtask ${id}`);
    return subtask;
  }

  private requireStepRow(id: Uuid): StepRow {
    const row = this.stmt("SELECT * FROM steps WHERE id = ?").get(id) as StepRow | undefined;
    if (!row) throw this.refuse("unknownStep", `No step ${id}`);
    return row;
  }

  /** A new subtask record from its input, checked against the contract. Not written yet. */
  private newSubtask(input: NewSubtask): Subtask {
    const status = input.status ?? "pending";
    if (!INITIAL_SUBTASK_STATUSES.includes(status)) {
      throw this.illegal(new IllegalTransitionError("subtask", input.id ?? "(new)", "(new)", status));
    }
    const subtask: Subtask = {
      id: input.id ?? randomUUID(),
      taskId: input.taskId,
      title: input.title,
      instruction: input.instruction,
      dependsOn: input.dependsOn ?? [],
      proposedLane: input.proposedLane,
      ...optional("needsKeyboard", input.needsKeyboard),
      ...optional("target", input.target),
      status,
      attempts: 0,
    };
    this.check("Subtask", subtask);
    return subtask;
  }

  /** Appends subtasks to a task's plan. Call inside a transaction. */
  private insertSubtasks(task: Task, subtasks: readonly Subtask[]): void {
    const plan = [...task.plan];
    for (const subtask of subtasks) {
      this.stmt(
        `INSERT INTO subtasks (id, task_id, position, title, instruction, depends_on, proposed_lane, needs_keyboard, target, status,
           attempts)
         VALUES ($id, $taskId, $position, $title, $instruction, $dependsOn, $proposedLane, $needsKeyboard, $target, $status, 0)`,
      ).run({
        id: subtask.id,
        taskId: subtask.taskId,
        position: plan.length,
        title: subtask.title,
        instruction: subtask.instruction,
        dependsOn: JSON.stringify(subtask.dependsOn),
        proposedLane: subtask.proposedLane,
        needsKeyboard: subtask.needsKeyboard === undefined ? null : Number(subtask.needsKeyboard),
        target: json(subtask.target),
        status: subtask.status,
      });
      plan.push(subtask.id);
    }
    this.stmt("UPDATE tasks SET plan = $plan, updated_at = $updatedAt WHERE id = $id").run({
      id: task.id,
      plan: JSON.stringify(plan),
      updatedAt: this.now().toISOString(),
    });
  }

  private writeSubtask(subtask: Subtask): Subtask {
    this.check("Subtask", subtask);
    this.stmt(
      `UPDATE subtasks SET lane = $lane, route_reason = $routeReason, target = $target, status = $status,
         worker_id = $workerId, attempts = $attempts, result = $result, last_good_step = $lastGoodStep
       WHERE id = $id`,
    ).run({
      id: subtask.id,
      lane: subtask.lane ?? null,
      routeReason: subtask.routeReason ?? null,
      target: json(subtask.target),
      status: subtask.status,
      workerId: subtask.workerId ?? null,
      attempts: subtask.attempts,
      result: json(subtask.result),
      lastGoodStep: subtask.lastGoodStep ?? null,
    });
    return subtask;
  }

  private insertActionLog(entry: ActionLogEntry, time: Date, stepId: Uuid | undefined): ActionLogEntry {
    this.check("ActionLogEntry", entry);
    this.stmt(
      `INSERT INTO action_log (time, time_ms, device_id, task_id, step_id, lane, description, paths, outcome)
       VALUES ($time, $timeMs, $deviceId, $taskId, $stepId, $lane, $description, $paths, $outcome)`,
    ).run({
      time: entry.time,
      timeMs: time.getTime(),
      deviceId: entry.deviceId,
      taskId: entry.taskId ?? null,
      stepId: stepId ?? null,
      lane: entry.lane ?? null,
      description: entry.description,
      paths: json(entry.paths),
      outcome: entry.outcome,
    });
    return entry;
  }
}

// Rows and mapping. Columns are snake_case; nested values are JSON text; absent optional fields are NULL.

interface TaskRow {
  id: string;
  origin_device_id: string;
  goal: string;
  confirmed_goal: string | null;
  status: TaskStatus;
  plan: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

interface SubtaskRow {
  id: string;
  task_id: string;
  title: string;
  instruction: string;
  depends_on: string;
  proposed_lane: Lane;
  needs_keyboard: number | null;
  lane: Lane | null;
  route_reason: RouteReason | null;
  target: string | null;
  status: SubtaskStatus;
  worker_id: string | null;
  attempts: number;
  result: string | null;
  last_good_step: string | null;
}

interface StepRow {
  id: string;
  subtask_id: string;
  step_index: number;
  lane: Lane;
  action: string;
  observation: string | null;
  outcome: StepOutcome | null;
  tool_output: string | null;
  screenshot_path: string | null;
  started_at: string;
  started_ms: number;
  duration_ms: number | null;
}

interface ActionLogRow {
  time: string;
  device_id: string;
  task_id: string | null;
  lane: Lane | null;
  description: string;
  paths: string | null;
  outcome: StepOutcome;
}

interface WindowLockRow {
  window_id: number;
  subtask_id: string;
  lane: Lane;
  acquired_at: string;
  expires_at: string;
}

interface AppCapabilityRow {
  bundle_id: string;
  app_version: string;
  accessibility: number;
  devtools: number;
  probed_at: string;
}

function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    originDeviceId: row.origin_device_id,
    goal: row.goal,
    ...optional("confirmedGoal", row.confirmed_goal),
    status: row.status,
    plan: JSON.parse(row.plan) as Uuid[],
    ...optional("summary", row.summary),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function subtaskFromRow(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    instruction: row.instruction,
    dependsOn: JSON.parse(row.depends_on) as Uuid[],
    proposedLane: row.proposed_lane,
    ...optional("needsKeyboard", row.needs_keyboard === null ? undefined : row.needs_keyboard === 1),
    ...optional("lane", row.lane),
    ...optional("routeReason", row.route_reason),
    ...optional("target", parseJson<Target>(row.target)),
    status: row.status,
    ...optional("workerId", row.worker_id),
    attempts: row.attempts,
    ...optional("result", parseJson<SubtaskResult>(row.result)),
    ...optional("lastGoodStep", row.last_good_step),
  };
}

function stepFromRow(row: StepRow): Step {
  return {
    id: row.id,
    subtaskId: row.subtask_id,
    index: row.step_index,
    lane: row.lane,
    action: JSON.parse(row.action) as RecordedAction,
    ...optional("observation", row.observation),
    ...optional("outcome", row.outcome),
    ...optional("toolOutput", row.tool_output),
    ...optional("screenshotPath", row.screenshot_path),
    startedAt: row.started_at,
    ...optional("durationMs", row.duration_ms),
  };
}

function actionLogFromRow(row: ActionLogRow): ActionLogEntry {
  return {
    time: row.time,
    deviceId: row.device_id,
    ...optional("taskId", row.task_id),
    ...optional("lane", row.lane),
    description: row.description,
    ...optional("paths", parseJson<Path[]>(row.paths)),
    outcome: row.outcome,
  };
}

function windowLockFromRow(row: WindowLockRow): WindowLock {
  return {
    windowId: row.window_id,
    subtaskId: row.subtask_id,
    lane: row.lane,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
  };
}

/** `{ [key]: value }`, or `{}` when the value is absent, so optional properties are left out rather than undefined. */
function optional<K extends string, V>(key: K, value: V | null | undefined): { [P in K]?: V } {
  return value === null || value === undefined ? {} : ({ [key]: value } as { [P in K]?: V });
}

/** The fields that were given, so `{ ...record, ...definedFields(fields) }` never writes undefined over a value. */
function definedFields<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function json(value: unknown): SQLInputValue {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson<T>(text: string | null): T | undefined {
  return text === null ? undefined : (JSON.parse(text) as T);
}

function imageExtension(image: Uint8Array): "png" | "jpg" | undefined {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => image[i] === byte)) return "png";
  if (image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return "jpg";
  return undefined;
}

/** Lower case, without accents, so "Résumé" matches "resume". */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** True when `text` contains every word of `query`, ignoring case and accents. An empty query matches nothing. */
export function matchesQuery(text: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const haystack = fold(text);
  return words.every((word) => haystack.includes(word));
}
