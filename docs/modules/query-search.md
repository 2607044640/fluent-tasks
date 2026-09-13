# Query, Search, and Filter

There is **no** query language, tokenizer, or sort-key engine. Matching is case-insensitive substring `includes`. List order is file order (incomplete block then completed after `updateTask`).

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `DataService.searchTasks` | Scan lists; match title, then steps text, then `note`; tag `matchField` | Regex query AST, ranking |
| `TaskSearchModal` (`src/TaskSearchModal.ts`) | SuggestModal UI; optional `scopeFilepath`; hide-completed toggle persisted in settings | Writing tasks |
| `filterSidebarTree` (`src/utils/sidebarTreeUtils.ts`) | Filter groups/lists by name; expand groups that match | Task body search |
| `TaskMainView.loadTasks` | Split `getTasks` into `incompleteTasks` / `completedTasks` | Re-sort by due date or star (not implemented) |
| `QuickTaskModalView.handleSearchInput` | Calls `searchTasks` across all lists | Scope-to-current-list (that is the other command) |
| `QuickListModalView` | `filterSidebarTree(sidebarItems, searchQuery)` only | Task search |

## Key Invariants

1. Empty/whitespace query returns `[]` (search) or the unfiltered tree (sidebar filter). (Why chosen over showing all tasks in the SuggestModal: the modal is type-to-search, not a picker of the full vault.)
2. First matching field wins (`Title` else `Steps` else `Note`); a task appears at most once per list. (Why chosen over multiple hits per task: SuggestModal rows are one-task-one-row.)
3. `searchHideCompleted` is a **display** filter on results, not part of `searchTasks`. (Why chosen over baking it into the service: the modal toggle and settings share one boolean.)

## Numbered Data Flow

1. Command `search-all-tasks` → `new TaskSearchModal(app, plugin, dataService).open()`.
2. Command `search-current-list` reads `TaskMainView.getCurrentCategory()?.filepath` as `scopeFilepath` (null if no main leaf).
3. `getSuggestions(query)` → `dataService.searchTasks` → optional `results.filter(r => !r.task.completed)`.
4. `onChooseSuggestion` emits `CATEGORY_SELECTED`, then after 200ms `TASK_NAVIGATE` `{ taskId, isCompleted }` and `TASK_SELECTED`.
5. `TaskMainView.handleTaskNavigate` expands the completed accordion if needed, `scrollIntoView`, CSS `navigate-highlight`.
6. Quick List modal: reactive `filteredItems = filterSidebarTree(...)`. If group **name** matches, children are kept; else only matching children, with `isExpanded: true`.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `DataService.searchTasks` | `(query: string, scopeFilepath?: string \| null)` | Read path; `getTasks` may auto-heal/rollover |
| `TaskSearchModal.getSuggestions` | `(query: string): Promise<TaskSearchResult[]>` | None beyond search |
| `TaskSearchModal.onChooseSuggestion` | `(item, evt): void` | EventBus emits (category + navigate + select) |
| `TaskSearchModal.onOpen` toggle click | — | Writes `settings.searchHideCompleted` via `saveSettings` |
| `filterSidebarTree` | `(items: SidebarItem[], query: string): SidebarItem[]` | None (pure) |
| `getFlatCategories` | `(items: SidebarItem[]): CategoryInfo[]` | None (pure) |

## Recipes

1. **Search everything** — Command Palette “Search all tasks” or sidebar `openGlobalSearch`.
2. **Search this list** — “Search tasks in current list” (no-op scope if main view has no category).
3. **Show completed in search** — click “Active only” / “All tasks” in the modal; persists `searchHideCompleted`.
4. **Filter lists in Quick List** — type in the modal filter bar (`filterSidebarTree`); Enter opens the focused list via `openCategoryInCenterOnly`.
5. **Quick Task search** — typing in Quick Task filter bar sets `isSearching` and `searchResults = await dataService.searchTasks(query)` (no completed hide unless the tasks themselves are filtered in the list pane).

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
