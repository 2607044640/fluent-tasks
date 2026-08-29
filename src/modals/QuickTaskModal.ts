import { Modal, App } from "obsidian";
import QuickTaskModalView from "./QuickTaskModalView.svelte";
import { DataService } from "../DataService";
import { getModalHotkeyTipInfo, recordHotkeyTipShown } from "../utils/hotkeyUtils";
import type FluentTasksPlugin from "../main";

export class QuickTaskModal extends Modal {
    private component: QuickTaskModalView | null = null;
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

        const { showTip, remainingTips } = getModalHotkeyTipInfo(
            this.app,
            this.plugin,
            "fluent-tasks:open-quick-task-modal"
        );

        this.component = new QuickTaskModalView({
            target: contentEl,
            props: {
                plugin: this.plugin,
                dataService: this.dataService,
                showTip,
                remainingTips,
                closeModal: () => this.close(),
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
