import { App, TFile } from "obsidian";
import { Logger } from "../Logger";
import { DATA_FOLDER } from "../types";

export class AtomicIOPipeline {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /** Ensure the TodoData root folder exists */
    async ensureDataFolder(): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(DATA_FOLDER);
        if (!folder) {
            await this.app.vault.createFolder(DATA_FOLDER);
            Logger.log("Created data folder:", DATA_FOLDER);
        }
    }

    /** Atomically process a file to prevent race conditions */
    async processFile(filepath: string, mutator: (data: string) => string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (!file || !(file instanceof TFile)) {
            Logger.log("ERROR: Cannot process, file not found:", filepath);
            return;
        }
        // app.vault.process safely reads the latest data and applies the mutation
        await this.app.vault.process(file, mutator);
    }

    /** Wrapper for standard file read */
    async readFile(filepath: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (!file || !(file instanceof TFile)) return "";
        return await this.app.vault.adapter.read(filepath);
    }
}
