# Backup Service

Provides automated daily vault backups, manual snapshot generation, JSON archive export/import, and one-click restoration for all Fluent Tasks lists and metadata.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `BackupService` (`src/services/BackupService.ts`) | Backup directory creation (`TodoData/Backups`), daily snapshots, backup packing/unpacking, list enumeration, restore execution | Svelte UI modals, direct task parsing |
| `BackupModal` / `BackupModalView.svelte` (`src/modals/BackupModal*`) | Backup manager dialog, table list, create/restore/delete/export/import button interactions | Direct disk I/O |

## Key Invariants

1. Visible directory structure: Backups reside in `TodoData/Backups/` (without leading dots). (Why chosen over hidden dot-folders: Obsidian Vault API and file system adapters index visible folders cleanly across mobile and desktop without permission collisions.)
2. Consolidated JSON archives: Each snapshot bundles all `TodoData/*.md` list files, `.metadata.json`, and current plugin settings into a single timestamped JSON payload (`fluent-tasks-backup-YYYY-MM-DD-HH-mm-ss.json`). (Why chosen over raw directory copy: enables seamless single-file export and import across different devices/vaults.)
3. Automated daily snapshot debounce: `checkDailyBackup()` compares `plugin.settings.lastDailyBackupDate` against local `YYYY-MM-DD`. If already executed today, it avoids redundant disk churn.

## Numbered Data Flow

1. Startup verification: `main.ts` calls `BackupService.checkDailyBackup(this.app, this)` during layout initialization.
2. Snapshot creation: `BackupService.createBackup()` scans `TodoData/` for `.md` files and `.metadata.json`, serializes file contents into `BackupDataPayload`, and writes to `TodoData/Backups/`.
3. Restoration: When the user restores a backup via `BackupModal`, `restoreBackup()` restores each `.md` file, updates `.metadata.json`, and emits `CATEGORY_LIST_CHANGED` and `TASK_UPDATED` to refresh active panels.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `ensureBackupFolder` | `(app: App): Promise<void>` | Creates `TodoData/Backups` if missing |
| `listBackups` | `(app: App): Promise<BackupFileInfo[]>` | Reads backup folder and extracts header metadata |
| `createBackup` | `(app: App, isDaily?: boolean): Promise<string>` | Writes backup JSON file to `TodoData/Backups/` |
| `restoreBackup` | `(app: App, filepath: string): Promise<boolean>` | Overwrites `TodoData/*.md` and `.metadata.json`; emits EventBus refresh |
| `deleteBackup` | `(app: App, filepath: string): Promise<boolean>` | Deletes snapshot JSON file |
| `deleteAllBackups` | `(app: App): Promise<number>` | Empties backup folder |
| `checkDailyBackup` | `(app: App, plugin: any): Promise<boolean>` | Creates daily snapshot if not yet run today |

## Recipes

1. **Open Backup Manager** — Command `fluent-tasks:open-backup-modal` or header options menu item `Backup manager`.
2. **Restore previous snapshot** — In Backup Manager modal, click `Restore` next to target date → confirms and reloads active lists.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
