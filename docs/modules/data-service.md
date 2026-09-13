# Data Service and Atomic I/O

`DataService` is a facade over `AtomicIOPipeline`, `CategoryService`, and `TaskService`. All UI modules take a `DataService` instance. File mutations for task lists go through `vault.process` with an internal-write window so vault `modify` handlers ignore the plugin’s own writes.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `DataService` (`src/DataService.ts`) | Delegate category/task APIs; flatten categories; `searchTasks`; `rolloverRecurringTasks` | Regex parsing, recurrence date math, Svelte |
| `AtomicIOPipeline` (`src/services/AtomicIOPipeline.ts`) | `ensureDataFolder`, `readFile`, `processFile`, internal-write map | Task/category domain rules |
| Internal-write map | `markInternalWrite(path, windowMs=800)` / `isInternalWrite` | Persistence of the map (in-memory only) |

## Key Invariants

1. Task-list writes use `app.vault.process(file, mutator)`, not read-modify-write in the caller. (Why chosen over `vault.modify` after a stale read: Obsidian serializes `process` against concurrent writers.)
2. `markInternalWrite` expires after `windowMs` (default 800ms). Vault `modify` in `main.ts` skips those paths. (Why chosen over a generation counter: simple echo suppression for optimistic UI.)
3. `readFile` uses `vault.adapter.read`, not `vault.read`. (Why chosen over Vault API cache: matches the pipeline’s need for latest disk bytes.)

## Numbered Data Flow

1. `FluentTasksPlugin.onload` does `new DataService(this.app)` → `new AtomicIOPipeline(app)` + `CategoryService` + `TaskService`.
2. `ensureDataFolder()` creates `TodoData` if missing.
3. Category calls (`getSidebarItems`, `createCategory`, …) go to `CategoryService` (metadata via adapter; `.md` via Vault).
4. Task calls (`getTasks`, `saveTasks`, `addTask`, `updateTask`, `deleteTask`, `moveTask`) go to `TaskService.processFile` mutators.
5. `searchTasks(query, scopeFilepath?)` lowercases the query, iterates `getCategories()` (optionally one list), `getTasks` each, matches title then steps then note (`includes`).
6. `rolloverRecurringTasks()` loops categories and `TaskService.rolloverTasksInFile`.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `ensureDataFolder` | `(): Promise<void>` | May `vault.createFolder("TodoData")` |
| `isInternalWrite` | `(filepath: string): boolean` | May delete expired map entries |
| `markInternalWrite` | `(filepath: string, windowMs?: number): void` | Mutates in-memory expiry map |
| `getSidebarItems` / `saveSidebarState` | see CategoryService | Metadata file I/O |
| `createGroup` / `renameGroup` / `deleteGroup` | see CategoryService | Metadata I/O + EventBus |
| `getCategories` | `(): Promise<CategoryInfo[]>` | Reads sidebar tree (flatten groups) |
| `createCategory` / `deleteCategory` / `renameCategory` | see CategoryService | Vault file + metadata |
| `getTasks` / `saveTasks` / `addTask` / `updateTask` / `deleteTask` / `moveTask` | see TaskService | List `.md` rewrite |
| `searchTasks` | `(query: string, scopeFilepath?: string \| null)` | Read-only (but `getTasks` may auto-heal/rollover) |
| `rolloverRecurringTasks` | `(): Promise<boolean>` | May rewrite every list file |
| `AtomicIOPipeline.processFile` | `(filepath, mutator: (data: string) => string): Promise<void>` | `markInternalWrite` + `vault.process` |
| `AtomicIOPipeline.readFile` | `(filepath: string): Promise<string>` | Adapter read; `""` if missing |

## Recipes

1. **UI mutation** — any view calls `dataService.addTask|updateTask|deleteTask|moveTask` then `EventBus.emit`.
2. **Suppress self-reload** — `processFile` calls `markInternalWrite` immediately before `vault.process`; `main.ts` vault `modify` returns early when `isInternalWrite`.
3. **Startup folder** — `onLayoutReady` → `dataService.ensureDataFolder()`.
4. **Search from command** — `new TaskSearchModal(app, plugin, dataService, scopePath?).open()` → `dataService.searchTasks`.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
