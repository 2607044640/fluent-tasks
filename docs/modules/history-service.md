# History Service (Undo / Redo)

Action history engine for Fluent Tasks. Tracks mutating task actions across lists and details, executing atomic undo (`Ctrl+Z`) and redo (`Ctrl+Y`) with top-right notification feedback and active focus isolation.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `HistoryService` (`src/services/HistoryService.ts`) | In-memory `undoStack` & `redoStack` (max 60 items), action recording, diff detection, atomic undo/redo dispatch, rapid change merging (2.5s) | Direct DOM rendering, Markdown parsing |
| `HistoryToastContainer.svelte` (`src/components/HistoryToastContainer.svelte`) | Top-right floating feedback toast, action-specific English description, auto-dismiss (2.8s) | Action dispatch, state storage |
| Plugin Focus Guards (`src/main.ts`) | `isFluentTasksFocused()`, `isUserActivelyTyping()` | History stack math |

## Key Invariants

1. Focus isolation is absolute: `isFluentTasksFocused()` returns `false` if the active element is inside an Obsidian markdown note (`.cm-editor`), settings modal, or other leaf. (Why chosen over universal key interception: `Ctrl+Z` in user notes must never revert plugin task states.)
2. Native typing preservation: `isUserActivelyTyping()` yields `Ctrl+Z` to the browser when the user has non-empty active text in an input or textarea. (Why chosen over instant task undo: allows fine-grained in-field character undo before committing.)
3. Rapid continuous mutations on the same task and field within 2.5 seconds (e.g. mouse wheel priority score adjustments, consecutive title typing) merge into a single undo step. (Why chosen over granular delta recording: prevents dozens of single-step clicks to revert a single scrolling gesture.)

## Numbered Data Flow

1. Data mutation occurs via `DataService` (`addTask`, `updateTask`, `deleteTask`, `moveTask`).
2. `DataService` detects field changes against previous task state and invokes `historySvc.recordTaskUpdate/Created/Deleted/Moved`.
3. User presses `Ctrl+Z` or `Ctrl+Y` while focused on Fluent Tasks (or executes command palette `undo-action` / `redo-action`).
4. `main.ts` validates `isFluentTasksFocused()` and `!isUserActivelyTyping()`, then invokes `historyService.undo()` or `redo()`.
5. `HistoryService` pops the action, sets `isUndoingOrRedoing = true` to avoid re-recording, applies the reverse mutation via `dataService`, emits `TASK_UPDATED` (or `TASK_DELETED`/`TASK_MOVED`) with `isExternal: true`, and shows a descriptive toast via `HistoryToastContainer.showToast`.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `recordTaskUpdate` | `(categoryFilepath, beforeTask, afterTask): void` | Pushes/merges to `undoStack`; clears `redoStack` |
| `recordTaskCreated` | `(categoryFilepath, task): void` | Pushes to `undoStack`; clears `redoStack` |
| `recordTaskDeleted` | `(categoryFilepath, task, index?, trashedImages?): void` | Pushes to `undoStack`; clears `redoStack` |
| `recordTaskMoved` | `(sourceFilepath, targetFilepath, task): void` | Pushes to `undoStack`; clears `redoStack` |
| `undo` | `(): Promise<boolean>` | Reverts action via `DataService`; pops to `redoStack`; shows toast |
| `redo` | `(): Promise<boolean>` | Reapplies action via `DataService`; pushes to `undoStack`; shows toast |
| `destroy` | `(): void` | Clears stacks and references |

## Recipes

1. **Undo task priority score change** — Scroll wheel on weight score or press 1-9 → `DataService.updateTask` records action. Pressing `Ctrl+Z` in list reverts score and toasts `Reverted weight: X → Y on "<Title>"`.
2. **Undo why rationale edit** — Save or delete why in `TaskDetailView` → `DataService.updateTask` captures field `why`. `Ctrl+Z` restores rationale.
3. **Undo task deletion** — Delete task → `DataService.deleteTask` stores task snapshot, list index, and any trashed images. `Ctrl+Z` recreates task at original position and restores images.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
