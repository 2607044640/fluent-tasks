import { Modal, App } from "obsidian";
import FocusedListsModalView from "./FocusedListsModalView.svelte";
import { DataService } from "../DataService";
import type FluentTasksPlugin from "../main";

export class FocusedListsModal extends Modal {
    private component: FocusedListsModalView | null = null;
    private plugin: FluentTasksPlugin;
    private dataService: DataService;

    constructor(app: App, plugin: FluentTasksPlugin, dataService: DataService) {
        super(app);
        this.plugin = plugin;
        this.dataService = dataService;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("task-quick-modal");
        modalEl.addClass("task-focused-lists-modal");

        // Remove native Obsidian modal close button
        if ((this as any).closeButtonEl) {
            (this as any).closeButtonEl.remove();
        }
        modalEl.querySelectorAll(".modal-close-button").forEach(el => el.remove());

        this.component = new FocusedListsModalView({
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
