# Fluent Tasks

Obsidian plugin: a three-pane, drag-and-drop task manager inspired by Microsoft To Do, Todoist, and TickTick. Version **1.0.47** (`manifest.json`). Desktop and mobile (`isDesktopOnly: false`). Minimum Obsidian **1.8.7**.

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
- Dedicated linked notes: `TodoData/<ListName>/<Title5>_<ListName>_<GroupName>_<taskId>.md` with YAML frontmatter `title: "<TaskTitle>"`
- Plugin options: Obsidian plugin data (`accentColor`, modal/sidebar toggles, Quick List grid settings, backup toggles, undo durations, task weight mode, center align tasks mode)

There is no cloud lock-in or external server dependency. All data remains 100% local in your Obsidian vault.

## Key Features

- **Interactive Drag Sidebar Integration & Smooth Auto-Scroll**: When dragging tasks across lists, automatically expands the left sidebar and highlights/reveals the source list (active in Floating UI mode, or optionally enabled in normal mode via `Auto-Expand Left Sidebar on Task Drag`). Features continuous rAF auto-scrolling when hovering near the top or bottom edges of the list view, with instant top-right toasts confirming successful cross-list moves.
- **List Navigation History (Alt+Left / Alt+Right)**: In-memory session history stack enabling effortless traversal across recently viewed lists. Jump backwards and forwards seamlessly via `Alt + ←` / `Alt + →`, `Alt + Left/Right click` (triggering strictly on release to prevent duplicate jumps), or mouse side buttons (Back / Forward).
- **In-Modal Subtask Search (Ctrl+F)**: Dedicated search inside the subtasks floating modal (`TaskStepsModal`) with auto-focus, subtle soft-accent backdrop highlighting, and centered viewport scrolling.
- **Lists & Groups**: Create custom lists and organize them into collapsible groups. Different groups can have lists with identical display names, with automated sibling collision disambiguation (`name(1)`). Drag-and-drop lists into groups or reorder them freely. Press **F2** to rename hovered or active lists.
- **Star Mode (Smart Aggregation)**: Dedicated virtual Star Mode aggregating all starred tasks across all lists into a single unified view. Toggling stars in Star Mode directly updates the task's originating list with live setting reactivity.
- **In-List Task Search (Ctrl+F)**: Fast in-page search bar triggered by `Ctrl+F` (or `Cmd+F` on macOS) or the more options menu. Scopes search strictly to the active list, supporting deep matching across titles, checklist steps, and notes, with keyboard navigation (`↑`/`↓`/`Enter`) and automatic scroll-to-task highlighting.
- **Task Management & Priority Weight Scoring**: Inline task creation, completion toggles, star/pin priority, drag-and-drop task reordering, and moving tasks between lists via hierarchical submenus with fuzzy search fallback. Optional 1-9 priority score weighting with stepper controls and dynamic stable sorting.
- **Linked Notes & Frontmatter Synchronization**: One-click linked note creation per task. Files use identifiable, tab-friendly paths (`<Title5>_<ListName>_<GroupName>_<taskId>.md`) starting with the first 5 sanitized characters of the task title so notes are immediately readable in truncated Obsidian tabs. Two-way synchronizes the task title via the note's YAML frontmatter `title` property. Renaming a list or task automatically updates note paths with full auto-healing. Automatic migration of legacy notes.
- **More Options Menu & Batch Operations**: Clean three-dots header menu consolidating list search, multi-select mode, backup manager, shortcuts guide, and display alignment. Multi-select supports batch star/unstar and batch deletion.
- **Center-Align Tasks Mode**: Toggle center alignment for task titles, steps counters, and wrapped multi-line text directly from the more options menu or plugin settings.
- **Subtasks & Quick Context Menu**: Dedicated detail panel and floating modal for step checklists. Full vertical drag-and-drop step reordering with zero-loss safety reconciliation. Right-click any task to instantly access **Add side step** as the top context menu action, followed by **Star task** and hierarchical **Move to**.
- **Image Attachments & Antigravity-Style Thumbnails**: Paste screenshots directly via `Ctrl+V` or drag-and-drop into subtasks and task notes. Compact, top-aligned thumbnails appear right above the text with hover shortcuts (`Ctrl+C` to copy to clipboard, `Ctrl+X` to cut) and single-click full-screen lightbox preview. Images store locally in your vault's attachment directory.
- **Multi-Tier Deletion Undo**: Instant floating toast undo mechanism for deleted tasks (single or batch), subtasks, and lists, with configurable undo timer in settings.
- **Due Dates & Recurrence**: Schedule tasks with smart presets (today, tomorrow, next week) and flexible recurrence rules (daily, weekdays, weekly, custom). Overdue recurring tasks automatically roll over.
- **Quick Modals & Dashboard Grid**: Access Quick List board (`Ctrl+Shift+L` or command) and Quick Task popup for rapid task capture and navigation. Dynamically adapts viewport padding, margins, and column layouts to user font sizes.
- **Automatic & Manual Backups**: Built-in Backup Manager with automatic daily snapshots, manual export, import, and backup history management.
- **Hide Left Sidebar (Floating UI Mode)**: Optional setting to hide the left sidebar list view completely for a distraction-free experience. When active, navigates lists via the Quick List floating modal, featuring persistent top-right status reminders if a hotkey has not yet been assigned.
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
| Backup Manager | Command **Open Backup Manager** or header more options menu |

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
- `toggle-task-star-hover`: Toggle star on hovered task

Dynamic commands:
- `z-jump-to-list-<hash>`: Dedicated jump command per list file path

## License

MIT License. See [LICENSE](./LICENSE) for details.
