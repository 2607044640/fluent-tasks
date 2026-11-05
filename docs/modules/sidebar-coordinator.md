# Sidebar Coordinator

Manages workspace left sidebar synchronization, auto-expansion on task/list drag-hover, smooth auto-collapse on external tab switch, and distractions-free floating UI coexistence.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `SidebarCoordinator` (`src/services/SidebarCoordinator.ts`) | Left split expand/collapse, drag-hover temporary expansion (`isSidebarTemporarilyExpandedForDrag`), tab-switch focus auto-collapse, manual close suppression | Task CRUD, Markdown parsing, tree rendering |
| `ISidebarPluginHost` | Decoupled host contract (`app`, `settings`, `activateView`, `getActiveCenterCategory`) | Direct DOM access |
| `TaskSidebarView.svelte` | Sidebar list tree UI, drag event initiation | Workspace split collapse logic |

## Key Invariants

1. Coexistence with core tools: `SidebarCoordinator` only collapses the left split if the active view in that split was `VIEW_TYPE_SIDEBAR`. (Why chosen over universal `leftSplit.collapse()`: never collapses or hijacks native Obsidian sidebars like File Explorer, Search, or Bookmarks.)
2. Temporary drag-expand safety: When expanding the sidebar on drag hover, a global safety timeout and pointerup/cancel/drop listeners auto-revert the expansion if a drag is cancelled or released. (Why chosen over event-only cleanup: prevents sticky expanded states if drag was interrupted.)
3. Manual user collapse suppression: If the user explicitly collapses the sidebar via `Ctrl+B` or ribbon, auto-expansion is suppressed for 2 seconds to avoid bouncing open. (Why chosen over immediate re-trigger: preserves deliberate user window management.)
4. Edge-only drag expansion (`dragToEdgeToExpandSidebar`): When enabled, dragging a task does NOT expand the left sidebar immediately on drag start. It listens for `pointermove` / `dragover` events and only calls `expandSidebarForDrag` when `isNearLeftEdge(clientX)` returns true, dynamically factoring in Obsidian's left ribbon width (~40px) and gutter boundaries. Ordinary in-list reordering (which stays in `x >= 80px`) never triggers sidebar expansion.

## Numbered Data Flow

1. Plugin startup: `FluentTasksPlugin.onload` instantiates `SidebarCoordinator(this)` and registers listeners via `registerEventListeners(this)`.
2. External tab switch (`active-leaf-change`): When switching away from Fluent Tasks to a Markdown note, if `autoCollapseSidebarOnSwitch` is true, the sidebar cleanly collapses. When switching back, if `autoExpandSidebar` is true, it reveals the current list.
3. Task drag initiation: `TaskMainView` calls `plugin.handleTaskDragStart(relevantCatPath)` on initial drag consider.
4. Edge detection: If `dragToEdgeToExpandSidebar` is active, `SidebarCoordinator` delays expansion until pointer `clientX` hits the left boundary threshold calculated by `isNearLeftEdge`.
5. Temporary expansion: Once threshold is met (or immediately if edge drag is disabled), `expandSidebarForDrag` expands `workspace.leftSplit` and locates the active list in the tree.
6. Drop or cancel: `handleTaskDragEnd()` closes the temporary split after a 150ms debounce and cleans up safety listeners.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `registerEventListeners` | `(plugin: Plugin): void` | Registers `active-leaf-change` and keyboard listeners |
| `handleTaskDragStart` | `(targetCategoryPath?: string): Promise<void>` | Sets up drag session; triggers immediate or edge-delayed expansion |
| `handleTaskDragEnd` | `(): void` | Debounces collapse of temporary split (150ms) |
| `expandSidebarForDrag` | `(targetCategoryPath?: string): Promise<void>` | Expands left split; sets `_isSidebarTemporarilyExpandedForDrag`; locates category |
| `isNearLeftEdge` | `(clientX: number): boolean` | Pure boundary calculation against ribbon and left split coordinates |
| `expandSidebarToList` | `(): void` | Expands left sidebar and reveals active list |
| `collapseSidebars` | `(suppressDuration, force, targetLeft, targetRight): void` | Collapses left/right split if plugin view is active |

## Recipes

1. **Edge-only drag expansion** — Enable `dragToEdgeToExpandSidebar` in settings. During task drag in `TaskMainView`, sidebar remains closed while sorting within the list; dragging across the far left margin triggers `isNearLeftEdge` and expands the sidebar for cross-list drops.
2. **Locate list on expand** — `expandSidebarForDrag` queries active leaves and invokes `sidebarView.getComponent().locateAndRevealCategory(catPath)`.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
