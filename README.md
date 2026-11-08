# Fluent Tasks

A three-pane, local-first task manager for Obsidian inspired by Fluent Design principles. Version **1.0.62** (`manifest.json`). Compatible with desktop and mobile (`isDesktopOnly: false`). Requires Obsidian **1.8.7** or later.

Architecture documentation: [ARCHITECTURE.md](./ARCHITECTURE.md).

## What it stores

All lists and tasks reside as standard Markdown documents inside your Obsidian vault with zero cloud lock-in:

- Data directory: `TodoData/` (defined as `DATA_FOLDER` in `src/types.ts`)
- One list corresponds to one file: `TodoData/<ListName>.md`
- Each task occupies a single physical Markdown checklist line with embedded JSON metadata:

```markdown
- [ ] Buy groceries %%{"id":"...","starred":false,"steps":[],"note":"","createdAt":"..."}%%
```

- Sidebar groups and list order: `TodoData/.metadata.json`
- Dedicated linked notes: `TodoData/<ListName>/<Title5>_<ListName>_<GroupName>_<taskId>.md` with frontmatter `title: "<TaskTitle>"`
- Configuration and layout preferences: standard Obsidian plugin storage (`data.json`)

All data remains entirely local to your vault.

## Features

### 1. Task Lifecycle & Scheduling

#### Task State & Priority Scoring
- Standard Checklist & Auto-Archive: Tasks follow standard Markdown checklist states, with completed items automatically sinking below active tasks to keep lists clear.
- Priority Weight Scoring: Tasks support 1–9 numeric priority scoring, allowing stable priority-weighted sorting across active lists.
- Viewport Highlight & Navigation: Newly created or search-selected tasks trigger smooth scrolling into view accompanied by an accent boundary highlight.
- Compact Quick Add & Auto-Commit: The quick-entry field stays compact while idle and expands on interaction, with draft auto-commit safeguards to prevent unfinished task loss.

#### Due Dates & Recurrence Engine
- Multi-Pattern Recurrence Rules: Recurring tasks support daily, weekday-only, weekly-on-specific-days, and custom day-interval cycles.
- Local Calendar Snap & Overdue Rollover: Due dates evaluate strictly against the user's local calendar day rather than UTC timestamps, preventing date shifts across timezones. Overdue tasks automatically snap forward to the current calendar date on app startup or interval checks.
- In-Place Single-Row Rollover: Recurrences cycle within their existing Markdown line rather than generating duplicate stacked task rows, resetting subtask checklist states upon rollover.

#### Smart Starred Aggregation
- Unified Virtual Starred View: Aggregates all priority-starred tasks from every list into a single virtual board.
- Bidirectional State Synchronization: Status toggles and star edits inside the starred view map directly to their underlying list files without data drift.

### 2. Lists & Hierarchical Structure

#### Hierarchical List Groups
- Foldable Group Containers: Lists can be grouped into collapsible sections to organize distinct projects or areas of responsibility.
- Vault-Wide Global List Name Uniqueness: List names are enforced as globally unique across all groups and the root level, automatically appending collision-safe numeric suffixes (`name(1)`) during creation, renaming, or restoration.
- In-Place Renaming: Lists and groups support instant in-place renaming with synchronized disk file renaming and metadata integrity protection.

#### Dedicated Linked Notes
- Bound Markdown Notes per Task: Tasks can bind to dedicated Markdown notes stored in structured subfolders.
- Two-Way Title & Slug Synchronization: Note filenames automatically mirror the first five alphanumeric characters of the task title, while the note frontmatter preserves the full task title with automatic two-way rename updates.
- Cascade Deletion Safeguards: Deleting a task with an attached note offers the choice to retain the document or trash both together.

#### Quick Switcher & Header Integration
- Pinned List Header Pills: Frequently accessed lists can be pinned as horizontal pills in the main view header for rapid switching.
- Active List Title in Window Header: The active list name can display directly within the native Obsidian window leaf header, maximizing vertical reading space.

### 3. Drag-and-Drop & Blueprint Boards

#### List-Level Reordering & Inertial Scrolling
- Vertical Card & Step Reordering: Tasks, subtask steps, and lists support smooth vertical drag-and-drop reordering.
- requestAnimationFrame Edge Auto-Scroll: Dragging near the top or bottom edges initiates smooth, linear auto-scrolling driven by `requestAnimationFrame`.
- In-Flight Wheel Panning: Window-level capture listeners allow scrolling lists or panning boards with the mouse wheel while holding an active drag operation.

#### Context-Aware Sidebar Expansion
- Hover-Triggered Drawer Expansion: Dragging a task toward the sidebar expands the list drawer to drop tasks across lists.
- Edge-Only Expansion Boundary: An optional sensitivity threshold restricts sidebar drawer expansion exclusively to intentional drags near the screen boundary, avoiding accidental expansion during normal in-list sorting.

#### Blueprint Table Board & RTS Panning Engine
- Three View Layouts: The board supports switching between an automated pixel-height packing Grid, a freeform multi-column Table Blueprint, and a Classic Single-Column List.
- Freeform Column & Row Arrangement: In Table mode, group cards can be repositioned into arbitrary columns and rows, automatically pruning empty columns and persisting coordinates locally.
- Zero-Dead-Zone Header Dragging: Full group card headers serve as drag handles, with text selection shields preventing accidental text highlights from blocking drag initiation.
- Glowing Insertion Lines with Leading Pip: Visual drop indicators render as glowing gap-filling accent lines with leading circular pips between cards.
- Inter-Column Insertion Zones: Dedicated drop zones between columns allow dropping group cards to spawn new columns on the fly.
- RTS Edge Auto-Panning: Dragging within boundary margins activates directional 8-way navigation cursors, tactical arrow badges, and variable-speed canvas panning.

### 4. Subtasks & Floating Workspaces

#### Subtask Checklists & Progressive Disclosure
- Multi-Item Subtask Checklists: Tasks support detailed subtask checklists with independent completion toggling.
- Auto-Collapsing Completed Steps: Completed subtasks collapse into single-line strikethrough preview rows to declutter the workspace, with single-click expansion available when needed.
- Blank Step Auto-Pruning: Empty step drafts automatically clean up upon saving or removing attachments.

#### Image Attachments & Full-Screen Lightbox
- Clipboard & Drag-and-Drop Images: Screenshots and image files paste or drop directly into tasks, steps, or notes, stored in the designated vault attachment directory.
- Top-Aligned Compact Thumbnails: Thumbnails render above step and note text in a clean, consistent row without disrupting text alignment.
- Full-Screen Lightbox Viewer: Embedded images open in a dedicated modal featuring multi-level zoom, pan, and direct navigation to the original Obsidian asset.
- Garbage Collection for Orphan Attachments: Image attachments unreferenced by any task or step are purged automatically to conserve disk space.

#### Distraction-Free Floating Windows
- Standalone Full-Screen Detail Modal: Task details can open in an acrylic floating modal independent of sidebar leaf docking.
- Margin Click-to-Focus: Clicking the blank margin space around centered titles, steps, or notes directs focus to the input field without jumping carets or resetting selections.
- Structured XML Export: Formats complete task data (title, active steps, ruled-out steps, notes, rationale, due dates) into structured semantic XML tags ready for clipboard export.

### 5. Search, Filter & Action History

#### Multi-Scope Search & Highlighting
- Global & List-Scoped Search: Supports searching across all lists in the vault or scoping strictly to the current active list.
- Deep Field Coverage: Query matching inspects task titles, subtask step descriptions, and attached note bodies.
- Active-Only Visibility Toggle: Search results can toggle between displaying all matched items or hiding completed tasks.
- Smooth Scroll & Focus Highlighting: Selecting a search result expands any collapsed parent section, smoothly centers the task in the viewport, and pulses an accent boundary.

#### Global Undo & Redo System
- Comprehensive Action History: Reversible history tracks task priority adjustments, title modifications, subtask changes, star toggles, creations, deletions, and list moves.
- Rapid Mutation Merging: Rapid successive changes to the same field (such as rapid wheel scrolling or continuous typing) merge into a single atomic history step.
- Focus Isolation: Undo operations yield to native editor undo whenever typing inside Obsidian markdown notes or external inputs.
- Multi-Tier Deletion Undo Toasts: Deleting tasks, subtask items, or entire lists triggers an acrylic floating toast in the corner with a configurable restoration timer.

### 6. Storage Architecture & Backup

#### Transparent Local-First Storage
- Standard Markdown Checklist Format: All task lists reside as plain Markdown files in your vault, accessible and editable by standard text editors with zero vendor lock-in.
- Embedded JSON Metadata: Task IDs, creation timestamps, recurrence rules, and attachment links serialize cleanly within HTML comment blocks at the end of each checklist line.
- Atomic File I/O Pipeline: Task modifications pass through an atomic processing pipeline to eliminate race conditions and prevent file corruption.

#### Automated & Manual Backup Engine
- Automatic Daily Snapshots: Generates timestamped snapshots of all list files and metadata on the first run of each calendar day.
- Backup Management Console: A visual backup dashboard allows reviewing, restoring, or pruning historic snapshot archives.
- Single-File Archive Export & Import: Complete task databases bundle into portable JSON archive files for backup export or cross-vault migration.

### 7. Visual Customization & Coexistence

#### Visual Appearance & Layout Tuning
- Custom Accent Color & Glow: Custom accent colors apply dynamically across interactive borders, glowing drop indicators, and active badges.
- Hairline Separator Width: Configurable gradient hairline dividers separate task cards with customizable width percentages.
- Center-Aligned Layouts & Title Wrapping: Supports optional center alignment for task titles and checklist rows, along with multi-line title wrapping.
- Minimalist Floating UI Mode: Allows completely hiding the left sidebar list view, relying on floating modals for an uncluttered workspace.

#### Workspace Coexistence & Localization
- Non-Intrusive Split Management: Coexists with Obsidian core leaves (File Explorer, Search, Bookmarks), only managing sidebar splits when the task view itself is active.
- Native Bilingual Interface: Includes complete English and Simplified Chinese interface localizations, automatically adapting to Obsidian's active language setting.

## Installation

### Community Plugins Directory
Search for **Fluent Tasks** in Obsidian Settings -> Community Plugins, then install and enable.

### Via BRAT
In the BRAT plugin settings, choose **Add Beta plugin** and enter the repository URL: `https://github.com/2607044640/fluent-tasks`.

### Manual Build
Requires Node.js. From the plugin directory:

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/fluent-tasks/`, then reload Obsidian and enable **Fluent Tasks**.

## Open the UI

| View Surface | Activation |
|---|---|
| All three panels | Ribbon check-square icon or Command Palette **Open all views** |
| Task list sidebar | Command Palette **Open sidebar** |
| Main task list view | Command Palette **Open main view** |
| Task detail view | Command Palette **Open detail view** |
| Task detail floating modal | Plugin Settings -> **Open Task Details in Floating Modal** |
| Jump directly to a list | Command Palette `Z-Jump to list: <name>` (registered per list) |
| Quick List board | Command Palette **Open Quick List Modal (List only)** |
| Backup Manager | Command Palette **Open Backup Manager** or main view options menu |

## Commands

Static commands (`fluent-tasks:`):
- `open-all-views`: Open all three panels
- `open-sidebar`: Open the task list sidebar
- `open-main-view`: Open the main task list view
- `open-detail-view`: Open the task detail view
- `search-all-tasks`: Global task search modal
- `search-current-list`: Search tasks within current list
- `rename-hovered-list-or-group`: Rename hovered or active list or group
- `open-quick-list-modal`: Open Quick List modal board
- `open-quick-task-modal`: Open Quick Task modal popup
- `open-backup-modal`: Open Backup Manager modal
- `toggle-task-star-hover`: Toggle star on hovered task
- `undo-action`: Undo last task action
- `redo-action`: Redo last task action
- `navigate-list-back`: Navigate to previous list
- `navigate-list-forward`: Navigate to next list

Dynamic commands:
- `z-jump-to-list-<hash>`: Dedicated jump command per list file path

## License

MIT License. See [LICENSE](./LICENSE) for details.
