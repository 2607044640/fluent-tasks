# Fluent Tasks

Obsidian plugin: a three-pane, drag-and-drop task manager inspired by Microsoft To Do, Todoist, and TickTick. Version **1.0.23** (`manifest.json`). Desktop and mobile (`isDesktopOnly: false`). Minimum Obsidian **1.7.2**.

Architecture (code map, invariants, module router): [fluent-tasks_Architecture.md](./fluent-tasks_Architecture.md).

## What it stores

All lists are ordinary Markdown files:

- Folder: `TodoData/` (constant `DATA_FOLDER` in `src/types.ts`)
- One list = one file `TodoData/<ListName>.md`
- Each task is a checklist line plus an Obsidian comment:

```markdown
- [ ] Buy milk %%{"id":"...","starred":false,"steps":[],"note":"","createdAt":"..."}%%
```

- Sidebar groups and order: `TodoData/.metadata.json` (dotfile, written via the vault adapter)
- Optional dedicated notes: `TodoData/<ListName>/<TaskTitle>.md` with YAML `taskId`
- Plugin options: Obsidian plugin data (`accentColor`, modal/sidebar toggles, …) — not the task files

There is **no** Microsoft Graph / To Do cloud sync in this repository. Optional fields `msGraphId` and `msGraphListId` are only serialized if present.

## Install and build

Requires Node. From the plugin directory:

```bash
npm install
npm run dev      # esbuild watch → main.js
npm run build    # production bundle
```

Copy or symlink the folder into `<vault>/.obsidian/plugins/fluent-tasks/` with `main.js`, `manifest.json`, and `styles.css`. Enable **Fluent Tasks** in Community plugins.

## Open the UI

| Action | How |
|---|---|
| All panes | Ribbon check-square (unless hidden) or command **Open all views** |
| Sidebar / main / detail | Commands **Open sidebar**, **Open main view**, **Open detail view** |
| Detail as floating modal | Settings → **Open Task Details in Floating Modal** |
| Jump to a list | Command Palette `Z-Jump to list: <name>` (registered per list) |

Layout: left **Fluent Tasks** sidebar, center task list, right details (or modal). Switching to a Markdown tab can auto-collapse plugin sidebars; switching back can auto-expand (settings).

## Daily use

1. **Lists and groups** — Sidebar `+` for a list or group. Drag lists into groups. **F2** (or command **Rename hovered or active list / group**) renames. Delete list uses Obsidian trash; deleting a group ungroups lists (does not trash files).
2. **Tasks** — Type in the main input, Enter. Click the circle to complete, star to pin. Completed rows sit in a collapsible section. Drag to reorder; drag onto another sidebar list (or right-click **Move to …**) to move.
3. **Subtasks (steps)** — Detail pane, or click the steps badge / hover card to open the floating steps editor.
4. **Notes on the task** — Detail pane note field (stored in the `%%{}%%` JSON).
5. **Linked note** — Detail header link button creates `TodoData/<List>/<title>.md` and sets `note_link`. Title edits rename the file; renaming the file updates the task. Deleting a task with a bound note asks: cancel, task only, or task + trash note.
6. **Due date and repeat** — Detail schedule section: today / tomorrow / next Monday, plus repeat **daily**, **weekdays**, **weekly** (by weekday), or **custom** interval. Recurring tasks stay one row: after completion, the next local calendar day un-completes them and clears step checkmarks. Overdue incomplete recurrences snap due date to today. Rollover also runs about every 10 seconds and on window focus.
7. **Search** — Commands **Search all tasks** / **Search tasks in current list** (title, steps, note; no query syntax). Toggle **Active only** vs **All tasks** (saved as `searchHideCompleted`). Choosing a hit opens the list, scrolls, and opens details.
8. **Quick List modal** — Command **Open Quick List Modal**. Filter lists, arrow-key the board, Enter opens the list in the center and collapses sidebars. Grid vs single column: setting **Quick List Modal: Grid Board Layout**.
9. **Quick Task modal** — Command **Open Quick Task Modal (Experimental)**. Setting **Quick Task Modal Action**: manage complete/star/add inside the popup (`direct`) or jump into the workspace (`navigate`).
10. **Ctrl-hover peek** — Hold Ctrl (not the Windows key) over a title for a floating preview. Features/shortcuts: help icon on the main view.

Extra metadata on a task (detail **Add metadata**): `why`, `svgs` (inline SVG or vault path), `note_link`, `customMeta`.

## Settings

Settings tab **Fluent Tasks**:

- Accent color (live CSS `--todo-accent*`)
- Open details in floating modal
- Wrap task titles
- Quick Task modal action; Quick List grid layout
- Auto-expand sidebar on focus; auto-collapse when leaving plugin views
- Search: hide completed by default
- Hide ribbon icon

## Commands (static)

Plugin id prefix `fluent-tasks:`:

- `open-all-views`, `open-sidebar`, `open-main-view`, `open-detail-view`
- `search-all-tasks`, `search-current-list`
- `rename-hovered-list-or-group`
- `open-quick-list-modal`, `open-quick-task-modal`

Dynamic: `z-jump-to-list-<hash>` per category file path.

## Module docs

| Area | Doc |
|---|---|
| Plugin, views, EventBus | [plugin-lifecycle](./docs/modules/plugin-lifecycle.md) |
| Checklist codec | [markdown-parser](./docs/modules/markdown-parser.md) |
| Facade + `vault.process` | [data-service](./docs/modules/data-service.md) |
| Task CRUD | [task-service](./docs/modules/task-service.md) |
| Lists / groups | [category-service](./docs/modules/category-service.md) |
| Repeat rules | [recurrence-engine](./docs/modules/recurrence-engine.md) |
| Bound notes | [linked-notes](./docs/modules/linked-notes.md) |
| Substring search | [query-search](./docs/modules/query-search.md) |
| Svelte panes and modals | [svelte-ui](./docs/modules/svelte-ui.md) |
| Settings keys | [settings](./docs/modules/settings.md) |
