# Fluent Tasks - Architecture & Developer Guide

<context>
This document defines the core architecture, state flow, invariants, and API contracts for AI agents and human developers contributing to Fluent Tasks ("vibe coding"). For public usage and user installation, refer to: [README.md](file:///C:/ObsidianPublish/fluent-tasks/README.md).
</context>

## Architectural Overview

Fluent Tasks follows a decoupled Three-Panel View architecture using Svelte 4 for presentational UI, an EventBus for cross-view communication, and an Atomic I/O Pipeline for vault state persistence.

```
+-----------------------------------------------------------------------------------+
|                              Obsidian Workspace                                   |
|                                                                                   |
|  +-------------------------+  +-----------------------+  +---------------------+  |
|  | TaskSidebarViewWrapper  |  |  TaskMainViewWrapper  |  | TaskDetailViewWrapper|  |
|  |  (VIEW_TYPE_SIDEBAR)    |  |   (VIEW_TYPE_MAIN)    |  |  (VIEW_TYPE_DETAIL) |  |
|  |  [Mounted Svelte View]  |  | [Mounted Svelte View] |  | [Mounted Svelte View|  |
|  +------------+------------+  +-----------+-----------+  +----------+----------+  |
+---------------|---------------------------|-------------------------|-------------+
                |                           |                         |
                +------------------- EventBus (Pub/Sub) --------------+
                                            |
                                            v
                                   DataService Facade
                                   /                \
                       CategoryService            TaskService
                                   \                /
                                  AtomicIOPipeline
                                         |
                                         v
                         Obsidian Vault API & Disk Storage
```

<data_flow>
Data movement across views and persistent storage follows a strict 7-step sequence:

1. **User Interaction**: User triggers an action in a Svelte view (e.g. checks a task, reorders a list, edits a note).
2. **Optimistic UI Update**: Svelte component updates local state synchronously for zero-latency rendering.
3. **Facade Delegation**: Svelte component invokes `DataService` facade methods (`updateTask`, `moveTask`, `saveSidebarState`).
4. **Atomic Pipeline Execution**: `AtomicIOPipeline.processFile` executes `app.vault.process` for task files or `app.vault.adapter` for `.metadata.json`.
5. **Serialization**: `MarkdownParser` parses or serializes Markdown text containing embedded `%%{...}%%` JSON comments.
6. **Disk Commitment**: Obsidian Vault API commits changes atomically to local `.md` files under `TodoData/`.
7. **Event Broadcast**: `EventBus.emit` dispatches typed events (`EventName`) to notify all active views to stay synchronized.
</data_flow>

## Component Scope & Ownership

<scope_boundaries>
| Component | Primary Responsibility | MUST NOT Contain |
| :--- | :--- | :--- |
| `src/main.ts` | Plugin lifecycle, registering ItemViews, commands, settings tab | Direct DOM manipulations, raw vault I/O |
| `src/EventBus.ts` | Typed pub/sub event bus for cross-view reactivity | State storage, direct vault I/O |
| `src/DataService.ts` | Facade unifying CategoryService and TaskService | Direct Svelte UI rendering logic |
| `src/services/AtomicIOPipeline.ts` | Race-condition-safe vault file I/O via `app.vault.process` | Task parsing or UI business logic |
| `src/services/CategoryService.ts` | Sidebar group and category metadata management | Direct task item parsing |
| `src/services/TaskService.ts` | Task CRUD, deduplication, auto-healing, cross-file moves | Direct DOM or view state rendering |
| `src/MarkdownParser.ts` | Pure functional Markdown ↔ `TaskItem[]` parser & serializer | Vault API calls, side-effects, mutable state |
| `src/settings.ts` | `FluentTasksSettingTab` UI & settings serialization | Core task list I/O logic |
| `src/TaskSidebarView.svelte` | Presentational sidebar tree, drag-and-drop groups/categories | Direct `app.vault` file mutation |
| `src/TaskMainView.svelte` | Presentational center task list, completion toggles, DND reorder | Raw file system reads |
| `src/TaskDetailView.svelte` | Presentational right task detail panel (notes, subtask steps) | Direct file parsing logic |
</scope_boundaries>

## System Invariants & Rules

<key_invariants>
- **Synchronous Settings Tab Registration**: MUST call `this.addSettingTab(new FluentTasksSettingTab(...))` synchronously in `onload()` before awaiting any async setup. (Why: prevents monkey-patched settings managers like 'settings-in-tab' from failing to intercept the gear icon).
- **No Leaf Detaching in `onunload()`**: NEVER call `app.workspace.detachLeavesOfType()` inside `onunload()`. (Why: resets user's custom layout positions on plugin reload).
- **Dotfile Storage Adapter**: MUST use `app.vault.adapter.read` and `write` for `.metadata.json`. (Why: Obsidian's `Vault` API ignores files starting with a dot).
- **File Deletion API**: MUST use `app.fileManager.trashFile(file)` instead of `app.vault.trash(file)`. (Why: respects user's configured trash preferences).
- **Static CSS Styling**: NEVER inject dynamic `<style>` DOM tags at runtime. Use `document.body.setCssProps()` for dynamic theme variables. (Why: strictly required by Obsidian Community Store automated checks).
- **Type-Safe Folder Inspection**: MUST use `if (!(folder instanceof TFolder))` runtime checks instead of `(folder as TFolder)` casting. (Why: prevents runtime type assertion errors).
- **Pure Markdown Data Storage**: Tasks MUST be stored as standard checklists `- [ ] Title %%{"id":...}%%`. (Why: preserves complete user data ownership in open Markdown format).
- **Global Drag State Cleanup (CRITICAL)**: MUST unconditionally clear `(window as any).__mstodo_drag_data = null` on ANY global `pointerup` event, regardless of drop validity. (Why: prevents phantom drag states from teleporting items on subsequent clicks).
- **Microsoft To Do Sync Boundary & Isolation**: External synchronization with Microsoft To Do (via `microsoft-todo-link`) MUST write strictly to `MicrosoftTodoTasks.md`. `TodoData/*.md` files MUST NOT be directly modified by unvetted third-party sync processes without serialization through `MarkdownParser` and `AtomicIOPipeline`. (Why: guarantees schema integrity and prevents JSON metadata corruption).
- **Sync Safety Thresholds**: Central sync operations MUST maintain `MAX_REMOTE_DELETIONS_PER_SYNC = 10` and `EMPTY_FILE_DELETION_SAFETY_THRESHOLD = 3` with `deletionBehavior: "complete"`. (Why: prevents catastrophic data loss from accidental cloud-side deletions or empty-file sync triggers).
- **Sidebar Expansion Protocol**: Automatic sidebar expansion on view focus MUST verify `leftSplit.collapsed` prior to `expand()` and check `getLeavesOfType(VIEW_TYPE_SIDEBAR).length > 0` before invoking `workspace.revealLeaf()`. (Why: prevents runtime crashes or layout disruptions if the sidebar leaf is closed or not yet initialized).
</key_invariants>

## Key API Reference

<api_reference>
| Class / Module | Method | Signature | Side-Effects |
| :--- | :--- | :--- | :--- |
| `DataService` | `getSidebarItems` | `Promise<SidebarItem[]>` | Reads `DATA_FOLDER` files and `.metadata.json` |
| `DataService` | `saveSidebarState` | `(items: SidebarItem[]) => Promise<void>` | Writes to `.metadata.json` via adapter |
| `DataService` | `createCategory` | `(name: string) => Promise<CategoryInfo>` | Creates new `.md` file in `TodoData/` |
| `DataService` | `deleteCategory` | `(filepath: string) => Promise<void>` | Trashes `.md` file via `trashFile` |
| `DataService` | `getTasks` | `(filepath: string) => Promise<TaskItem[]>` | Reads file, deduplicates IDs |
| `DataService` | `addTask` | `(filepath: string, title: string) => Promise<TaskItem>` | Atomically appends task via `processFile` |
| `DataService` | `updateTask` | `(filepath: string, updated: TaskItem) => Promise<void>` | Atomically mutates task line |
| `DataService` | `moveTask` | `(task: TaskItem, src: string, dst: string) => Promise<void>` | Removes from src, appends to dst |
| `AtomicIOPipeline` | `processFile` | `(filepath: string, mutator: (data: string) => string) => Promise<void>` | Atomically updates file via `app.vault.process` |
| `MarkdownParser` | `parseTasksFromMarkdown` | `(content: string) => TaskItem[]` | Pure query, zero side-effects |
| `MarkdownParser` | `serializeTasksToMarkdown` | `(tasks: TaskItem[]) => string` | Pure query, zero side-effects |
| `FluentTasksPlugin` | `expandSidebarToList` | `() => void` | Expands `leftSplit` and reveals `VIEW_TYPE_SIDEBAR` leaf |
</api_reference>

## Development Recipes for Contributors

<adding_new_command_recipe>
To add a new command accessible via the Obsidian Command Palette (`Ctrl+P`):

1. Open `src/main.ts`.
2. Inside `onload()`, add a command registration block:
```typescript
this.addCommand({
    id: "my-command-id", // Do NOT prefix with plugin ID; Obsidian handles scoping
    name: "My Command Display Name", // Do NOT include "Fluent Tasks:" in the name
    callback: () => {
        void this.myCommandImplementation();
    },
});
```
</adding_new_command_recipe>

<adding_new_event_recipe>
To add a new cross-view event:

1. Open `src/types.ts` and append the event string to `EventName` enum:
```typescript
export enum EventName {
    // ...
    MY_NEW_EVENT = "my:new-event",
}
```
2. Define the payload interface in `src/types.ts` if payload is required.
3. Emit from emitting component: `EventBus.emit(EventName.MY_NEW_EVENT, payload);`.
4. Listen in target component / view wrapper:
```typescript
EventBus.on(EventName.MY_NEW_EVENT, (payload) => {
    // Handle reaction
});
```
</adding_new_event_recipe>

<adding_new_setting_recipe>
To add a new configurable setting:

1. Open `src/settings.ts`.
2. Add the key and type to `FluentTasksSettings` interface and default value to `DEFAULT_SETTINGS`:
```typescript
export interface FluentTasksSettings {
    accentColor: string;
    myNewSetting: boolean;
}
export const DEFAULT_SETTINGS: FluentTasksSettings = {
    accentColor: "#0078d4",
    myNewSetting: true,
};
```
3. Add a setting control inside `FluentTasksSettingTab.display()`:
```typescript
new Setting(containerEl)
    .setName("My New Setting")
    .setDesc("Description of what this setting controls.")
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.myNewSetting)
        .onChange(async (value) => {
            this.plugin.settings.myNewSetting = value;
            await this.plugin.saveSettings();
        }));
```
</adding_new_setting_recipe>

## Troubleshooting & Common Edge Cases

<troubleshooting>
- **Zombie CSS Cache**: After editing `src/styles.css` or building CSS, verify that `styles.css` in the plugin root matches `main.css` in size. (Obsidian only loads `styles.css` from the plugin root).
- **Dotfile Metadata Missing**: If categories or sidebar order fail to persist, ensure `CategoryService` uses `this.app.vault.adapter.read/write` on `TodoData/.metadata.json` instead of standard Vault API calls.
- **Floating Promise Warnings**: Always wrap unawaited async callbacks in command handlers or EventBus listeners with `void (async () => { ... })()` or `void fn()`.
- **Phantom Drag Teleportation**: If items spontaneously move lists after normal clicks, verify that `__mstodo_drag_data` is being unconditionally cleared on all `pointerup` escape paths in the Drag & Drop orchestration handlers.
</troubleshooting>
