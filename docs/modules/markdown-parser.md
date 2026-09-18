# Markdown Parser

Pure Markdown ↔ `TaskItem[]` codec. No vault access, no plugin state. Not a tokenizer: one regex per line plus a JSON metadata comment.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `MarkdownParser` (`src/MarkdownParser.ts`) | Parse checklist lines, serialize tasks, `findTaskIndex`, `createTask` | Vault I/O, EventBus, recurrence rollover, UI |
| Line regexes `TASK_START_REGEX` / `META_REGEX` | `/^- \[([ x])\](?:\s+(.*))?$/` start pattern plus `%%{...}%%` metadata | Nested task blocks, YAML frontmatter of list files |
| `generateStableId` (private) | Hash `title + createdAt` to base36 | UUID libraries |

## Key Invariants

1. Each task occupies **one** physical Markdown line. Multiline titles encode `\r?\n` as `<br>` during serialization and decode `<br\s*\/?>` back to `\n` upon parse. (Why chosen over raw `\n` lines: Markdown checklists require items on single physical lines; unencoded newlines split metadata onto continuation lines, causing silent data loss on subsequent parse.)
2. Parser self-heals broken legacy multiline files: `parseTasksFromMarkdown` groups lines via a Task Block state machine that accumulates continuation lines until the task's `%%{json}%%` metadata is closed, preventing dropped continuation text and restoring metadata before re-serializing to single-line `<br>` format.
3. Parse errors in the JSON comment are swallowed; the line still becomes a task with defaults. (Why chosen over failing the whole file: one corrupt comment must not wipe the list.)
4. Identity is `meta.id` if present, else `generateStableId(title, createdAt)`. Lookup is id → title+createdAt → title. (Why chosen over array index: reorder/DND would otherwise retarget the wrong row.)

## Numbered Data Flow

1. `parseTasksFromMarkdown(content)` splits on `\n` and accumulates lines into `RawTaskBlock` objects using `TASK_START_REGEX = /^- \[([ x])\](?:\s+(.*))?$/`.
2. Continuation lines without checklist prefixes are accumulated into the active task block until its `%%{...}%%` metadata is detected.
3. Checkbox `x` → `completed: true`. Title is extracted with `%%...%%` tail stripped, then `<br>` / `<br/>` tags are decoded to `\n`.
4. `JSON.parse` of `%%(\{.*?\})%%` fills `starred`, `steps`, `note`, `createdAt`, optional `completedAt`, `dueDate`, `msGraphId`, `msGraphListId`, `recurrence`, `why`, `svgs`, `note_link` (or legacy `noteLink`), `customMeta`.
5. `serializeTasksToMarkdown(tasks)` encodes all `\r?\n` in titles to `<br>` and writes one physical line per task: `- [x]? {title} %%{...}%%`. Empty optional fields are omitted. Serialize always writes `note_link` (never `noteLink`).
6. `createTask(title)` sets `completed/starred` false, empty `steps`/`note`, `createdAt` now, hashed `id`.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `parseTasksFromMarkdown` | `(content: string): TaskItem[]` | None (pure) |
| `serializeTasksToMarkdown` | `(tasks: TaskItem[]): string` | None (pure) |
| `findTaskIndex` | `(tasks: TaskItem[], target: TaskItem): number` | None (pure) |
| `createTask` | `(title: string): TaskItem` | None (pure; uses `Date` for `createdAt`) |

## Recipes

1. **Read a list file into objects** — `TaskService.getTasks` → `AtomicIOPipeline.readFile` → `MarkdownParser.parseTasksFromMarkdown`.
2. **Write objects back** — `MarkdownParser.serializeTasksToMarkdown` inside `AtomicIOPipeline.processFile` mutator (`TaskService.saveTasks` / `addTask` / `updateTask` / `deleteTask` / `moveTask`).
3. **Create a new row** — `MarkdownParser.createTask(title)` then `unshift` onto the in-memory array (`TaskService.insertTaskBeforeCompleted`).
4. **Locate a row after DND/edit** — `MarkdownParser.findTaskIndex(tasks, updatedTask)` before splice/replace.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
