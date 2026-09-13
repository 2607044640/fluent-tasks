# Category Service

Lists are flat Markdown files `TodoData/<name>.md`. Groups exist only in `TodoData/.metadata.json`. Physical files plus metadata reconstruct the sidebar tree.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `CategoryService` (`src/services/CategoryService.ts`) | Tree load/save, create/rename/delete list or group, orphan file append, metadata migrate | Task line parse, recurrence, linked notes |
| `.metadata.json` via `vault.adapter` | Persist `SidebarItemState[]` (`sidebar`); migrate legacy `categoryOrder` | Task bodies |
| `DATA_FOLDER` (`TodoData`) | Root for list files and metadata | Nested list `.md` (plugin treats only **top-level** `.md` as categories) |

## Key Invariants

1. Metadata is read/written with `app.vault.adapter`, not `vault.read` / `vault.modify`. (Why chosen over Vault API: Obsidian ignores dotfiles.)
2. `renameCategory` **updates metadata first**, then `vault.rename`. (Why chosen over rename-then-metadata: a vault `rename` event would treat the new file as an orphan at the bottom of the tree.)
3. Duplicate group ids or category names in metadata are skipped and the tree is auto-saved (`hasDuplicateMetadata`). Files on disk not in metadata are appended as root categories. (Why chosen over trusting JSON as SSOT: users can create `.md` files by hand.)

## Numbered Data Flow

1. `getSidebarItems`: `ensureDataFolder` → list `TFolder` children that are `.md` and not `.*` → `loadSidebarState` → walk state, attach existing files, skip dupes → append orphans → maybe `saveSidebarState`.
2. `saveSidebarState`: dedupe groups/categories → `adapter.write` `{ sidebar: SidebarItemState[] }` after `markInternalWrite`.
3. `createCategory(name)`: reject if path exists; unshift `{ type: "category", name }` into metadata; `vault.create(path, "")`; emit `CATEGORY_LIST_CHANGED`.
4. `createGroup`: in-memory `GroupInfo` with random id, unshift, save, emit.
5. `deleteGroup`: splice group, splice its children into the parent list (lists are not deleted).
6. `deleteCategory`: `fileManager.trashFile` if present; strip name from tree; save; emit.
7. `renameCategory`: rewrite names in metadata (root and `group.children`), `vault.rename` to `TodoData/<newName>.md`, emit.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `getSidebarItems` | `(): Promise<SidebarItem[]>` | May auto-heal `.metadata.json` |
| `loadSidebarState` | `(): Promise<SidebarItemState[]>` | Adapter read; `[]` on error |
| `saveSidebarState` | `(items: SidebarItem[]): Promise<void>` | Adapter write of `.metadata.json` |
| `createCategory` | `(name: string): Promise<CategoryInfo>` | Metadata write + `vault.create`; EventBus |
| `createGroup` | `(name: string): Promise<GroupInfo>` | Metadata write; EventBus |
| `renameGroup` | `(groupId: string, newName: string): Promise<void>` | Metadata write; EventBus |
| `deleteGroup` | `(groupId: string): Promise<void>` | Metadata write; EventBus; does not trash list files |
| `deleteCategory` | `(filepath: string): Promise<void>` | Trash `.md`; metadata write; EventBus |
| `renameCategory` | `(filepath: string, newName: string): Promise<CategoryInfo>` | Metadata write + `vault.rename`; EventBus |

## Recipes

1. **Load sidebar** — `TaskSidebarView.loadSidebarItems` → `dataService.getSidebarItems`.
2. **Add list** — `confirmAddList` → `dataService.createCategory(name)` → select it via `CATEGORY_SELECTED`.
3. **F2 rename** — `triggerRenameHoveredOrActive` → `confirmRename` → `renameCategory` or `renameGroup`.
4. **Drag list into group** — `TaskSidebarView.handleDrop` rebuilds `SidebarItem[]` then `saveAndSyncSidebarState` → `saveSidebarState`.
5. **Refresh Command Palette jumps** — plugin listens `CATEGORY_LIST_CHANGED` → `registerCategoryCommands`.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
