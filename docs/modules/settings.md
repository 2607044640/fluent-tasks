# Settings and Configuration

Plugin settings are `FluentTasksSettings` stored by Obsidian `Plugin.saveData` / `loadData` (typically the plugin `data.json`). Not the task store (`TodoData/`).

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `FluentTasksSettings` + `DEFAULT_SETTINGS` (`src/settings.ts`) | Shape and defaults | Vault task files |
| `FluentTasksSettingTab.display` | Color picker, toggles, dropdown, Quick List gap sliders | View mounting, EventBus subscriptions |
| `FluentTasksPlugin.loadSettings` / `saveSettings` / `applySettings` | Merge defaults, persist, CSS vars, emit `SETTINGS_CHANGED` | Defining new keys without the interface |
| `quickModalTipCount` | Incremented by `recordHotkeyTipShown` (`src/utils/hotkeyUtils.ts`), not shown as a Setting control | User-facing tip copy (lives in Quick modals) |

## Key Invariants

1. `loadSettings` is `Object.assign({}, DEFAULT_SETTINGS, await loadData())`. Missing keys get defaults. (Why chosen over requiring a full `data.json`: upgrades add fields.)
2. Accent color is applied as CSS custom properties on `document.body`, not Svelte theme stores. (Why chosen over per-component props: one paint for all leaves.)
3. Turning **on** `openDetailInModal` calls `handleDetailModalModeEnabled` (detach detail leaves, collapse right split if it was showing plugin detail). Turning **off** closes `activeDetailModal` if any. (Why chosen over leaving both UIs open: two detail surfaces would diverge.)

## Numbered Data Flow

1. `onload` (sync) `addSettingTab` then `await loadSettings()`. Layout-ready loads again and `applySettings()`.
2. Each control `onChange` writes `plugin.settings.*`, `await saveSettings()` (`saveData` + `SETTINGS_CHANGED`).
3. Color picker also listens native `input` for live drag.
4. `hideRibbonIcon` change calls `refreshRibbonIcon()`.
5. `TaskMainView` listens `SETTINGS_CHANGED` to refresh `wrapTaskTitles`.
6. Quick List grid toggle in the tab updates `quickListGridLayout`; the modal also has `toggleLayoutMode` which writes the same key. Gap sliders write `quickListMinColGap` / `quickListMinRowGap` (read by `QuickListModalView` when packing the board).

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `FluentTasksPlugin.loadSettings` | `(): Promise<void>` | Reads plugin data; assigns `this.settings` |
| `FluentTasksPlugin.saveSettings` | `(): Promise<void>` | Writes plugin data; EventBus `SETTINGS_CHANGED` |
| `FluentTasksPlugin.applySettings` | `(): void` | `--todo-accent`, `--todo-accent-glow`, `--todo-accent-light` |
| `FluentTasksPlugin.refreshRibbonIcon` | `(): void` | Add/remove ribbon |
| `FluentTasksPlugin.handleDetailModalModeEnabled` | `(): void` | Detach `VIEW_TYPE_DETAIL`; maybe collapse right split |
| `FluentTasksSettingTab.display` | `(): void` | Rebuilds settings DOM |
| `getModalHotkeyTipInfo` | `(app, plugin, commandId): HotkeyTipInfo` | Reads `hotkeyManager.customKeys` and `quickModalTipCount` |
| `recordHotkeyTipShown` | `(plugin): void` | Increments `quickModalTipCount`; `saveSettings` |

## Recipes

1. **Change accent** — Settings → Accent Color → `saveSettings` + `applySettings`.
2. **Details as modal** — toggle “Open Task Details in Floating Modal”; enabling detaches the right pane.
3. **Hide ribbon** — toggle → `refreshRibbonIcon`.
4. **Quick List board** — “Quick List Modal: Grid Board Layout” or in-modal layout toggle (`toggleLayoutMode`). Gaps: “Min Column Gap” (10–64, step 2) and “Min Row Gap” (8–48, step 2).
5. **Hotkey tip cap** — Quick List/Task `onOpen` uses `getModalHotkeyTipInfo(..., "fluent-tasks:open-quick-list-modal" \| "...open-quick-task-modal")`; `MAX_TIP_COUNT = 5`; skipped if a custom hotkey already exists.

### Default values (`DEFAULT_SETTINGS`)

| Key | Default |
|---|---|
| `accentColor` | `"#8b5cf6"` |
| `openDetailInModal` | `false` |
| `autoExpandSidebar` | `true` |
| `autoCollapseSidebarOnSwitch` | `true` |
| `searchHideCompleted` | `true` |
| `hideRibbonIcon` | `false` |
| `wrapTaskTitles` | `true` |
| `quickModalAction` | `'direct'` |
| `quickModalTipCount` | `0` |
| `quickListGridLayout` | `true` |
| `quickListMinColGap` | `20` |
| `quickListMinRowGap` | `16` |

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
