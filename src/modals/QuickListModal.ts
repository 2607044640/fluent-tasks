import { Modal, App } from "obsidian";
import QuickListModalView from "./QuickListModalView.svelte";
import { DataService } from "../DataService";
import type FluentTasksPlugin from "../main";

const MAX_TIP_COUNT = 5;

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

        // Detect if the user has already bound a hotkey for this command
        const commandId = "fluent-tasks:open-quick-list-modal";
        interface AppWithHotkeys extends App {
            hotkeyManager?: { customKeys?: Record<string, string[]> };
        }
        const customHotkeys = (this.app as unknown as AppWithHotkeys).hotkeyManager?.customKeys?.[commandId];
        const hotkeyAlreadySet = !!(customHotkeys && customHotkeys.length > 0);

        const currentCount = this.plugin.settings.quickModalTipCount ?? 0;
        const showTip = !hotkeyAlreadySet && currentCount < MAX_TIP_COUNT;
        const remainingTips = MAX_TIP_COUNT - currentCount;

        this.component = new QuickListModalView({
            target: contentEl,
            props: {
                app: this.app,
                dataService: this.dataService,
                showTip,
                remainingTips,
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
