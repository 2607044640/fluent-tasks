# Linked Notes

Optional hard-bound Markdown notes under `TodoData/<ListName>/` with YAML `taskId`. Bidirectional title sync. Not a Microsoft To Do attachment API.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `LinkedNoteService` (`src/services/LinkedNoteService.ts`) | Path sanitize, folder ensure, create/open note, title ↔ filename sync, rename echo suppression | Task list parse, recurrence |
| `ConfirmDeleteLinkedNoteModal` + `promptDeleteTaskWithLinkedNote` | Ask keep/trash note when deleting a task that resolves to a `TFile` | Sidebar tree |
| `TaskDetailView` header button | Create or open `task.note_link`; hover-link preview; context menu unlink | Implementing rename math (delegates to service) |
| `FluentTasksPlugin` vault `rename` | Call `syncNoteRenameToTasks` unless `isInternalRename` | Creating notes |

## Key Invariants

1. Dedicated notes live at `TodoData/<listBasename>/<sanitizedTitle>.md` with frontmatter `taskId: "<task.id>"`. (Why chosen over embedding long notes in `%%{}%%`: Obsidian editing/preview for the body.)
2. Plugin-driven renames call `markInternalRename` (default 2000ms) + `markInternalWrite` so vault `rename` does not bounce the title back. (Why chosen over a lock file: short TTL map.)
3. `isHardBoundNote(note_link)` is true when the cleaned path starts with `TodoData/`. Soft wikilinks elsewhere are still stored on `TaskItem.note_link` but delete-prompt / sync treat missing files as “no physical note”. (Why chosen over requiring every link to be hard-bound: users can paste `[[Note]]`.)

## Numbered Data Flow

1. Detail (or empty `note_link`) click → `createOrGetLinkedNote`: if existing file resolves, return it; else `ensureFolderExists`, `getAvailableNotePath` (suffix ` (1)`, ` (2)`, …), `vault.create` with optional `task.note` body, set `note_link` to `[[pathWithoutMd]]`, `immediateSave`, `openLinkedNoteFile`.
2. Task title save → `syncTaskTitleToNote`: if hard file basename (minus collision suffix) differs, `fileManager.renameFile` and return new wikilink.
3. User renames the note in Obsidian → plugin `rename` listener → `syncNoteRenameToTasks`: match `frontmatter.taskId` or `note_link` path (including short links only if the old file sat in that list’s notes folder) → set `task.title` (strip ` (n)`) and `note_link` → `updateTask` → `TASK_UPDATED`.
4. Delete task → `promptDeleteTaskWithLinkedNote`: no file → delete task immediately; else modal: cancel / task only / task+trash note.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `markInternalRename` / `isInternalRename` | `(oldPath, newPath, windowMs?): void` / `(old, new): boolean` | In-memory TTL map |
| `sanitizeNoteTitle` | `(title: string): string` | None (pure) |
| `getTaskNotesFolder` | `(categoryFilepath: string): string` | None (pure) |
| `ensureFolderExists` | `(app, folderPath): Promise<void>` | May `vault.createFolder` per segment |
| `resolveLinkedNoteFile` | `(app, noteLink?, sourcePath?): TFile \| null` | None (lookup) |
| `openLinkedNoteFile` | `(app, file): Promise<void>` | Focus existing markdown leaf or `getLeaf("tab").openFile` |
| `getAvailableNotePath` | `(app, folder, baseTitle, currentFilePath?): string` | None (lookup) |
| `createOrGetLinkedNote` | `(app, task, categoryFilepath)` | May create folder + `.md` |
| `syncTaskTitleToNote` | `(app, task, categoryFilepath, dataService?)` | May `renameFile` |
| `syncNoteRenameToTasks` | `(app, dataService, oldPath, newFile)` | May `updateTask` + EventBus |
| `promptDeleteTaskWithLinkedNote` | `(app, task, categoryFilepath, dataService, onDeleted?)` | Modal; optional `trashFile`; `deleteTask`; `TASK_DELETED` |

## Recipes

1. **Bind a note from detail** — header click `handleLinkNoteClick` → `createOrGetLinkedNote` → save `note_link` → open tab.
2. **Rename task and note together** — `TaskDetailView.scheduleSave` / `immediateSave` calls `syncTaskTitleToNote` before `updateTask`.
3. **Rename note in file explorer** — vault `rename` → `LinkedNoteService.syncNoteRenameToTasks`.
4. **Delete with prompt** — `TaskMainView` / `TaskDetailView` / Quick Task modal call `promptDeleteTaskWithLinkedNote`.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
