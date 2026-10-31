# Svelte UI Views

Obsidian `ItemView` wrappers in `src/main.ts` mount Svelte 4 components. Cross-pane task drag uses `window.__mstodo_drag_data` (legacy name, not a To Do API). List/group drag uses HTML5 DnD in the sidebar and Quick modals.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `TaskSidebarView.svelte` | Tree of lists/groups, F2 rename, create list/group, drop radar for tasks, HTML5 reorder | Markdown parse |
| `TaskMainView.svelte` | Task list, add/toggle/star, svelte-dnd-action reorder, popovers, SVG lightbox, multi-select batch toolbar, bottom-right 5s undo toast, hints modal | Settings tab DOM |
| `TaskDetailView.svelte` | Title/steps/note, schedule + recurrence UI, metadata modal, linked-note button, debounced save | Category tree |
| `TaskSearchModal` | SuggestModal search (see [query-search](./query-search.md)) | — |
| `QuickListModal` + `QuickListModalView.svelte` | Keyboard list board; `filterSidebarTree`; grid spacing via `quickListMinColGap` / `quickListMinRowGap`; open list in center | Task body editor |
| `QuickTaskModal` + `QuickTaskModalView.svelte` | In-modal list+task management or navigate (`quickModalAction`) | Recurrence picker |
| `TaskDetailModal` | Hosts `TaskDetailView` with `isModal: true` | Own save path |
| `TaskStepsModal` + `TaskStepsModalView.svelte` | Large-type step editor with compact image thumbnails placed above step descriptions, draft input image previews above add-step card, `Ctrl+V` clipboard paste; `flushSaveSync` on close | Creating notes |
| `TaskImageThumbnail.svelte` | Compact thumbnail card (38px/44px) placed top-aligned above step/note text; hover + Ctrl+C copy, hover + Ctrl+X cut, click to open preview | Binary file I/O |
| `ImagePreviewModal` + `ImagePreviewModalView.svelte` | Full-screen image preview lightbox with zoom/pan and toolbar | Note parsing |
| `HistoryToastContainer.svelte` | Top-right acrylic floating toast for `Ctrl+Z` / `Ctrl+Y` action feedback | Stack management |
| `UndoToastContainer.svelte` | Bottom-right 2.5s floating undo bar for deleted task/step/list restoration | History stack storage |
| Utils `dndUtils` / `domUtils` / `popoverUtils` / `sidebarTreeUtils` / `hotkeyUtils` / `timeUtils` / `imageAttachmentUtils` | Ghost kill, portal, autosize, popover coords, tree move/filter, hotkey tips, labels, image attachment saving/clipboard | Vault writes |

## Key Invariants

1. Wrappers destroy Svelte with `$destroy()` in `onClose`. (Why chosen over leaving the component: ItemView recycle would duplicate EventBus handlers.)
2. Optimistic UI updates local arrays first, then `DataService`; main-view `addTask` does not `loadTasks()` immediately. Cross-pane finalize **must not** `saveTasks` if `movedToTarget` is set. (Why chosen over reload-after-every-write: `vault.process` races with stale reads.)
3. `TaskMainViewWrapper.navigation = true` and `getState`/`setState` persist `categoryFilepath` for Obsidian history. History restores emit `CATEGORY_SELECTED` with `fromHistory: true` so the plugin does not `setViewState` again. (Why chosen over only EventBus: back/forward would desync the leaf header.)
4. SVG lightbox modal captures window keydown and wheel events with `{ capture: true }`; Ctrl+Scroll forwards to `quickEditor.scaleHoveredBox`; exit prompts save confirmation only when `isDirty` is true.
5. In Quick View (`QuickListModalView.svelte`), normal lists are freely draggable across groups and root (`moveSidebarItem`), recalculating layout columns and updating `.metadata.json`. Dragging groups in Quick View is strictly forbidden (`is-dragging-group`, `cursor: not-allowed`, top-right `showDragForbiddenNotice`), because group repositioning interferes with grid column recalculation.
6. Star mode (`STARRED_CATEGORY_PATH = "__starred__"`) provides a virtual aggregated view of all starred tasks across all lists; task updates route to their underlying `sourceFilepath`; settings changes propagate immediately to active leaves via `applySettingsUpdate`.
7. Inline renaming (F2 / `rename-hovered-list-or-group`) works consecutively across lists and groups in both `TaskSidebarView` and `TaskMainView` via container capture-phase keydown listeners and hover/focus tracking.
8. Context menu ordering: task right-click menu places `Add side step` (opening `TaskStepsModal`) as item 1, followed by `Star task` / `Remove star` as item 2.
9. Image attachments: images pasted via `Ctrl+V` or dragged into `TaskStepsModal` or `TaskDetailView` are stored directly in the vault attachment directory (or `TodoData/attachments/`). Thumbnails are positioned strictly above the step/note text for a clean, Antigravity-style top-aligned preview. Hover shortcuts (`Ctrl+X` / `Ctrl+C`) respect active text selections in input fields. Clicking thumbnails opens `ImagePreviewModal`.
10. Header list title mode: When `showListTitleInHeader` is active, the active list name renders directly into `.view-header-title` with accent color, click-to-rename tooltip, and reduced canvas margins.
11. Compact quick-add box: The add-task input stays squished (28px height, 12px font) while empty and unfocused, smoothly animating to full size on interaction.
12. Priority weight scoring: 1–9 stepper next to task star allows direct digit presses or wheel rolling to adjust task score with stable sorting.
13. Focus isolation in `TaskDetailView`: `handleDetailHeaderClick` specifically excludes `.steps-container`, `.step-item`, `.add-step-card`, and non-title inputs (`INPUT`, non-title `TEXTAREA`). In addition, `.steps-container` has `on:click|stopPropagation` so clicking step items, the add-step card, or step textareas never hijacks the caret to the task title.
14. External clipboard & window blur guard in `TaskMainView`: `handleAddTaskBlur` checks `document.hasFocus()` and ignores window-level blur (e.g. summoning Ditto, `Win+V`, or switching windows). `handleWindowBlur` does not auto-submit unfinished drafts. `handleAddTaskKeydown` ignores `Enter` keystrokes arriving within 350ms of window focus or paste (and while `isPastingImage` is saving), preventing selection-confirm Enter keys from external clipboards from triggering premature duplicate task creation.
15. Drafting image attachments in main input: `newTaskImages` allows pasting/dropping image attachments directly into the main add-task row before title submission.
16. Creation highlight & scroll: New tasks set `justCreatedTaskId` for 1000ms, triggering a 0.2s theme accent glow border animation and smooth scrolling into view.

## Numbered Data Flow

1. Plugin `registerView` → wrapper `onOpen` mounts Svelte with `{ app?, dataService, plugin }`.
2. Sidebar `selectCategory` → `CATEGORY_SELECTED` → plugin sets main leaf state → `loadCategory` → `getTasks` → split incomplete/completed.
3. Row click emits `TASK_SELECTED` → detail leaf or `TaskDetailModal` → `loadTask` (deep-copies `steps`).
4. Edits: main toggle/star/DND call `updateTask`/`saveTasks`; detail uses `scheduleSave` (`SAVE_DEBOUNCE_MS` 600) or `immediateSave`; steps modal uses 400ms debounce and `flushSaveSync` on close.
5. In-list DND: `handleDndConsider` writes `__mstodo_drag_data`; sidebar `pointermove` highlights `.category-item`; `handleGlobalPointerUp` `moveTask` + `TASK_MOVED`.
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
| `QuickListModalView.toggleLayoutMode` | `(): Promise<void>` | Writes `quickListGridLayout`; `saveSettings` |
| `killDndGhostElement` / `injectDndGhostShield` / `removeDndGhostShield` | `(): void` | DOM/CSS only |
| `portal` / `autosize` | Svelte actions | Move node to `document.body` / resize textarea |

## Recipes

1. **Add a task** — Main input Enter → `TaskMainView.addTask` → `DataService.addTask`.
2. **Open details** — Click row → `TASK_SELECTED` → leaf or `FluentTasksPlugin.openTaskDetailModal`.
3. **Move task to another list** — Drag onto sidebar row (`__mstodo_drag_data`) or context menu → `moveTask`.
4. **Reorder lists** — Sidebar HTML5 DnD → `saveSidebarState`. Shared helper in Quick modals: `moveSidebarItem` (`sidebarTreeUtils.ts`).
5. **Edit steps in the large modal** — Click steps badge → `TaskStepsModal`; close calls `flushSaveSync`.
6. **Quick List board** — Command `open-quick-list-modal`; grid vs list is `plugin.settings.quickListGridLayout`; column/row gaps are `quickListMinColGap` / `quickListMinRowGap`.
7. **Ctrl-hover title peek** — `isQuickPeekModifierPressed` (Ctrl on Windows/Linux, not Win/Super; Meta or Ctrl on macOS) → `showPopover(..., 'title')`.
8. **Drag lists in Quick View** — Normal lists drag to reorder/move across groups; group dragging is blocked with notice.
9. **Move-to submenu** — Context menu hierarchical move-to with search modal fallback.
10. **Image attachments & shortcuts** — `Ctrl+V` pastes images into steps or notes; drag-and-drop file onto modal/detail adds image; hover thumbnail + `Ctrl+C` to copy to clipboard, hover + `Ctrl+X` to cut, click to open full-screen lightbox.
11. **Add side step from context menu** — Right-click any task → `Add side step` (item 1) opens `TaskStepsModal`; `Star task` is item 2.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
