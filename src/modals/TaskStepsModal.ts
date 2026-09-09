import { Modal, App } from "obsidian";
import TaskStepsModalView from "./TaskStepsModalView.svelte";
import type { DataService } from "../DataService";
import type FluentTasksPlugin from "../main";
import type { TaskItem } from "../types";

export class TaskStepsModal extends Modal {
    private component: TaskStepsModalView | null = null;
    private plugin: FluentTasksPlugin;
    private dataService: DataService;
    private task: TaskItem;
    private categoryFilepath: string;

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
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("task-steps-floating-modal");
        contentEl.addClass("task-steps-modal-content");

        this.component = new TaskStepsModalView({
            target: contentEl,
            props: {
                plugin: this.plugin,
                dataService: this.dataService,
                task: this.task,
                categoryFilepath: this.categoryFilepath,
                closeModal: () => this.close(),
            },
        });
    }

    onClose() {
        if (this.component) {
            this.component.flushSaveSync();
            this.component.$destroy();
            this.component = null;
        }
    }
}
