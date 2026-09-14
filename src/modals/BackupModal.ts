import { Modal, App } from "obsidian";
import BackupModalView from "./BackupModalView.svelte";
import type { DataService } from "../DataService";
import type FluentTasksPlugin from "../main";

export class BackupModal extends Modal {
    private component: BackupModalView | null = null;
    private plugin: FluentTasksPlugin;
    private dataService: DataService;

    constructor(
        app: App,
        plugin: FluentTasksPlugin,
        dataService: DataService
    ) {
        super(app);
        this.plugin = plugin;
        this.dataService = dataService;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("task-backup-floating-modal");
        contentEl.addClass("task-backup-modal-content");

        this.component = new BackupModalView({
            target: contentEl,
            props: {
                app: this.app,
                plugin: this.plugin,
                dataService: this.dataService,
                closeModal: () => this.close(),
            },
        });
    }

    onClose() {
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }
}
