import { App } from "obsidian";
import { DATA_FOLDER } from "./types";

/**
 * Logger utility that writes debug output to a file in the vault.
 * Usage: Logger.init(app); Logger.log("message");
 */
export class Logger {
    private static app: App;
    private static LOG_PATH = `${DATA_FOLDER}/debug.log`;

    static init(app: App): void {
        this.app = app;
    }

    static async log(...args: any[]): Promise<void> {
        if (!this.app) return;
        const timestamp = new Date().toISOString();
        const message = args.map(a =>
            typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)
        ).join(" ");
        const line = `[${timestamp}] ${message}\n`;

        try {
            const vault = this.app.vault;
            const file = vault.getAbstractFileByPath(this.LOG_PATH);
            if (file) {
                await vault.append(file as any, line);
            } else {
                // Ensure data folder exists
                const folder = vault.getAbstractFileByPath(DATA_FOLDER);
                if (!folder) {
                    await vault.createFolder(DATA_FOLDER);
                }
                await vault.create(this.LOG_PATH, line);
            }
        } catch (e) {
            console.error("[MStodo Logger]", e);
        }
    }

    static async clear(): Promise<void> {
        if (!this.app) return;
        try {
            const file = this.app.vault.getAbstractFileByPath(this.LOG_PATH);
            if (file) {
                await this.app.vault.modify(file as any, "");
            }
        } catch (e) {
            console.error("[MStodo Logger Clear]", e);
        }
    }
}
