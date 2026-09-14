<script lang="ts">
    import { onMount } from "svelte";
    import { App, Notice } from "obsidian";
    import type { DataService } from "../DataService";
    import { BackupService, type BackupFileInfo } from "../services/BackupService";

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
            new Notice(dailyBackup ? "✅ 已开启每日自动备份" : "⚠️ 已关闭每日自动备份");
        }
    }

    async function handleBackupNow() {
        if (isBackingUp) return;
        isBackingUp = true;
        try {
            const res = await BackupService.createBackup(app, plugin, false);
            new Notice(`✅ 备份创建成功：${res.filename} (含 ${res.taskCount} 项任务)`);
            await refreshBackups();
        } catch (e) {
            new Notice(`❌ 备份失败: ${e}`);
        } finally {
            isBackingUp = false;
        }
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
        if (confirm(`确认还原备份「${b.createdAtFormatted}」？\n此操作将用备份中的数据恢复所有任务列表。`)) {
            const ok = await BackupService.restoreBackup(app, plugin, b.filepath);
            if (ok) {
                closeModal();
            }
        }
    }

    async function handleDelete(b: BackupFileInfo) {
        if (confirm(`确认删除备份「${b.filename}」？`)) {
            await BackupService.deleteBackup(app, b.filepath);
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
            <h2>任务数据备份器</h2>
        </div>
        <button class="backup-close-btn" on:click={closeModal} aria-label="关闭">✕</button>
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
                    <b>每日自动备份</b>
                    <span>每天首次打开时自动在本地生成快照</span>
                </label>
            </div>
            <div class="backup-action-btns">
                <button class="backup-btn backup-primary-btn" on:click={handleBackupNow} disabled={isBackingUp}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                    </svg>
                    <span>{isBackingUp ? "备份中..." : "现在备份"}</span>
                </button>
                <button class="backup-btn backup-secondary-btn" on:click={triggerImportFile}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    <span>导入备份</span>
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
        <h3>历史备份记录 ({backups.length})</h3>
        <button class="backup-refresh-btn" on:click={refreshBackups} title="刷新列表">🔄</button>
    </div>

    <div class="backup-list-scrollable">
        {#if isLoading}
            <div class="backup-empty-state">正在读取备份记录...</div>
        {:else if backups.length === 0}
            <div class="backup-empty-state">
                <p>📦 暂无本地备份文件</p>
                <span>点击上方「现在备份」即可创建第一个完整数据快照</span>
            </div>
        {:else}
            {#each backups as b (b.filepath)}
                <div class="backup-item-row" class:is-daily={b.isDaily}>
                    <div class="backup-item-info">
                        <div class="backup-item-title-wrap">
                            <span class="backup-badge" class:is-daily={b.isDaily}>
                                {b.isDaily ? "每日备份" : "手动备份"}
                            </span>
                            <span class="backup-time">{b.createdAtFormatted}</span>
                        </div>
                        <div class="backup-meta-desc">
                            <span>{b.taskCount} 项任务</span>
                            <span class="backup-dot">·</span>
                            <span>{b.listsCount} 个列表</span>
                            <span class="backup-dot">·</span>
                            <span>{formatBytes(b.sizeBytes)}</span>
                        </div>
                    </div>
                    <div class="backup-item-actions">
                        <button class="backup-action-btn restore-btn" on:click={() => handleRestore(b)} title="还原此快照">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                <polyline points="3 3 3 8 8 8"></polyline>
                            </svg>
                            <span>还原</span>
                        </button>
                        <button class="backup-action-btn delete-btn" on:click={() => handleDelete(b)} title="删除备份">
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
