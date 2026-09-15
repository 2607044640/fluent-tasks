# Fluent Tasks

Obsidian plugin: a three-pane, drag-and-drop task manager inspired by Microsoft To Do, Todoist, and TickTick. Version **1.0.25** (`manifest.json`). Desktop and mobile (`isDesktopOnly: false`). Minimum Obsidian **1.7.2**.

Architecture documentation: [ARCHITECTURE.md](./ARCHITECTURE.md).

## What it stores

All lists are stored as ordinary Markdown files inside your vault:

- Folder: `TodoData/` (constant `DATA_FOLDER` in `src/types.ts`)
- One list = one file `TodoData/<ListName>.md`
- Each task is a standard Markdown checklist line with an embedded JSON metadata comment:

```markdown
- [ ] Buy groceries %%{"id":"...","starred":false,"steps":[],"note":"","createdAt":"..."}%%
```

- Sidebar groups and list ordering: `TodoData/.metadata.json`
- Dedicated linked notes: `TodoData/<ListName>/<TaskTitle>.md` with frontmatter `taskId`
- Plugin options: Obsidian plugin data (`accentColor`, modal/sidebar toggles, Quick List grid settings, backup toggles)

There is no cloud lock-in or external server dependency. All data remains 100% local in your Obsidian vault.

## Key Features

- **Lists & Groups**: Create custom lists and organize them into collapsible groups. Drag-and-drop lists into groups or reorder them freely. Press **F2** to rename hovered or active lists.
- **Task Management**: Inline task creation, completion toggles, star/pin priority, drag-and-drop task reordering, and moving tasks between lists.
- **Batch Operations & Multi-Select**: Toggle multi-select mode to select multiple tasks and perform batch star/unstar or batch deletion.
- **Subtasks & Notes**: Dedicated detail panel for step checklists and inline notes. Create linked Markdown notes directly from tasks.
- **Due Dates & Recurrence**: Schedule tasks with smart presets (today, tomorrow, next week) and flexible recurrence rules (daily, weekdays, weekly, custom). Overdue recurring tasks automatically roll over.
- **Quick Modals & Dashboard Grid**: Access Quick List board (`Ctrl+Shift+L` or command) and Quick Task popup for rapid task capture and navigation. Configurable grid layouts, elastic gaps, and default focus list options.
- **Automatic & Manual Backups**: Built-in Backup Manager with automatic daily snapshots, manual export, import, and backup history management.
- **Internationalization**: Full bilingual support defaulting to English, with automatic Chinese localization when Obsidian runs in Chinese.

## Install and build

### From Community Plugins / BRAT
Search for **Fluent Tasks** in Obsidian Settings -> Community Plugins, or install via BRAT using the repository URL `https://github.com/2607044640/fluent-tasks`.

### Manual Build
Requires Node.js. From the plugin directory:

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/fluent-tasks/`, then reload Obsidian and enable **Fluent Tasks**.

## Open the UI

| Action | How |
|---|---|
| All panes | Ribbon check-square icon or command **Open all views** |
| Sidebar / main / detail | Commands **Open sidebar**, **Open main view**, **Open detail view** |
| Detail as floating modal | Settings -> **Open Task Details in Floating Modal** |
| Jump to a list | Command Palette `Z-Jump to list: <name>` (registered per list) |
| Quick List Board | Command **Open Quick List Modal (List only)** |
| Backup Manager | Command **Open Backup Manager** or header archive button |

## Commands

Static commands (`fluent-tasks:`):
- `open-all-views`: Open all three panels
- `open-sidebar`: Open the task list sidebar
- `open-main-view`: Open the main task list view
- `open-detail-view`: Open the task detail view
- `search-all-tasks`: Global task search modal
- `search-current-list`: Search tasks within current list
- `rename-hovered-list-or-group`: Rename hovered or active list / group (F2)
- `open-quick-list-modal`: Open Quick List modal board
- `open-quick-task-modal`: Open Quick Task modal popup
- `open-backup-modal`: Open Backup Manager modal

Dynamic commands:
- `z-jump-to-list-<hash>`: Dedicated jump command per list file path

## License

MIT License. See [LICENSE](./LICENSE) for details.
