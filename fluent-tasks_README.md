# Fluent Tasks - External Usage Guide

<context>
For underlying architecture modifications, data flow, and troubleshooting, please refer to: `fluent-tasks_Architecture.md`.
</context>

## Public Integration APIs

<api_reference>
| Method | Signature | Side-Effects |
| :--- | :--- | :--- |
| `TaskMainViewWrapper.file` | `get file(): TFile | null` | Pure getter. Returns the underlying markdown `TFile` of the currently active category (e.g. `TodoData/ag.md`). |
| `TaskMainViewWrapper.component.getCurrentCategory()` | `() => CategoryInfo | null` | Pure getter. Returns the metadata of the currently selected category in the main Svelte view. |
| `FluentTasksPlugin.expandSidebarToList()` | `() => void` | Expands the workspace left split and reveals the `fluent-tasks-sidebar` view leaf. |
| `FluentTasksPlugin.collapseSidebars()` | `(durationMs?: number, force?: boolean) => void` | Collapses left/right sidebars IF they are currently displaying Fluent Tasks views and suppresses auto-expansion. |
| `FluentTasksPlugin.isPluginLeftSidebarActive()` | `() => boolean` | Checks if `VIEW_TYPE_SIDEBAR` is currently the active visible tab in `leftSplit`. |
| `FluentTasksPlugin.isPluginRightSidebarActive()` | `() => boolean` | Checks if `VIEW_TYPE_DETAIL` is currently the active visible tab in `rightSplit`. |
</api_reference>

<adding_new_item_recipe>
To fetch the current task file from an external plugin (e.g. `open-vscode`):
1. Query the active leaf or specific `fluent-tasks-main` leaf.
2. Access the `.file` property on the view instance.
```javascript
const mainLeaf = this.app.workspace.getLeavesOfType("fluent-tasks-main")[0];
if (mainLeaf && mainLeaf.view && mainLeaf.view.file) {
    const taskFile = mainLeaf.view.file; // Returns TFile
}
```
</adding_new_item_recipe>

## Metadata Badges, Quick Peek & Cognitive Steering

<metadata_badges_system>
Fluent Tasks uses a lightweight Meta Badge and Quick Peek system to keep task cards clean while surfacing rich human-agent instructions, memory aids, and linked knowledge on demand:

### Interaction Patterns
- **Multi-line Title Wrapping (`wrapTaskTitles`)**: Enabled by default (`true`). Long task titles automatically wrap onto multiple lines in the center list without truncating or requiring the right detail sidebar to be opened. Can be toggled in plugin settings.
- **Dynamic Dual-Layer Auto-Growing Textareas**: Right-panel task title and subtask inputs utilize native CSS `field-sizing: content` combined with reactive `use:autosize={value}` (`scrollTop = 0` zero-clipping invariant) to ensure zero layout shift, seamless multi-line typing, and immediate shrinkage/expansion on external AI edits or task switching with zero residual height.
- **Sticky Standalone Ctrl Quick Peek**: Pressing or holding standalone <kbd>Ctrl</kbd> (or <kbd>Cmd</kbd> on macOS) while hovering over any task title displays a rich Quick Peek card containing the full unclipped title, subtasks checklist progress, notes, and due dates. Releasing Ctrl leaves the preview pinned in place until you right-click or preview another task. Combo keys (e.g. `Ctrl+C`, `Ctrl+Shift`, `Ctrl+V`) are strictly filtered out and instantly dismiss the popover to prevent accidental triggers.
- **External AI & Disk Synchronization**: Real-time vault file watchers detect external modifications to `TodoData/*.md` made by AI agents or external tools, automatically refreshing active lists and open task details with zero echo loops.
- **Direct Hover Badges (Zero-Ctrl Required)**:
  - **Subtasks Checklist (`0/x steps`) & Big Floating Editor**: Displayed on any task with sub-steps. Direct hover reveals a clean checklist popover showing all step items, check status (`✓` / `○`), and completion stats. Clicking the badge or the preview card opens the **Big Subtasks Floating Editor Modal** (`760px × 85vh`), featuring comfortable large typography (15.5px), smooth vertical scrolling for lengthy instructions/notes, direct multiline editing with Chinese IME shield, step addition/deletion, checkbox toggling, and instant debounced disk persistence without opening the right task detail panel.
  - **Why Rationale (`why`)**: Displayed as a `?` badge. Hovering reveals the causal rationale/methodology behind the task.
  - **Visual Memory Aid (`svgs`)**: Inline or vault SVG diagrams. Hovering provides an instant preview; clicking opens a full-screen zoom lightbox (`96vw × 94vh`) with auto-scaling vector graphics and one-click "Open in Tab" navigation.
  - **Linked Note (`note_link`)**: Dedicated hard-bound notes displayed with a distinctive interlocking chain-link icon. Hovering triggers Obsidian's native `Page Preview` popover in both Reading and Live Preview modes; clicking navigates directly to the note.
  - **Dedicated Link Note Header Button**: Located at the top right of the task detail panel (replacing the header star, while starring remains readily available in the main list). Clicking on an unlinked task automatically creates a dedicated markdown note under `TodoData/<ListName>/<TaskTitle>.md`, embeds bidirectional frontmatter linkage, and opens it in an Obsidian tab. Clicking on a linked task opens the note immediately; right-clicking provides options to open or unlink.
  - **Bidirectional Title Hot-Update & Collision Guard**: When a task's title is modified in Fluent Tasks, its linked note on disk is automatically renamed to match with illegal character sanitization; conversely, renaming the note in Obsidian immediately synchronizes the task title in real-time. Identical task titles are automatically disambiguated with `(1)`, `(2)` suffixes, preventing collisions and errors.
  - **Deletion Protection Modal**: Deleting any task with an active linked note prompts the user with an Obsidian modal: delete both the task and the note (trashed safely via `fileManager.trashFile`), or delete the task only while keeping the note intact.
  - **Custom Properties (`customMeta`)**: Key-value pairs displayed as interactive `🏷️` tag chips with hover popovers and delete buttons.
- **F2 Hover Rename & Context Menu**: Hovering over any task list or group in the left sidebar and pressing <kbd>F2</kbd> (or right-clicking -> `Rename List/Group (F2)`) opens an inline rename input. Press <kbd>Enter</kbd> or click outside to confirm; press <kbd>Esc</kbd> to cancel.
- **Floating Detail View Modal (`openDetailInModal`)**: Configurable in settings (`Open Task Details in Floating Modal`). When enabled, selecting or clicking any task opens the task details in a dedicated centered floating modal rather than expanding the right sidebar leaf. All automatic sidebar openings and tab-switch expansions are strictly suppressed. Fully supports two-tier modal stacking (e.g. clicking `+` inside the detail modal opens the Task Metadata modal on top with independent backdrop layering and `Esc` dismissal).
- **Quick Task Modal (`open-quick-task-modal`)**: A standalone, maximized (`92vw × 86vh`) dual-pane floating popup for lightning-fast task management. Features full keyboard navigation (<kbd>↑↓</kbd> move, <kbd>←→</kbd> switch pane, <kbd>Space</kbd> toggle check, <kbd>Ctrl+N</kbd> inline add, <kbd>Ctrl+Enter</kbd> star), drag-and-drop reordering, and hover popover previews. Configurable in settings to either manage tasks directly in-modal or navigate and reveal them in the workspace.
- **Quick List Modal (`open-quick-list-modal`)**: A dedicated list-only floating navigator rendered at pure 100% full screen (`100vw × 100vh`) edge-to-edge canvas with zero outer margins or distracting window chrome.
  - **Horizontal Slider & Vertical Wrap**: Cards stack vertically from top to bottom with a generous 16px row gap. When cards reach the vertical viewport boundary, they automatically wrap into the next column to the right. Smooth mouse-wheel scrolling naturally pans the board horizontally.
  - **Dynamic Remaining Space Detection & Centering**: When total column width fits within the viewport, the board automatically centers horizontally (`align-content: center`).
  - **Boundary Gap Expansion**: Dynamically expands the distance between columns (`column-gap = surplus / (numCols - 1)`) up to screen boundary padding (32px), gracefully filling the canvas like a dashboard chart. On ultra-wide monitors, gaps are tastefully capped (240px).
  - **Adaptive Card Sizing & Generous Vertical Spacing**: Cards size adaptively to content width (`170px–310px`) with 12px typography and internal item padding. Board vertical padding (16px 28px) cleanly isolates cards from the search bar and bottom action footer.
  - **Overflow Safety**: When columns exceed screen width, the board seamlessly switches to `flex-start` with 14px compact gap and enables horizontal scrolling without clipping.
  - **Flicker-Free Layout**: Column grouping is computed via vertical `offsetTop` topology, completely decoupled from horizontal transition coordinates, ensuring zero flicker during open or resize.
  - **Single Top-Right Close Button**: Native Obsidian modal close button is cleanly suppressed; a single integrated `[✕ Close]` button resides in the top filter bar next to the `[Grid / List]` toggle.
  - **Keyboard & Physics Navigation**: Features full 2D geometric navigation (<kbd>↑↓←→</kbd> move across lists and columns, <kbd>Enter</kbd> open in center, <kbd>F2</kbd> inline rename, <kbd>Esc</kbd> close), Chinese IME composition shield, and lossless typing redirection from anywhere into the search input. Selecting a list opens it in the center workspace and suppresses sidebar auto-expansion.
- **Z-Jump to List Commands**: Every list automatically registers a `Fluent Tasks: Z-Jump to list: [Name]` command with UTF-8 safe IDs and real-time live synchronization on create/rename/delete, sorted neatly at the bottom of Obsidian's Hotkeys settings. Jumping via hotkey focuses the center task view and auto-focuses the "Add a task" input while strictly keeping the left sidebar collapsed without unexpected popups.
- **Features & Shortcuts Guide**: Accessible anytime via the `?` icon in the pane header action bar (next to `⋮`) or through the full Shortcuts Guide Modal.
- **Instant Dismiss**: Right-clicking anywhere or left-clicking outside instantly dismisses active hover popovers and lightbox modals.

### Invariant: Zero Empty Placeholders
Badges render conditionally between the task title and the star button. If a task has no metadata, zero badge elements or placeholders are rendered in the DOM.
</metadata_badges_system>

## Microsoft To Do Bidirectional Sync

<external_sync_integration>
Fluent Tasks supports bidirectional synchronization with Microsoft To Do through the companion bridge plugin `A1MSTodoSync` (`a1-ms-todo-sync`).

### Architecture: Zero-Coupling Bridge
- **No runtime dependency**: `A1MSTodoSync` is an independent personal plugin that reads/writes `TodoData/*.md` using the same `%%{...}%%` format. `fluent-tasks` detects changes via existing vault file event listeners.
- **Sync metadata fields**: `TaskItem` carries optional `dueDate?`, `msGraphId?`, `msGraphListId?` fields. These are transparent to the UI — they only exist in `%%{...}%%` JSON and are preserved during serialization.

### Data Safety Policy
- **Direct TodoData Writing**: Unlike the previous `microsoft-todo-link` approach (which used a separate `MicrosoftTodoTasks.md`), `A1MSTodoSync` writes directly to `TodoData/*.md` using the exact `MarkdownParser` format. This eliminates the need for a separate bridge file.
- **Conflict Resolution**: Last-Writer-Wins by timestamp comparison (local `file.stat.mtime` vs cloud `lastModifiedDateTime`).
- **First-Sync Merge**: Cloud tasks are appended to local files without overwriting existing tasks.
- **Sync State Tracking**: Per-task MD5 hashes and cloud timestamps stored in `TodoData/.sync-state.json`.

### Key Constraints
- MUST NOT modify `MarkdownParser` serialization format without updating `A1MSTodoSync.MarkdownBridge` in lockstep. (Why: format divergence causes silent data corruption).
- Optional sync fields (`dueDate`, `msGraphId`, `msGraphListId`, `why`, `svgs`, `note_link`, `customMeta`) MUST remain backward-compatible — NEVER make them required. (Why: existing users without sync must not be affected).
</external_sync_integration>


