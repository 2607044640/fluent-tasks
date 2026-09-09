import { Modal, App } from "obsidian";
import QuickListModalView from "./QuickListModalView.svelte";
import { DataService } from "../DataService";
import { getModalHotkeyTipInfo, recordHotkeyTipShown } from "../utils/hotkeyUtils";
import type FluentTasksPlugin from "../main";

export class QuickListModal extends Modal {
    private component: QuickListModalView | null = null;
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
        modalEl.addClass("task-quick-list-modal");

        // Remove native Obsidian modal close button
        if ((this as any).closeButtonEl) {
            (this as any).closeButtonEl.remove();
        }
        modalEl.querySelectorAll(".modal-close-button").forEach(el => el.remove());

        const { showTip, remainingTips } = getModalHotkeyTipInfo(
            this.app,
            this.plugin,
            "fluent-tasks:open-quick-list-modal"
        );

        this.component = new QuickListModalView({
            target: contentEl,
            props: {
                app: this.app,
                plugin: this.plugin,
                dataService: this.dataService,
                showTip,
                remainingTips,
                closeModal: () => this.close(),
                modalEl,
            },
        });

        if (showTip) {
            recordHotkeyTipShown(this.plugin);
        }
    }

    onClose() {
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }
}
