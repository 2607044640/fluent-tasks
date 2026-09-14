# Plugin Lifecycle

Obsidian plugin shell: registers three `ItemView` wrappers, commands, ribbon, vault listeners, and recurrence polling. Does not parse tasks or own Markdown writes.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `FluentTasksPlugin` (`src/main.ts`) | `onload` / `onunload`, view + command registration, settings load/save, sidebar expand/collapse, recurrence interval, category jump commands | Markdown parse/serialize, task CRUD, settings field widgets |
| `TaskSidebarViewWrapper` / `TaskMainViewWrapper` / `TaskDetailViewWrapper` | Mount/destroy Svelte views; main leaf state `{ categoryFilepath, categoryName }` | Vault writes, recurrence math |
| `EventBus` (`src/EventBus.ts`) | Sync pub/sub (`on` / `off` / `emit` / `destroy`) | Persistence |
| `Logger` (`src/Logger.ts`) | Append lines to `TodoData/debug.log` | Task domain logic |

## Key Invariants

1. Vault and workspace work wait for `app.workspace.onLayoutReady`. (Why chosen over running in `onload` before layout: comment in `main.ts` — silent boot crashes.)
2. Cross-view updates go through `EventBus` + `EventName`, not direct Svelte refs (except thin wrapper methods: `loadCategory`, `loadTask`, `triggerRenameHoveredOrActive`, `locateAndRevealCategory`). (Why chosen over a shared Svelte store: ItemViews mount independently in workspace leaves.)
3. `EventBus.destroy()` and ribbon removal run in `onunload`. (Why chosen over leaking listeners: plugin disable would keep handlers on a dead instance.)

## Numbered Data Flow

1. `FluentTasksPlugin.onload` constructs `DataService(app)`, adds `FluentTasksSettingTab`, `Logger.init(app)`, `loadSettings()`, then `registerView` for `VIEW_TYPE_SIDEBAR|MAIN|DETAIL`.
2. Commands and `refreshRibbonIcon()` register immediately; vault/folder work is deferred to `onLayoutReady`.
3. On layout ready: `dataService.ensureDataFolder()`, `applySettings()` (CSS `--todo-accent*`), vault `modify`/`create`/`delete`/`rename`, EventBus handlers for `DETAIL_CLOSE`, `CATEGORY_SELECTED`, `TASK_SELECTED`, `CATEGORY_LIST_CHANGED`.
4. `CATEGORY_SELECTED` activates/reveals the main leaf and `setViewState` (skipped when `fromHistory` to avoid history loops).
5. `TASK_SELECTED` either `openTaskDetailModal` or `activateView(VIEW_TYPE_DETAIL, "right")` then `TaskDetailView.loadTask`.
6. `checkRecurringTasksRollover(true)` runs once; then every 10s and on `window` `focus`. Non-force calls no-op when `lastRolloverDate === today`.
7. `onunload` removes ribbon, `EventBus.destroy()`, clears `window.__mstodo_drag_data`.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `FluentTasksPlugin.onload` | `(): Promise<void>` | Registers views/commands; starts layout-ready async work |
| `FluentTasksPlugin.onunload` | `(): void` | Drops ribbon, EventBus listeners, drag payload |
| `FluentTasksPlugin.saveSettings` | `(): Promise<void>` | `Plugin.saveData`; emits `EventName.SETTINGS_CHANGED` |
| `FluentTasksPlugin.applySettings` | `(): void` | Sets `document.body` CSS vars `--todo-accent*` |
| `FluentTasksPlugin.checkRecurringTasksRollover` | `(force?: boolean): Promise<void>` | May rewrite category files via `DataService.rolloverRecurringTasks`; emits `TASK_UPDATED` `{ isExternal: true }` |
| `FluentTasksPlugin.activateView` | `(viewType, position): Promise<WorkspaceLeaf \| null>` | Creates/reveals workspace leaves; no-op for detail when modal mode |
| `FluentTasksPlugin.activateAllViews` | `(): Promise<void>` | Opens left + center (+ right unless modal mode) |
| `FluentTasksPlugin.registerCategoryCommands` | `(): Promise<void>` | Adds/removes `z-jump-to-list-*` commands |
| `FluentTasksPlugin.openTaskDetailModal` | `(task?, categoryFilepath?): void` | Opens or reuses `TaskDetailModal` |
| `EventBus.emit` | `(event: string, payload?: unknown): void` | Synchronously invokes listeners |
| `Logger.log` | `(...args: unknown[]): Promise<void>` | Creates/appends `TodoData/debug.log` |

Event names (`src/types.ts` `EventName`): `category:selected`, `category:list-changed`, `task:selected`, `task:updated`, `task:moved`, `task:deleted`, `task:completed` (declared, unused), `detail:close`, `task:navigate`, `settings:changed`, `sidebar:trigger-rename`, `sidebar:reveal-category`.

## Recipes

1. **Open the three-pane UI** — Command `open-all-views` → `FluentTasksPlugin.activateAllViews` (`src/main.ts`). Ribbon `check-square` does the same unless `hideRibbonIcon`.
2. **Select a list** — `TaskSidebarView.selectCategory` emits `CATEGORY_SELECTED` → plugin handler → `leaf.setViewState({ type: VIEW_TYPE_MAIN, state })` → `TaskMainViewWrapper.setState` → `loadCategory`.
3. **Select a task** — `TaskMainView` emits `TASK_SELECTED` → plugin opens detail leaf or modal → `TaskDetailView.loadTask`.
4. **Jump to a list from Command Palette** — `registerCategoryCommands` registers `z-jump-to-list-<hash>`; callback collapses sidebars, activates main, emits `CATEGORY_SELECTED` with `focusInput: true`.
5. **External file change** — vault `modify` on a flat `TodoData/*.md` (and not `isInternalWrite`) emits `TASK_UPDATED` `{ categoryFilepath, isExternal: true }`. Nested notes under `TodoData/<List>/` are not category files.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
