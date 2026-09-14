# Fluent Tasks

Obsidian plugin: a three-pane, drag-and-drop task manager inspired by Microsoft To Do, Todoist, and TickTick. Version **1.0.23** (`manifest.json`). Desktop and mobile (`isDesktopOnly: false`). Minimum Obsidian **1.7.2**.

Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md).

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
- Plugin options: Obsidian plugin data (`accentColor`, modal/sidebar toggles, Quick List gaps, …) — not the task files

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
3. **Subtasks / notes / linked note** — Detail pane for steps and the `%%{}%%` note field. Header link button creates `TodoData/<List>/<title>.md` and sets `note_link`.
4. **Due date and repeat** — Detail schedule: today / tomorrow / next Monday, plus **daily**, **weekdays**, **weekly**, or **custom**. Recurring tasks stay one row; overdue incomplete recurrences snap due date to today.
5. **Search / Quick List / Quick Task** — Commands **Search all tasks**, **Search tasks in current list**, **Open Quick List Modal**, **Open Quick Task Modal (Experimental)**.

Extra metadata on a task (detail **Add metadata**): `why`, `svgs`, `note_link`, `customMeta`. Settings tab: accent color, details modal, wrap titles, Quick Task/List layout and grid gaps, auto-expand/collapse, search hide-completed, hide ribbon.

Static commands (`fluent-tasks:`): `open-all-views`, `open-sidebar`, `open-main-view`, `open-detail-view`, `search-all-tasks`, `search-current-list`, `rename-hovered-list-or-group`, `open-quick-list-modal`, `open-quick-task-modal`. Dynamic: `z-jump-to-list-<hash>` per category file path.
