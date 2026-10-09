import type { DatabaseSync } from "node:sqlite";

/**
 * The task store's schema, as an ordered list of migrations. The database's `user_version` is the number of
 * migrations applied. Never edit or remove a migration that has shipped: add a new one at the end.
 *
 * Records are kept forever (SPEC-02 r10): triggers refuse deleting any row of tasks, subtasks, steps, or the action
 * log, and every update of the action log, so no code path can remove history by accident. Window locks and app
 * capabilities are working state, not history, so they can be replaced and released.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    origin_device_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    confirmed_goal TEXT,
    status TEXT NOT NULL,
    plan TEXT NOT NULL,
    summary TEXT,
    created_at TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX tasks_by_created ON tasks (created_ms DESC);

  CREATE TABLE subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks (id),
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    instruction TEXT NOT NULL,
    depends_on TEXT NOT NULL,
    proposed_lane TEXT NOT NULL,
    lane TEXT,
    route_reason TEXT,
    target TEXT,
    status TEXT NOT NULL,
    worker_id TEXT,
    attempts INTEGER NOT NULL,
    result TEXT,
    last_good_step TEXT,
    UNIQUE (task_id, position)
  ) STRICT;

  CREATE TABLE steps (
    id TEXT PRIMARY KEY,
    subtask_id TEXT NOT NULL REFERENCES subtasks (id),
    step_index INTEGER NOT NULL,
    lane TEXT NOT NULL,
    action TEXT NOT NULL,
    observation TEXT,
    outcome TEXT,
    screenshot_path TEXT,
    started_at TEXT NOT NULL,
    started_ms INTEGER NOT NULL,
    duration_ms INTEGER,
    UNIQUE (subtask_id, step_index)
  ) STRICT;
  CREATE INDEX steps_without_outcome ON steps (subtask_id) WHERE outcome IS NULL;

  CREATE TABLE window_locks (
    window_id INTEGER PRIMARY KEY,
    subtask_id TEXT NOT NULL REFERENCES subtasks (id),
    lane TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE app_capabilities (
    bundle_id TEXT NOT NULL,
    app_version TEXT NOT NULL,
    accessibility INTEGER NOT NULL,
    devtools INTEGER NOT NULL,
    probed_at TEXT NOT NULL,
    PRIMARY KEY (bundle_id, app_version)
  ) STRICT;

  CREATE TABLE action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    time_ms INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    task_id TEXT REFERENCES tasks (id),
    step_id TEXT REFERENCES steps (id),
    lane TEXT,
    description TEXT NOT NULL,
    paths TEXT,
    outcome TEXT NOT NULL
  ) STRICT;
  CREATE INDEX action_log_by_task ON action_log (task_id, id);

  CREATE TRIGGER tasks_kept_forever BEFORE DELETE ON tasks
    BEGIN SELECT RAISE(ABORT, 'task records are kept forever'); END;
  CREATE TRIGGER subtasks_kept_forever BEFORE DELETE ON subtasks
    BEGIN SELECT RAISE(ABORT, 'task records are kept forever'); END;
  CREATE TRIGGER steps_kept_forever BEFORE DELETE ON steps
    BEGIN SELECT RAISE(ABORT, 'task records are kept forever'); END;
  CREATE TRIGGER action_log_kept_forever BEFORE DELETE ON action_log
    BEGIN SELECT RAISE(ABORT, 'the action log is kept forever'); END;
  CREATE TRIGGER action_log_append_only BEFORE UPDATE ON action_log
    BEGIN SELECT RAISE(ABORT, 'the action log is append-only'); END;
  `,
  // 2: the planner marks subtasks that need the keyboard (SPEC-03 r17). NULL when the planner left it out.
  `
  ALTER TABLE subtasks ADD COLUMN needs_keyboard INTEGER;
  `,
  // 3: what a typed tool returned, for the next steps of the same subtask (Step.toolOutput). NULL for other steps.
  `
  ALTER TABLE steps ADD COLUMN tool_output TEXT;
  `,
  // 4: the app the planner said a subtask works in (Subtask.targetApp), as JSON. NULL for work with no app window.
  `
  ALTER TABLE subtasks ADD COLUMN target_app TEXT;
  `,
  // 5: resume and limits (OBJ-06). tasks.interrupted is 1 while a task that a restart paused waits for the user to
  // say whether to pick up where it left off; it is 0 for every other task. subtasks.parent_subtask_id is the
  // subtask that asked for this one, for the depth limit (SPEC-02 r8); NULL for a subtask the planner made.
  `
  ALTER TABLE tasks ADD COLUMN interrupted INTEGER NOT NULL DEFAULT 0 CHECK (interrupted IN (0, 1));
  ALTER TABLE subtasks ADD COLUMN parent_subtask_id TEXT REFERENCES subtasks (id);
  `,
];

/** Thrown when the database was written by a newer harness, whose schema this one does not know. */
export class NewerDatabaseError extends Error {}

/** Applies every migration the database does not have yet, each in its own transaction. Returns how many ran. */
export function migrate(db: DatabaseSync): number {
  const current = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (current > MIGRATIONS.length) {
    throw new NewerDatabaseError(`The task database is at version ${current}; this harness knows ${MIGRATIONS.length}`);
  }
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return MIGRATIONS.length - current;
}
