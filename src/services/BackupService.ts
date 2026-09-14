import { App, Notice, FileSystemAdapter, normalizePath } from "obsidian";
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
    // Visible folder in vault without leading dot so Obsidian vault adapter can index and access it without error
    public static readonly BACKUP_FOLDER = `${DATA_FOLDER}/Backups`;
    public static readonly LEGACY_BACKUP_FOLDER = `${DATA_FOLDER}/.backups`;

    public static async ensureBackupFolder(app: App): Promise<void> {
        // Ensure TodoData folder exists
        if (!(await app.vault.adapter.exists(DATA_FOLDER))) {
            try {
                await app.vault.adapter.mkdir(DATA_FOLDER);
            } catch (e: any) {
                if (!e?.message?.includes("already exists")) throw e;
            }
        }
        // Ensure TodoData/Backups folder exists
        if (!(await app.vault.adapter.exists(this.BACKUP_FOLDER))) {
            try {
                await app.vault.adapter.mkdir(this.BACKUP_FOLDER);
            } catch (e: any) {
                if (!e?.message?.includes("already exists")) throw e;
            }
        }
    }

    public static getAbsoluteBackupFolderPath(app: App): string {
        if (app.vault.adapter instanceof FileSystemAdapter) {
            const base = app.vault.adapter.getBasePath();
            const rel = normalizePath(this.BACKUP_FOLDER);
            try {
                const path = (window as any).require ? (window as any).require("path") : null;
                if (path && path.resolve) {
                    return path.resolve(base, rel);
                }
            } catch {}
            return `${base}/${rel}`.replace(/\//g, "\\");
        }
        return this.BACKUP_FOLDER;
    }

    public static async openBackupFolderInOS(app: App): Promise<void> {
        await this.ensureBackupFolder(app);
        const absPath = this.getAbsoluteBackupFolderPath(app);
        try {
            const electron = (window as any).require ? (window as any).require("electron") : null;
            if (electron?.shell?.openPath) {
                await electron.shell.openPath(absPath);
                return;
            }
        } catch (e) {
            console.warn("[BackupService] Failed to open folder in OS:", e);
        }
        new Notice(`备份目录: ${this.BACKUP_FOLDER}`);
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

        // Collect all TodoData markdown and json files (excluding Backups, .backups, debug.log)
        const filesToBackup: Record<string, string> = {};
        let totalTaskCount = 0;
        let listCount = 0;

        try {
            const listing = await app.vault.adapter.list(DATA_FOLDER);
            for (const filePath of listing.files) {
                const normPath = normalizePath(filePath);
                const fname = normPath.split("/").pop() || "";
                if (fname === "debug.log" || normPath.includes("/Backups/") || normPath.includes("/.backups/")) {
                    continue;
                }
                if (fname.endsWith(".md") || fname.endsWith(".json")) {
                    const content = await app.vault.adapter.read(normPath);
                    filesToBackup[normPath] = content;
                    if (fname.endsWith(".md")) {
                        listCount++;
                        const matches = content.match(/^[ \t]*- \[[ xX]\]/gm);
                        if (matches) {
                            totalTaskCount += matches.length;
                        }
                    }
                }
            }
        } catch (e) {
            console.error("[BackupService] Error collecting files for backup:", e);
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
        await app.vault.adapter.write(targetPath, jsonStr);

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

        const foldersToCheck = [this.BACKUP_FOLDER, this.LEGACY_BACKUP_FOLDER];
        const allFilePaths: string[] = [];

        for (const folder of foldersToCheck) {
            try {
                if (await app.vault.adapter.exists(folder)) {
                    const listing = await app.vault.adapter.list(folder);
                    for (const f of listing.files) {
                        if (f.endsWith(".json")) {
                            allFilePaths.push(f);
                        }
                    }
                }
            } catch (e) {
                console.warn(`[BackupService] Scan ${folder} failed:`, e);
            }
        }

        const list: BackupFileInfo[] = [];
        const pad = (n: number) => n.toString().padStart(2, "0");

        for (const filePath of allFilePaths) {
            try {
                const normPath = normalizePath(filePath);
                const content = await app.vault.adapter.read(normPath);
                const stat = await app.vault.adapter.stat(normPath);
                const parsed: BackupDataPayload = JSON.parse(content);
                const filename = normPath.split("/").pop() || normPath;
                const d = parsed.createdAt ? new Date(parsed.createdAt) : new Date(stat?.mtime || Date.now());
                const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

                list.push({
                    filename,
                    filepath: normPath,
                    createdAt: parsed.createdAt || d.toISOString(),
                    createdAtFormatted: `${dateStr} ${timeStr}`,
                    sizeBytes: stat?.size || new Blob([content]).size,
                    taskCount: parsed.taskCount ?? 0,
                    listsCount: parsed.listsCount ?? 0,
                    isDaily: parsed.isDaily ?? filename.startsWith("daily-")
                });
            } catch {
                // Ignore corrupted backup files
            }
        }

        // Sort newest first
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return list;
    }

    public static async restoreBackup(app: App, plugin: any, backupPath: string): Promise<boolean> {
        const normPath = normalizePath(backupPath);
        if (!(await app.vault.adapter.exists(normPath))) {
            new Notice("未找到指定的备份文件");
            return false;
        }

        const raw = await app.vault.adapter.read(normPath);
        return this.applyBackupPayload(app, plugin, raw);
    }

    public static async applyBackupPayload(app: App, plugin: any, rawJson: string): Promise<boolean> {
        try {
            const payload: BackupDataPayload = JSON.parse(rawJson);
            if (!payload || typeof payload !== "object" || !payload.files) {
                new Notice("❌ 备份文件格式无效：缺少 files 数据项");
                return false;
            }

            // Restore all files to disk
            for (const [relPath, content] of Object.entries(payload.files)) {
                const normalized = normalizePath(relPath);
                const lastSlash = normalized.lastIndexOf("/");
                if (lastSlash > 0) {
                    const folderPath = normalized.slice(0, lastSlash);
                    if (!(await app.vault.adapter.exists(folderPath))) {
                        await app.vault.adapter.mkdir(folderPath);
                    }
                }

                await app.vault.adapter.write(normalized, content);
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
        const normPath = normalizePath(backupPath);
        if (await app.vault.adapter.exists(normPath)) {
            await app.vault.adapter.remove(normPath);
            new Notice("🗑️ 备份已删除");
        }
    }

    public static async pickAndImportBackupFile(app: App, plugin: any): Promise<{ success: boolean; handled: boolean }> {
        try {
            await this.ensureBackupFolder(app);
            const electron = (window as any).require ? (window as any).require("electron") : null;
            const remote = electron?.remote || ((window as any).require ? (window as any).require("@electron/remote") : null);
            const dialog = remote?.dialog || electron?.dialog;

            if (dialog && typeof dialog.showOpenDialog === "function") {
                const defaultFolder = this.getAbsoluteBackupFolderPath(app);
                const res = await dialog.showOpenDialog({
                    title: "选择要导入的备份文件",
                    defaultPath: defaultFolder,
                    filters: [{ name: "Fluent Tasks 备份文件 (*.json)", extensions: ["json"] }],
                    properties: ["openFile"]
                });

                if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
                    return { success: false, handled: true };
                }

                const chosenPath = res.filePaths[0];
                const fs = (window as any).require("fs");
                const raw = fs.readFileSync(chosenPath, "utf-8");
                const ok = await this.applyBackupPayload(app, plugin, raw);
                return { success: ok, handled: true };
            }
        } catch (e) {
            console.warn("[BackupService] Native file picker dialog:", e);
        }
        return { success: false, handled: false };
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
