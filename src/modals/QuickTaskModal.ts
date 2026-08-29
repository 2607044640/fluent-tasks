import { Modal, App } from "obsidian";
import QuickTaskModalView from "./QuickTaskModalView.svelte";
import { DataService } from "../DataService";
import type FluentTasksPlugin from "../main";

const MAX_TIP_COUNT = 5;

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

        // 1. Detect if the user has already bound a hotkey for this command
        const commandId = "fluent-tasks:open-quick-task-modal";
        interface AppWithHotkeys extends App {
            hotkeyManager?: { customKeys?: Record<string, string[]> };
        }
        const customHotkeys = (this.app as unknown as AppWithHotkeys).hotkeyManager?.customKeys?.[commandId];
        const hotkeyAlreadySet = !!(customHotkeys && customHotkeys.length > 0);

        // If hotkey is set, never show the tip (and don't increment counter)
        const currentCount = this.plugin.settings.quickModalTipCount ?? 0;
        const showTip = !hotkeyAlreadySet && currentCount < MAX_TIP_COUNT;
        const remainingTips = MAX_TIP_COUNT - currentCount;

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

        // Only increment the counter if the tip banner was actually shown
        if (showTip) {
            this.plugin.settings.quickModalTipCount = currentCount + 1;
            void this.plugin.saveSettings();
        }
    }

    onClose() {
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }
}
