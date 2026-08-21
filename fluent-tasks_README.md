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

## Metadata Badges & Cognitive Steering

<metadata_badges_system>
Fluent Tasks uses a lightweight Meta Badge system to keep task cards clean while surfacing rich human-agent instructions and metadata on demand:

### Badge Types & Behaviors
- **Why Rationale (`why`)**: Displayed as a `?` circle badge. Hovering pops up a rationale card explaining why the task/rule exists.
- **Visual Icons (`svgs`)**: Array of custom inline SVG icons displayed as individual mini badges. Hovering reveals a 64px preview.
- **Linked Note (`note_link`)**: Displayed as a document link badge. Hovering triggers Obsidian's native `Page Preview` popover; clicking immediately navigates to and focuses the note.
- **Custom Properties (`customMeta`)**: Key-value pairs displayed as interactive tag chips in the task detail panel.

### Invariant: Zero Empty Placeholders
Badges render conditionally between the task title and the star button. If a task has no metadata, zero badge elements or placeholders are rendered in the DOM.
</metadata_badges_system>

## Microsoft To Do Bidirectional Sync

<external_sync_integration>
Fluent Tasks supports bidirectional synchronization with Microsoft To Do through the companion bridge plugin `A1MSTodoSync` (`a1-ms-todo-sync`). For full setup and configuration, refer to: [`A1MSTodoSync_README.md`](file:///c:/ObsidianDev/plugins/A1MSTodoSync/A1MSTodoSync_README.md).

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


