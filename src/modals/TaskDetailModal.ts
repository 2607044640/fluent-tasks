import { Modal, App } from "obsidian";
import TaskDetailView from "../TaskDetailView.svelte";
import type { DataService } from "../DataService";
import type FluentTasksPlugin from "../main";
import type { TaskItem } from "../types";
import { EventBus } from "../EventBus";
import { EventName } from "../types";

export class TaskDetailModal extends Modal {
    private component: TaskDetailView | null = null;
    private plugin: FluentTasksPlugin;
    private dataService: DataService;
    private initialTask?: TaskItem;
    private initialCategoryFilepath?: string;
    private detailCloseHandler: () => void;

    constructor(
        app: App,
        plugin: FluentTasksPlugin,
        dataService: DataService,
        task?: TaskItem,
        categoryFilepath?: string
    ) {
        super(app);
        this.plugin = plugin;
        this.dataService = dataService;
        this.initialTask = task;
        this.initialCategoryFilepath = categoryFilepath;
        this.detailCloseHandler = () => {
            this.forceClose();
        };
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("task-detail-floating-modal");
        contentEl.addClass("task-detail-modal-content");

        EventBus.on(EventName.DETAIL_CLOSE, this.detailCloseHandler);

        this.component = new TaskDetailView({
            target: contentEl,
            props: {
                dataService: this.dataService,
                plugin: this.plugin,
                isModal: true,
                onCloseModal: () => this.forceClose(),
            },
        });

        if (this.initialTask && this.initialCategoryFilepath) {
            this.component.loadTask(this.initialTask, this.initialCategoryFilepath);
        }
    }

    loadTask(task: TaskItem, categoryFilepath: string) {
        if (this.component) {
            this.component.loadTask(task, categoryFilepath);
        }
    }

    hasActiveChildDialog(): boolean {
        return !!(
            this.contentEl?.querySelector(".meta-modal-backdrop") ||
            this.modalEl?.querySelector(".meta-modal-backdrop") ||
            this.containerEl?.querySelector(".meta-modal-backdrop") ||
            this.contentEl?.querySelector(".svg-confirm-backdrop") ||
            this.modalEl?.querySelector(".svg-confirm-backdrop") ||
            this.contentEl?.querySelector(".repeat-picker-panel") ||
            document.querySelector(".meta-modal-backdrop") ||
            document.querySelector(".svg-confirm-backdrop") ||
            document.querySelector(".task-img-preview-modal-shell")
        );
    }

    close() {
        // When a nested child dialog (e.g. Task Metadata, SVG confirm, or repeat picker) is active,
        // intercept and ignore the outer modal's close request (such as Obsidian's Escape hotkey).
        if (this.hasActiveChildDialog()) {
            return;
        }
        super.close();
    }

    forceClose() {
        super.close();
    }

    onClose() {
        EventBus.off(EventName.DETAIL_CLOSE, this.detailCloseHandler);
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
        if (this.plugin.activeDetailModal === this) {
            this.plugin.activeDetailModal = null;
        }
    }
}
