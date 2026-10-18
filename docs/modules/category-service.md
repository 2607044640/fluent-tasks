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
3. Deduplication in `.metadata.json` and tree construction is keyed by physical disk `filepath` (basename), NOT display name. Sibling-scoped unique name resolution (`resolveUniqueName`) auto-disambiguates collisions to `name(1)` when renaming within the same container or moving items, while allowing different groups to have lists with identical display names (`SidebarCategoryEntry` `{ name: string; file?: string }`). Files on disk not in metadata are appended as root categories. (Why chosen over display name deduplication: users expect independent namespaces per group, mirroring modern task managers like MS To Do.)

## Numbered Data Flow

1. `getSidebarItems`: `ensureDataFolder` → list `TFolder` children that are `.md` and not `.*` → `loadSidebarState` → walk state, match by `childFile` or `childName`, deduplicate by physical file basename (`usedFiles`) → append orphans → maybe `saveSidebarState` (auto-heal).
2. `saveSidebarState`: dedupe groups and physical filepaths → convert item to `{ name, file: fileBasename }` only if disk basename diverges from display name (otherwise plain string or `{ name }`) → `adapter.write` `{ sidebar: SidebarItemState[] }` after `markInternalWrite`.
3. `createCategory(name)`: resolve unique display name among root lists via `resolveUniqueName`; find available disk path via `getAvailableDiskFilepath`; update in-memory state and save metadata FIRST; `vault.create(path, "")`; emit `CATEGORY_LIST_CHANGED`.
4. `createGroup`: in-memory `GroupInfo` with random id, unshift, save, emit.
5. `deleteGroup`: splice group, splice its children into the parent list, auto-disambiguating colliding names against root lists via `resolveUniqueName`.
6. `deleteCategory`: locate item and its group; `fileManager.trashFile` if present; strip from tree; save; emit `CATEGORY_LIST_CHANGED` and `CATEGORY_DELETED` (with file content and index for undo).
7. `renameCategory`: locate category in containing group or root; determine sibling display names; resolve unique display name via `resolveUniqueName`; find available disk path via `getAvailableDiskFilepath`; update in-memory state; `saveSidebarState` FIRST; if disk path changed, `vault.rename`; emit `CATEGORY_LIST_CHANGED`.
8. `restoreCategory`: undo helper; re-creates/overwrites file on disk; inserts into original group or root with sibling name disambiguation; saves metadata and selects restored category.

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
| `getAvailableDiskFilepath` | `(baseName: string, currentFilepath?: string): { filepath: string; basename: string }` | Pure check against `vault.getAbstractFileByPath` |
| `restoreCategory` | `(name, filepath, content, groupName?, index?): Promise<CategoryInfo>` | Vault file write + metadata write + EventBus |

## Recipes

1. **Load sidebar** — `TaskSidebarView.loadSidebarItems` → `dataService.getSidebarItems`.
2. **Add list** — `confirmAddList` → `dataService.createCategory(name)` → select it via `CATEGORY_SELECTED`.
3. **F2 rename** — `triggerRenameHoveredOrActive` → `confirmRename` → `renameCategory` or `renameGroup`. Sibling collision resolves to `name(1)` in same container.
4. **Drag list into group** — sidebar HTML5 DnD rebuilds `SidebarItem[]` then `saveSidebarState`. Shared helper in Quick modals: `moveSidebarItem` (`sidebarTreeUtils.ts`) resolves sibling collisions via `ensureUniqueCategoryName`.
5. **Refresh Command Palette jumps** — plugin listens `CATEGORY_LIST_CHANGED` → `registerCategoryCommands`.
6. **Undo list deletion** — `restoreCategory` re-creates/overwrites list `.md`, cleans orphan state, re-inserts into target group or root, and focuses the list.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
