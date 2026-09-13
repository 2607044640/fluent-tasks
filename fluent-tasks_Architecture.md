# fluent-tasks Architecture

Fluent Tasks (`manifest.json` id `fluent-tasks`, v1.0.23) is an Obsidian plugin. Tasks are Markdown checklists under `TodoData/*.md`. Cross-view traffic uses the `EventBus` singleton. Vault I/O uses `DataService`. There is **no** Microsoft Graph / To Do sync client; `TaskItem.msGraphId` / `msGraphListId` are optional serialized fields only. Cross-pane drag uses `window.__mstodo_drag_data` (legacy name).

## Global Invariants

1. Flat `TodoData/*.md` files are the only task store. Sidebar grouping lives in `TodoData/.metadata.json` via `vault.adapter` (Obsidian Vault API ignores dotfiles). (Why chosen over a JSON/DB store: lists remain editable as ordinary checklists.)
2. Views never call `vault.modify` themselves. Mutations go `UI → DataService → AtomicIOPipeline.processFile` (or adapter for metadata), then `EventBus` notifies peers. Internal-write windows suppress echo reloads. (Why chosen over per-view writes: concurrent edit + vault `modify` events would duplicate or drop tasks.)
3. Recurrence uses local calendar dates (`YYYY-MM-DD` via `timeUtils`). Rollover runs inside `TaskService.getTasks`, on a 10s interval, and on window focus. (Why chosen over UTC `Date` math: due dates must not shift by timezone.)

## Progressive Router

| Subsystem | Live entry | Doc |
|---|---|---|
| Plugin lifecycle | `src/main.ts` `FluentTasksPlugin` | [plugin-lifecycle](./docs/modules/plugin-lifecycle.md) |
| Markdown parser | `src/MarkdownParser.ts` | [markdown-parser](./docs/modules/markdown-parser.md) |
| Data facade + atomic I/O | `src/DataService.ts`, `src/services/AtomicIOPipeline.ts` | [data-service](./docs/modules/data-service.md) |
| Task CRUD | `src/services/TaskService.ts` | [task-service](./docs/modules/task-service.md) |
| Lists & groups | `src/services/CategoryService.ts` | [category-service](./docs/modules/category-service.md) |
| Recurrence | `src/services/RecurrenceService.ts` | [recurrence-engine](./docs/modules/recurrence-engine.md) |
| Linked notes | `src/services/LinkedNoteService.ts` | [linked-notes](./docs/modules/linked-notes.md) |
| Search & filter | `DataService.searchTasks`, `src/TaskSearchModal.ts` | [query-search](./docs/modules/query-search.md) |
| Svelte UI | `src/Task*View.svelte`, `src/modals/` | [svelte-ui](./docs/modules/svelte-ui.md) |
| Settings | `src/settings.ts` | [settings](./docs/modules/settings.md) |

## Runtime Surface

View types (`src/types.ts`): `fluent-tasks-sidebar` (left), `fluent-tasks-main` (center), `fluent-tasks-detail` (right leaf, or `TaskDetailModal` when `openDetailInModal`).

Static commands: `open-all-views`, `open-sidebar`, `open-main-view`, `open-detail-view`, `search-all-tasks`, `search-current-list`, `rename-hovered-list-or-group`, `open-quick-list-modal`, `open-quick-task-modal`. Dynamic: `z-jump-to-list-*` from `registerCategoryCommands`.

Models in `src/types.ts`: `TaskItem`, `TaskStep`, `RecurrenceRule` (`daily` | `weekdays` | `weekly` | `custom`), `CategoryInfo`, `GroupInfo`, `SidebarItem`. Timing: `src/constants.ts`.

On disk: `TodoData/<List>.md` (tasks), `TodoData/.metadata.json` (tree), `TodoData/<List>/<title>.md` (optional bound notes), `TodoData/debug.log` (`Logger`). Plugin options: Obsidian `saveData` (`FluentTasksSettings`).

`onload` (sync): `new DataService(app)`, setting tab, `Logger.init`, `loadSettings`, `registerView` ×3, ribbon, commands. `onLayoutReady`: `ensureDataFolder`, vault `modify`/`create`/`delete`/`rename`, EventBus wiring, `registerCategoryCommands`, `checkRecurringTasksRollover(true)` then 10s interval + `focus`. `onunload`: ribbon off, `EventBus.destroy()`, clear `__mstodo_drag_data`.

## EventBus (`src/EventBus.ts` + `EventName`)

| Event | Typical producer → consumer |
|---|---|
| `category:selected` | Sidebar / search / jump → plugin + main `loadCategory` |
| `category:list-changed` | CategoryService → plugin `registerCategoryCommands` |
| `task:selected` | Main / search → detail leaf or modal |
| `task:updated` | CRUD + rollover + external `modify` → main/detail reload |
| `task:moved` | Sidebar drop / context move → main optimistic lists |
| `task:deleted` | Delete prompt → main/detail close |
| `task:navigate` | Search hit → main scroll/highlight |
| `detail:close` | Detail UI → detach leaf or close modal |
| `settings:changed` | `saveSettings` → main wrap-titles |
| `sidebar:trigger-rename` / `sidebar:reveal-category` | Plugin → sidebar F2 / locate |

`task:completed` is declared on `EventName` and is unused. Handlers run synchronously; `EventBus.destroy()` clears the map.

Build: `npm run dev` / `npm run build` → `esbuild.config.mjs` bundles `src/main.ts` to `main.js`. User onboarding: [fluent-tasks_README.md](./fluent-tasks_README.md).
