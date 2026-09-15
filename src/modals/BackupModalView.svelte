<script lang="ts">
    import { onMount } from "svelte";
    import { App, Notice } from "obsidian";
    import type { DataService } from "../DataService";
    import { BackupService, type BackupFileInfo } from "../services/BackupService";
    import { t } from "../lang/helpers";

    export let app: App;
    export let plugin: any;
    export let dataService: DataService;
    export let closeModal: () => void = () => {};

    let dailyBackup: boolean = plugin?.settings?.dailyBackupEnabled ?? true;
    let backups: BackupFileInfo[] = [];
    let isLoading: boolean = true;
    let isBackingUp: boolean = false;
    let fileInputEl: HTMLInputElement;

    onMount(async () => {
        await refreshBackups();
    });

    async function refreshBackups() {
        isLoading = true;
        try {
            backups = await BackupService.getBackups(app);
        } catch (e) {
            console.error("[BackupModalView] Failed to load backups:", e);
        } finally {
            isLoading = false;
        }
    }

    async function handleToggleDailyBackup() {
        dailyBackup = !dailyBackup;
        if (plugin?.settings) {
            plugin.settings.dailyBackupEnabled = dailyBackup;
            await plugin.saveSettings();
            new Notice(dailyBackup ? t("daily_backup_enabled") : t("daily_backup_disabled"));
        }
    }

    async function handleBackupNow() {
        if (isBackingUp) return;
        isBackingUp = true;
        try {
            const res = await BackupService.createBackup(app, plugin, false);
            new Notice(t("data_saved_to", res.filepath));
            await refreshBackups();
        } catch (e: any) {
            new Notice(t("backup_failed", e?.message || e));
        } finally {
            isBackingUp = false;
        }
    }

    async function handleImportClick() {
        const res = await BackupService.pickAndImportBackupFile(app, plugin);
        if (res.handled) {
            if (res.success) {
                await refreshBackups();
                closeModal();
            }
            return;
        }
        // Fallback for non-desktop web/mobile
        triggerImportFile();
    }

    function triggerImportFile() {
        fileInputEl?.click();
    }

    async function handleFileSelected(e: Event) {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            const text = ev.target?.result as string;
            if (!text) return;
            const ok = await BackupService.applyBackupPayload(app, plugin, text);
            if (ok) {
                await refreshBackups();
                closeModal();
            }
        };
        reader.readAsText(file);
        // Reset input
        input.value = "";
    }

    async function handleRestore(b: BackupFileInfo) {
        if (confirm(t("confirm_restore_backup", b.createdAtFormatted))) {
            const ok = await BackupService.restoreBackup(app, plugin, b.filepath);
            if (ok) {
                closeModal();
            }
        }
    }

    async function handleDelete(b: BackupFileInfo) {
        if (confirm(t("confirm_delete_backup", b.filename))) {
            await BackupService.deleteBackup(app, b.filepath);
            await refreshBackups();
        }
    }

    async function handleDeleteAll() {
        if (backups.length === 0) return;
        if (confirm(t("confirm_delete_all_backups", backups.length))) {
            const count = await BackupService.deleteAllBackups(app);
            new Notice(t("all_backups_deleted", count));
            await refreshBackups();
        }
    }

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
</script>

<div class="backup-modal-container">
    <!-- Header -->
    <div class="backup-modal-header">
        <div class="backup-header-title-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"></polyline>
                <rect x="1" y="3" width="22" height="5"></rect>
                <line x1="10" y1="12" x2="14" y2="12"></line>
            </svg>
            <h2>{t("backup_modal_title")}</h2>
        </div>
        <button class="backup-close-btn" on:click={closeModal} aria-label={t("cancel")}>✕</button>
    </div>

    <!-- Actions & Settings Card -->
    <div class="backup-card">
        <div class="backup-row">
            <div class="backup-toggle-label">
                <input 
                    type="checkbox" 
                    id="daily-backup-checkbox" 
                    checked={dailyBackup} 
                    on:change={handleToggleDailyBackup}
                />
                <label for="daily-backup-checkbox">
                    <b>{t("daily_backup_title")}</b>
                    <span>{t("daily_backup_desc")}</span>
                </label>
            </div>
            <div class="backup-action-btns">
                <button class="backup-btn backup-primary-btn" on:click={handleBackupNow} disabled={isBackingUp}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                    </svg>
                    <span>{isBackingUp ? t("backing_up") : t("backup_now")}</span>
                </button>
                <button class="backup-btn backup-secondary-btn" on:click={handleImportClick}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span>{t("import_backup")}</span>
                </button>
                <input 
                    type="file" 
                    accept=".json" 
                    style="display: none;" 
                    bind:this={fileInputEl} 
                    on:change={handleFileSelected}
                />
            </div>
        </div>
    </div>

    <!-- Backups History Section -->
    <div class="backup-list-header">
        <div class="backup-header-left">
            <h3>{t("backup_history_title", backups.length)}</h3>
            <button class="backup-link-btn" on:click={() => BackupService.openBackupFolderInOS(app)} title={t("open_backup_folder_tooltip")}>
                📂 {t("open_backup_folder")}
            </button>
        </div>
        <div class="backup-header-right">
            <button 
                class="backup-danger-btn" 
                on:click={handleDeleteAll} 
                disabled={backups.length === 0}
                title={backups.length === 0 ? t("no_backups_to_delete") : t("delete_all_backups_tooltip")}
            >
                🗑️ {t("delete_all_backups")}
            </button>
            <button class="backup-refresh-btn" on:click={refreshBackups} title={t("refresh_list")}>🔄</button>
        </div>
    </div>

    <div class="backup-list-scrollable">
        {#if isLoading}
            <div class="backup-empty-state">{t("loading_backups")}</div>
        {:else if backups.length === 0}
            <div class="backup-empty-state">
                <p>{t("no_local_backups")}</p>
                <span>{t("no_local_backups_hint")}</span>
            </div>
        {:else}
            {#each backups as b (b.filepath)}
                <div class="backup-item-row" class:is-daily={b.isDaily}>
                    <div class="backup-item-info">
                        <div class="backup-item-title-wrap">
                            <span class="backup-badge" class:is-daily={b.isDaily}>
                                {b.isDaily ? t("daily_backup_badge") : t("manual_backup_badge")}
                            </span>
                            <span class="backup-time">{b.createdAtFormatted}</span>
                        </div>
                        <div class="backup-meta-desc">
                            <span>{t("task_count_label", b.taskCount)}</span>
                            <span class="backup-dot">·</span>
                            <span>{t("list_count_label", b.listsCount)}</span>
                            <span class="backup-dot">·</span>
                            <span>{formatBytes(b.sizeBytes)}</span>
                        </div>
                    </div>
                    <div class="backup-item-actions">
                        <button class="backup-action-btn restore-btn" on:click={() => handleRestore(b)} title={t("restore_snapshot_tooltip")}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                <polyline points="3 3 3 8 8 8"></polyline>
                            </svg>
                            <span>{t("restore")}</span>
                        </button>
                        <button class="backup-action-btn delete-btn" on:click={() => handleDelete(b)} title={t("delete_backup_tooltip")}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            {/each}
        {/if}
    </div>
</div>
