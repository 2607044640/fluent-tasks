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
2. Temporary drag-expand safety: When expanding the sidebar on drag hover, a global safety timeout (20s) and pointer listener auto-revert the expansion if a drop event was dropped or cancelled outside the window. (Why chosen over event-only cleanup: prevents sticky expanded states if drag was interrupted.)
3. Manual user collapse suppression: If the user explicitly collapses the sidebar via `Ctrl+B` or ribbon, auto-expansion is suppressed for 2 seconds to avoid bouncing open. (Why chosen over immediate re-trigger: preserves deliberate user window management.)

## Numbered Data Flow

1. Plugin startup: `FluentTasksPlugin.onload` instantiates `SidebarCoordinator(this)` and registers listeners via `registerEventListeners(this)`.
2. External tab switch (`active-leaf-change`): When switching away from Fluent Tasks to a Markdown note, if `autoCollapseSidebarOnSwitch` is true, the sidebar cleanly collapses. When switching back, if `autoExpandSidebar` is true, it reveals the current list.
3. In-flight drag hover: User drags a task or list towards the left screen edge. `TaskMainView` / `TaskSidebarView` invokes `expandSidebarTemporarilyForDrag()`.
4. Drop or cancel: `revertTemporarySidebarDragExpansion()` closes the temporary split after a 400ms debounce.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `registerEventListeners` | `(plugin: Plugin): void` | Registers `active-leaf-change` and keyboard listeners |
| `expandSidebarTemporarilyForDrag` | `(): Promise<void>` | Expands left split; sets `_isSidebarTemporarilyExpandedForDrag` |
| `revertTemporarySidebarDragExpansion` | `(): void` | Debounces collapse of temporary split |
| `expandSidebarToList` | `(): Promise<void>` | Expands left sidebar and reveals active list |
| `collapseLeftSidebar` | `(): void` | Collapses left split if plugin sidebar is active |
| `destroy` | `(): void` | Clears timeouts and safety cleanup hooks |

## Recipes

1. **Temporary drag expansion** — In `TaskMainView.svelte` drag handlers, call `plugin.sidebarCoordinator.expandSidebarTemporarilyForDrag()` on left edge proximity.
2. **Revert on drop** — Call `plugin.sidebarCoordinator.revertTemporarySidebarDragExpansion()` on pointer up.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
