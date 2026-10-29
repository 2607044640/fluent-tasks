import { Modal, App } from "obsidian";
import TaskDetailView from "../TaskDetailView.svelte";
import { ImagePreviewModal } from "./ImagePreviewModal";
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
    private beforeUnloadHandler: () => void;

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
        this.beforeUnloadHandler = () => {
            if (this.component) {
                void this.component.flushSaveSync();
            }
        };
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("task-detail-floating-modal");
        contentEl.addClass("task-detail-modal-content");

        window.addEventListener("beforeunload", this.beforeUnloadHandler);

        const isFullscreen = this.plugin?.settings?.fullscreenDetailModal ?? true;
        if (isFullscreen) {
            modalEl.addClass("is-fullscreen");
            this.containerEl.addClass("has-fullscreen-detail-modal");
        }

        const isCenterAligned = this.plugin?.settings?.centerAlignTasks ?? true;
        if (isCenterAligned) {
            modalEl.addClass("is-center-aligned");
            this.containerEl.addClass("is-center-aligned");
        }

        EventBus.on(EventName.DETAIL_CLOSE, this.detailCloseHandler);

        this.component = new TaskDetailView({
            target: contentEl,
            props: {
                dataService: this.dataService,
                plugin: this.plugin,
                isModal: true,
                isFullscreen: isFullscreen,
                centerAlignTasks: isCenterAligned,
                onCloseModal: () => this.forceClose(),
                onToggleFullscreen: (fullscreen: boolean) => {
                    modalEl.toggleClass("is-fullscreen", fullscreen);
                    this.containerEl.toggleClass("has-fullscreen-detail-modal", fullscreen);
                },
            },
        });

        if (this.initialTask && this.initialCategoryFilepath) {
            this.component.loadTask(this.initialTask, this.initialCategoryFilepath);
        }
    }

    public setFullscreen(fullscreen: boolean) {
        this.modalEl.toggleClass("is-fullscreen", fullscreen);
        this.containerEl.toggleClass("has-fullscreen-detail-modal", fullscreen);
        if (this.component) {
            this.component.$set({ isFullscreen: fullscreen });
        }
    }

    public setCenterAligned(centerAligned: boolean) {
        this.modalEl.toggleClass("is-center-aligned", centerAligned);
        this.containerEl.toggleClass("is-center-aligned", centerAligned);
        if (this.component) {
            this.component.$set({ centerAlignTasks: centerAligned });
        }
    }

    loadTask(task: TaskItem, categoryFilepath: string) {
        if (this.component) {
            this.component.loadTask(task, categoryFilepath);
        }
    }

    hasActiveChildDialog(): boolean {
        return !!(
            ImagePreviewModal.isImagePreviewActive() ||
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
        if (this.component) {
            void this.component.flushSaveSync();
        }
        super.close();
    }

    forceClose() {
        if (this.component) {
            void this.component.flushSaveSync();
        }
        super.close();
    }

    onClose() {
        window.removeEventListener("beforeunload", this.beforeUnloadHandler);
        EventBus.off(EventName.DETAIL_CLOSE, this.detailCloseHandler);
        this.containerEl.removeClass("has-fullscreen-detail-modal");
        if (this.component) {
            void this.component.flushSaveSync();
            this.component.$destroy();
            this.component = null;
        }
        if (this.plugin.activeDetailModal === this) {
            this.plugin.activeDetailModal = null;
        }
    }
}
