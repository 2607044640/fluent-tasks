# Svelte UI Views

Obsidian `ItemView` wrappers in `src/main.ts` mount Svelte 4 components. Cross-pane task drag uses `window.__mstodo_drag_data` (legacy name, not a To Do API). List/group drag uses HTML5 DnD in the sidebar and Quick modals.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `TaskSidebarView.svelte` | Tree of lists/groups, F2 rename, create list/group, drop radar for tasks, HTML5 reorder | Markdown parse |
| `TaskMainView.svelte` | Task list, add/toggle/star, svelte-dnd-action reorder, popovers, SVG lightbox, hints modal | Settings tab DOM |
| `TaskDetailView.svelte` | Title/steps/note, schedule + recurrence UI, metadata modal, linked-note button, debounced save | Category tree |
| `TaskSearchModal` | SuggestModal search (see [query-search](./query-search.md)) | — |
| `QuickListModal` + `QuickListModalView.svelte` | Keyboard list board; `filterSidebarTree`; open list in center | Task body editor |
| `QuickTaskModal` + `QuickTaskModalView.svelte` | In-modal list+task management or navigate (`quickModalAction`) | Recurrence picker |
| `TaskDetailModal` | Hosts `TaskDetailView` with `isModal: true` | Own save path |
| `TaskStepsModal` + `TaskStepsModalView.svelte` | Large-type step editor; `flushSaveSync` on close | Creating notes |
| Utils `dndUtils` / `domUtils` / `popoverUtils` / `sidebarTreeUtils` / `hotkeyUtils` / `timeUtils` | Ghost kill, portal, autosize, popover coords, tree move/filter, hotkey tips, labels | Vault writes |

## Key Invariants

1. Wrappers destroy Svelte with `$destroy()` in `onClose`. (Why chosen over leaving the component: ItemView recycle would duplicate EventBus handlers.)
2. Optimistic UI updates local arrays first, then `DataService`; main-view `addTask` does not `loadTasks()` immediately. Cross-pane finalize **must not** `saveTasks` if `movedToTarget` is set. (Why chosen over reload-after-every-write: `vault.process` races with stale reads.)
3. `TaskMainViewWrapper.navigation = true` and `getState`/`setState` persist `categoryFilepath` for Obsidian history. History restores emit `CATEGORY_SELECTED` with `fromHistory: true` so the plugin does not `setViewState` again. (Why chosen over only EventBus: back/forward would desync the leaf header.)

## Numbered Data Flow

1. Plugin `registerView` → wrapper `onOpen` mounts Svelte with `{ app?, dataService, plugin }`.
2. Sidebar `selectCategory` → `CATEGORY_SELECTED` → plugin sets main leaf state → `loadCategory` → `getTasks` → split incomplete/completed.
3. Row click `selectTask` → `TASK_SELECTED` → detail leaf or `TaskDetailModal` → `loadTask` (deep-copies `steps`).
4. Edits: main toggle/star/DND call `updateTask`/`saveTasks`; detail uses `scheduleSave` (`SAVE_DEBOUNCE_MS` 600) or `immediateSave`; steps modal uses 400ms debounce and `flushSaveSync` on close.
5. In-list DND: `handleDndConsider` writes `__mstodo_drag_data`; sidebar `pointermove` highlights `.category-item`; `pointerup` `moveTask` + `TASK_MOVED`.
6. Quick List Enter → `openCategoryInCenterOnly` (collapse sidebars, reveal main, emit select, close). Quick Task `handlePrimaryAction` either toggles in-modal (`direct`) or navigates (`navigate`).

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `TaskMainView.loadCategory` | `(cat: CategoryInfo): Promise<void>` | Reads list file via `getTasks` |
| `TaskMainView.getCurrentCategory` | `(): CategoryInfo \| null` | None |
| `TaskMainView.addTask` / `toggleComplete` / `toggleStar` | — | Vault write + EventBus |
| `TaskMainView.handleDndFinalize` | `(e, 'incomplete' \| 'completed')` | May `saveTasks` or skip if cross-pane |
| `TaskSidebarView.triggerRenameHoveredOrActive` | `(): boolean` | Starts inline rename |
| `TaskSidebarView.locateAndRevealCategory` | `(filepath: string): Promise<boolean>` | May expand group + `saveSidebarState`; DOM scroll |
| `TaskSidebarView.handleGlobalPointerUp` | `(e: PointerEvent)` | `moveTask` + `TASK_MOVED` |
| `TaskDetailView.loadTask` | `(t: TaskItem, filepath: string): void` | Local state only |
| `TaskDetailView.immediateSave` / `scheduleSave` | — | Optional note rename + `updateTask` + EventBus |
| `TaskDetailView.handleLinkNoteClick` | — | Create/open note + save `note_link` |
| `TaskStepsModalView.flushSaveSync` | `(): void` | `updateTask` if debounce pending |
| `QuickListModalView.openCategoryInCenterOnly` | `(cat): Promise<void>` | Collapse sidebars; EventBus; close modal |
| `killDndGhostElement` / `injectDndGhostShield` / `removeDndGhostShield` | `(): void` | DOM/CSS only |
| `portal` / `autosize` | Svelte actions | Move node to `document.body` / resize textarea |

## Recipes

1. **Add a task** — Main input Enter → `TaskMainView.addTask` → `DataService.addTask`.
2. **Open details** — Click row → `TASK_SELECTED` → leaf or `FluentTasksPlugin.openTaskDetailModal`.
3. **Move task to another list** — Drag onto sidebar row (`__mstodo_drag_data`) or context menu `handleContextMenu` → `moveTask`.
4. **Reorder lists** — Sidebar HTML5 DnD `handleDrop` / `handleRootDrop` → `saveSidebarState`. Shared helper in Quick modals: `moveSidebarItem` (`sidebarTreeUtils.ts`).
5. **Edit steps in the large modal** — Click steps badge → `TaskStepsModal`; close calls `flushSaveSync`.
6. **Quick List board** — Command `open-quick-list-modal`; grid vs list is `plugin.settings.quickListGridLayout`.
7. **Ctrl-hover title peek** — `isQuickPeekModifierPressed` (Ctrl, not Win/Super) → `showPopover(..., 'title')`; dismiss on right-click (`dismissPopover`) or peeking another title.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
