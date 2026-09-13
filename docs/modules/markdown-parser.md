# Markdown Parser

Pure Markdown ↔ `TaskItem[]` codec. No vault access, no plugin state. Not a tokenizer: one regex per line plus a JSON metadata comment.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `MarkdownParser` (`src/MarkdownParser.ts`) | Parse checklist lines, serialize tasks, `findTaskIndex`, `createTask` | Vault I/O, EventBus, recurrence rollover, UI |
| Line regexes `TASK_LINE_REGEX` / `META_REGEX` | `- [ ]` / `- [x]` title plus optional `%%{...}%%` | Nested task blocks, YAML frontmatter of list files |
| `generateStableId` (private) | Hash `title + createdAt` to base36 | UUID libraries |

## Key Invariants

1. Each task is **one** Markdown list line. Extra fields live in an Obsidian comment `%%{json}%%`, not child bullets. (Why chosen over nested Markdown or frontmatter: the file stays a valid checklist if the plugin is disabled.)
2. Parse errors in the JSON comment are swallowed; the line still becomes a task with defaults. (Why chosen over failing the whole file: one corrupt comment must not wipe the list.)
3. Identity is `meta.id` if present, else `generateStableId(title, createdAt)`. Lookup is id → title+createdAt → title. (Why chosen over array index: reorder/DND would otherwise retarget the wrong row.)

## Numbered Data Flow

1. `parseTasksFromMarkdown(content)` splits on `\n`.
2. Each trimmed line must match `^- \[([ x])\] (.+?)(?:\s*%%\{.*?\}%%)?$`. Non-matching lines (headings, blanks, notes) are skipped.
3. Checkbox `x` → `completed: true`. Title is `match[2]` with the `%%...%%` tail stripped.
4. `JSON.parse` of the comment fills `starred`, `steps`, `note`, `createdAt`, optional `completedAt`, `dueDate`, `msGraphId`, `msGraphListId`, `recurrence`, `why`, `svgs`, `note_link` (or legacy `noteLink`), `customMeta`.
5. `serializeTasksToMarkdown(tasks)` writes one line per task: `- [x]? {title} %%{...}%%`. Empty optional fields are omitted.
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
