# Task Service

Per-file task CRUD on `TodoData/<List>.md`. Always parse → mutate array → serialize inside `AtomicIOPipeline.processFile`.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `TaskService` (`src/services/TaskService.ts`) | `getTasks`, `saveTasks`, `addTask`, `updateTask`, `deleteTask`, `moveTask`, `rolloverTasksInFile` | Sidebar metadata, linked-note file create, Svelte |
| `insertTaskBeforeCompleted` (private) | `tasks.unshift(task)` (new/moved tasks go to index 0) | Date/recurrence rules |
| `MarkdownParser` / `RecurrenceService` | Called as pure helpers | — |

## Key Invariants

1. Every mutating method re-reads the file inside `processFile` rather than trusting a caller-held array. (Why chosen over passing `TaskItem[]` from the UI: two leaves could race.)
2. `updateTask` rewrites the file as `[...incomplete, ...completed]`. (Why chosen over in-place index replace: completed rows stay at the bottom after checkbox toggle.)
3. `moveTask` is sequential, not a two-file transaction: remove from source, then insert on target. If source find fails, target is not written. (Why chosen over a journal: Obsidian `process` is per-file only.)

## Numbered Data Flow

1. `getTasks(filepath)` → `io.readFile` → `parseTasksFromMarkdown`.
2. Deduplicate by `id` (first wins). If duplicates dropped, `needsSave = true`.
3. `RecurrenceService.rolloverTasks(uniqueTasks, todayStr)`; if changed, `needsSave = true`.
4. If `needsSave`, `saveTasks` rewrites the file (auto-heal + rollover).
5. `addTask` parses, `createTask(title)`, `unshift`, serialize.
6. `updateTask` / `deleteTask` use `findTaskIndex`; missing target logs a warning and returns original `data`.
7. `moveTask`: process source (splice out) then process target (`unshift`). Same-path is a no-op.
8. `rolloverTasksInFile` is the background path used by `DataService.rolloverRecurringTasks` (no-op serialize if unchanged).

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `getTasks` | `(filepath: string): Promise<TaskItem[]>` | May rewrite file (dedupe / rollover); `Logger.log` |
| `saveTasks` | `(filepath: string, tasks: TaskItem[]): Promise<void>` | Overwrites list file via `processFile` |
| `addTask` | `(filepath: string, title: string): Promise<TaskItem>` | Rewrites list; throws if mutator did not produce a task |
| `updateTask` | `(filepath: string, updatedTask: TaskItem): Promise<void>` | Rewrites list or no-op if not found |
| `deleteTask` | `(filepath: string, task: TaskItem): Promise<void>` | Rewrites list or no-op if not found |
| `moveTask` | `(task, sourceFilepath, targetFilepath): Promise<void>` | Two sequential file writes |
| `rolloverTasksInFile` | `(filepath: string): Promise<boolean>` | Rewrites if any task rolled |

## Recipes

1. **Add from main view** — `TaskMainView.addTask` → `dataService.addTask` → optimistic `incompleteTasks = [newTask, ...]`. Does **not** immediately `loadTasks` (race with async I/O).
2. **Toggle complete** — UI flips `completed` / `completedAt` then `dataService.updateTask` → file re-sorted incomplete-then-completed → `TASK_UPDATED`.
3. **Reorder by drag** — `TaskMainView.handleDndFinalize` concatenates incomplete+completed arrays → `dataService.saveTasks`.
4. **Cross-list drag** — sidebar `handleGlobalPointerUp` → `dataService.moveTask` → `TASK_MOVED`. Main view must **not** `saveTasks` for that drop (`movedToTarget` short-circuit).
5. **Delete** — `promptDeleteTaskWithLinkedNote` then `dataService.deleteTask` → `TASK_DELETED`.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
