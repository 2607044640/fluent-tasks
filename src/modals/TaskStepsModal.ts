import { Modal, App } from "obsidian";
import TaskStepsModalView from "./TaskStepsModalView.svelte";
import { ImagePreviewModal } from "./ImagePreviewModal";
import type { DataService } from "../DataService";
import type FluentTasksPlugin from "../main";
import type { TaskItem } from "../types";

export class TaskStepsModal extends Modal {
    private component: TaskStepsModalView | null = null;
    private plugin: FluentTasksPlugin;
    private dataService: DataService;
    private task: TaskItem;
    private categoryFilepath: string;
    private beforeUnloadHandler: () => void;

    constructor(
        app: App,
        plugin: FluentTasksPlugin,
        dataService: DataService,
        task: TaskItem,
        categoryFilepath: string
    ) {
        super(app);
        this.plugin = plugin;
        this.dataService = dataService;
        this.task = task;
        this.categoryFilepath = categoryFilepath;
        this.beforeUnloadHandler = () => {
            if (this.component) {
                this.component.flushSaveSync();
            }
        };
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("task-steps-floating-modal");
        if (this.plugin?.settings?.centerAlignTasks ?? true) {
            modalEl.addClass("is-center-aligned");
            this.containerEl.addClass("is-center-aligned");
        }
        contentEl.addClass("task-steps-modal-content");

        window.addEventListener("beforeunload", this.beforeUnloadHandler);

        this.component = new TaskStepsModalView({
            target: contentEl,
            props: {
                app: this.app,
                plugin: this.plugin,
                dataService: this.dataService,
                task: this.task,
                categoryFilepath: this.categoryFilepath,
                closeModal: () => this.close(),
                centerAlignTasks: this.plugin?.settings?.centerAlignTasks ?? true,
                showStepsProgressPill: this.plugin?.settings?.showStepsProgressPill ?? false,
            },
        });
    }

    close() {
        if (ImagePreviewModal.isImagePreviewActive()) {
            return;
        }
        if (this.component) {
            this.component.flushSaveSync();
        }
        super.close();
    }

    onClose() {
        window.removeEventListener("beforeunload", this.beforeUnloadHandler);
        if (this.component) {
            this.component.flushSaveSync();
            this.component.$destroy();
            this.component = null;
        }
    }
}
