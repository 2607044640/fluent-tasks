import { App, TFile, TFolder, Notice } from "obsidian";
import { DATA_FOLDER, EventName } from "../types";
import { EventBus } from "../EventBus";

export interface BackupFileInfo {
    filename: string;
    filepath: string;
    createdAt: string;
    createdAtFormatted: string;
    sizeBytes: number;
    taskCount: number;
    listsCount: number;
    isDaily: boolean;
}

export interface BackupDataPayload {
    version: string;
    createdAt: string;
    taskCount: number;
    listsCount: number;
    isDaily: boolean;
    files: Record<string, string>;
    settings?: any;
}

export class BackupService {
    public static readonly BACKUP_FOLDER = `${DATA_FOLDER}/.backups`;

    public static async ensureBackupFolder(app: App): Promise<void> {
        // Ensure TodoData folder first
        const dataFolder = app.vault.getAbstractFileByPath(DATA_FOLDER);
        if (!dataFolder) {
            await app.vault.createFolder(DATA_FOLDER);
        }
        const backupFolder = app.vault.getAbstractFileByPath(this.BACKUP_FOLDER);
        if (!backupFolder) {
            await app.vault.createFolder(this.BACKUP_FOLDER);
        }
    }

    public static async createBackup(app: App, plugin?: any, isDaily: boolean = false): Promise<BackupFileInfo> {
        await this.ensureBackupFolder(app);

        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, "0");
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const createdAtFormatted = `${dateStr} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const filename = isDaily 
            ? `daily-backup-${dateStr}.json` 
            : `backup-${dateStr}_${timeStr}.json`;
        const targetPath = `${this.BACKUP_FOLDER}/${filename}`;

        // Collect all TodoData files except .backups and debug.log
        const filesToBackup: Record<string, string> = {};
        let totalTaskCount = 0;
        let listCount = 0;

        const todoFolder = app.vault.getAbstractFileByPath(DATA_FOLDER);
        if (todoFolder && todoFolder instanceof TFolder) {
            for (const child of todoFolder.children) {
                if (child.name.startsWith(".backups") || child.name === "debug.log") {
                    continue;
                }
                if (child instanceof TFile) {
                    const content = await app.vault.read(child);
                    filesToBackup[child.path] = content;
                    if (child.extension === "md") {
                        listCount++;
                        // Count task markers
                        const matches = content.match(/^[ \t]*- \[[ xX]\]/gm);
                        if (matches) {
                            totalTaskCount += matches.length;
                        }
                    }
                }
            }
        }

        const payload: BackupDataPayload = {
            version: "1.0",
            createdAt: now.toISOString(),
            taskCount: totalTaskCount,
            listsCount: listCount,
            isDaily,
            files: filesToBackup,
            settings: plugin?.settings ? JSON.parse(JSON.stringify(plugin.settings)) : undefined
        };

        const jsonStr = JSON.stringify(payload, null, 2);

        const existing = app.vault.getAbstractFileByPath(targetPath);
        if (existing && existing instanceof TFile) {
            await app.vault.modify(existing, jsonStr);
        } else {
            await app.vault.create(targetPath, jsonStr);
        }

        return {
            filename,
            filepath: targetPath,
            createdAt: now.toISOString(),
            createdAtFormatted,
            sizeBytes: new Blob([jsonStr]).size,
            taskCount: totalTaskCount,
            listsCount: listCount,
            isDaily
        };
    }

    public static async getBackups(app: App): Promise<BackupFileInfo[]> {
        await this.ensureBackupFolder(app);
        const folder = app.vault.getAbstractFileByPath(this.BACKUP_FOLDER);
        if (!folder || !(folder instanceof TFolder)) {
            return [];
        }

        const list: BackupFileInfo[] = [];
        const pad = (n: number) => n.toString().padStart(2, "0");

        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === "json") {
                try {
                    const content = await app.vault.read(child);
                    const parsed: BackupDataPayload = JSON.parse(content);
                    const d = parsed.createdAt ? new Date(parsed.createdAt) : new Date(child.stat.mtime);
                    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                    const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

                    list.push({
                        filename: child.name,
                        filepath: child.path,
                        createdAt: parsed.createdAt || d.toISOString(),
                        createdAtFormatted: `${dateStr} ${timeStr}`,
                        sizeBytes: child.stat.size,
                        taskCount: parsed.taskCount ?? 0,
                        listsCount: parsed.listsCount ?? 0,
                        isDaily: parsed.isDaily ?? child.name.startsWith("daily-")
                    });
                } catch {
                    // Ignore corrupted backup files
                }
            }
        }

        // Sort latest first
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return list;
    }

    public static async restoreBackup(app: App, plugin: any, backupPath: string): Promise<boolean> {
        const file = app.vault.getAbstractFileByPath(backupPath);
        if (!file || !(file instanceof TFile)) {
            new Notice("未找到指定的备份文件");
            return false;
        }

        const raw = await app.vault.read(file);
        return this.applyBackupPayload(app, plugin, raw);
    }

    public static async applyBackupPayload(app: App, plugin: any, rawJson: string): Promise<boolean> {
        try {
            const payload: BackupDataPayload = JSON.parse(rawJson);
            if (!payload || typeof payload !== "object" || !payload.files) {
                new Notice("❌ 备份文件格式无效：缺少 files 数据项");
                return false;
            }

            // Restore all files
            for (const [relPath, content] of Object.entries(payload.files)) {
                // Ensure target folder exists
                const lastSlash = relPath.lastIndexOf("/");
                if (lastSlash > 0) {
                    const folderPath = relPath.slice(0, lastSlash);
                    const folder = app.vault.getAbstractFileByPath(folderPath);
                    if (!folder) {
                        await app.vault.createFolder(folderPath);
                    }
                }

                const existing = app.vault.getAbstractFileByPath(relPath);
                if (existing && existing instanceof TFile) {
                    await app.vault.modify(existing, content);
                } else {
                    await app.vault.create(relPath, content);
                }
            }

            new Notice(`✅ 成功还原备份：共恢复 ${Object.keys(payload.files).length} 个文件，包含 ${payload.taskCount ?? 0} 项任务`);
            EventBus.emit(EventName.CATEGORY_LIST_CHANGED, {});
            return true;
        } catch (e) {
            console.error("[BackupService] Restore failed:", e);
            new Notice(`❌ 还原失败: ${e}`);
            return false;
        }
    }

    public static async deleteBackup(app: App, backupPath: string): Promise<void> {
        const file = app.vault.getAbstractFileByPath(backupPath);
        if (file && file instanceof TFile) {
            await app.vault.delete(file);
            new Notice("🗑️ 备份已删除");
        }
    }

    public static async checkAndRunDailyBackup(app: App, plugin: any): Promise<void> {
        if (!plugin?.settings?.dailyBackupEnabled) {
            return;
        }

        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, "0");
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

        if (plugin.settings.lastDailyBackupDate === todayStr) {
            return;
        }

        try {
            await this.createBackup(app, plugin, true);
            plugin.settings.lastDailyBackupDate = todayStr;
            await plugin.saveSettings();
            console.log(`[BackupService] Completed daily automatic backup for ${todayStr}`);
        } catch (e) {
            console.error("[BackupService] Daily backup failed:", e);
        }
    }
}
