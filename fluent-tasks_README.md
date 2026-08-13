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



## Microsoft To Do External Sync & Safety

<external_sync_integration>
Fluent Tasks supports interoperability with Microsoft To Do through the companion sync plugin `obsidian-MicrosoftToDoLink` (`microsoft-todo-link`).

### Data Isolation Policy
- **Strict Storage Separation**: Fluent Tasks tasks reside exclusively in `TodoData/*.md`. Microsoft To Do sync outputs exclusively to the central sync file `MicrosoftTodoTasks.md`.
- **Zero Accidental Overwrite**: Sync operations on `MicrosoftTodoTasks.md` do NOT touch or overwrite existing `TodoData/*.md` categories.

### Key Operational Constraints & Precautions
- **Enforce Central Sync Mode**: MUST configure `microsoft-todo-link` to use Central Sync Mode (`MicrosoftTodoTasks.md`). NEVER bind individual `TodoData/*.md` files directly without an atomic bridge parser. (Why: prevents corruption of `%%{...}%%` embedded JSON metadata).
- **Safe Deletion Policy**: `deletionBehavior` MUST remain set to `"complete"` (default). Remote tasks are marked completed rather than permanently deleted.
- **Safety Thresholds**:
  - `MAX_REMOTE_DELETIONS_PER_SYNC = 10`: Limits remote batch deletions.
  - `EMPTY_FILE_DELETION_SAFETY_THRESHOLD = 3`: Prevents clearing cloud tasks if local files are emptied unexpectedly.
</external_sync_integration>

