import { App, Modal, TFile } from "obsidian";
import type { TaskItem } from "../types";
import { EventName } from "../types";
import { EventBus } from "../EventBus";
import type { DataService } from "../DataService";
import { LinkedNoteService } from "../services/LinkedNoteService";

export class ConfirmDeleteLinkedNoteModal extends Modal {
    private noteFile: TFile;
    private task: TaskItem;
    private onDecision: (deleteNote: boolean | null) => void;
    private hasDecided = false;

    constructor(
        app: App,
        task: TaskItem,
        noteFile: TFile,
        onDecision: (deleteNote: boolean | null) => void
    ) {
        super(app);
        this.task = task;
        this.noteFile = noteFile;
        this.onDecision = onDecision;
    }

    private decide(choice: boolean | null) {
        if (this.hasDecided) return;
        this.hasDecided = true;
        this.onDecision(choice);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("fluent-tasks-delete-modal");

        const heading = contentEl.createEl("h3", { text: `是否删除链接笔记（title：${this.task.title}）？` });
        heading.style.marginTop = "0";
        heading.style.marginBottom = "12px";

        const p1 = contentEl.createEl("p");
        p1.style.marginBottom = "8px";
        p1.createSpan({ text: "待删除的任务绑定了专属笔记：" });
        const noteBadge = p1.createEl("strong", { text: ` ${this.noteFile.basename} ` });
        noteBadge.style.color = "var(--todo-accent, #8b5cf6)";

        const p2 = contentEl.createEl("p", {
            text: "您可以选择仅删除任务本身，或同时将该链接笔记移入回收站。",
        });
        p2.style.color = "var(--text-muted)";
        p2.style.fontSize = "0.9em";
        p2.style.marginBottom = "24px";

        const btnContainer = contentEl.createDiv();
        btnContainer.style.display = "flex";
        btnContainer.style.justifyContent = "flex-end";
        btnContainer.style.gap = "10px";
        btnContainer.style.flexWrap = "wrap";

        // Cancel
        const cancelBtn = btnContainer.createEl("button", { text: "取消" });
        cancelBtn.addEventListener("click", () => {
            this.decide(null);
            this.close();
        });

        // Task only
        const taskOnlyBtn = btnContainer.createEl("button", { text: "仅删除任务（保留笔记）" });
        taskOnlyBtn.addEventListener("click", () => {
            this.decide(false);
            this.close();
        });

        // Both task and note
        const bothBtn = btnContainer.createEl("button", {
            text: "删除任务与链接笔记",
            cls: "mod-warning",
        });
        bothBtn.addEventListener("click", () => {
            this.decide(true);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
        // Fallback: If closed via Esc or clicking modal backdrop, resolve cancellation cleanly
        this.decide(null);
    }
}

/**
 * Prompt user before deleting a task if it has a linked note.
 * If no linked note exists on disk, deletes task immediately without modal.
 */
export async function promptDeleteTaskWithLinkedNote(
    app: App,
    task: TaskItem,
    categoryFilepath: string,
    dataService: DataService,
    onDeleted?: () => void | Promise<void>
): Promise<boolean> {
    const noteFile = LinkedNoteService.resolveLinkedNoteFile(app, task.note_link, categoryFilepath);

    if (!noteFile) {
        // No linked physical note file exists on disk, delete task directly
        await dataService.deleteTask(categoryFilepath, task);
        EventBus.emit(EventName.TASK_DELETED, { task, categoryFilepath });
        if (onDeleted) await onDeleted();
        return true;
    }

    return new Promise<boolean>((resolve) => {
        const modal = new ConfirmDeleteLinkedNoteModal(app, task, noteFile, async (deleteNote) => {
            if (deleteNote === null) {
                // User cancelled deletion
                resolve(false);
                return;
            }

            if (deleteNote) {
                try {
                    await app.fileManager.trashFile(noteFile);
                } catch (err) {
                    console.error("Failed to trash linked note:", err);
                }
            }

            await dataService.deleteTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_DELETED, { task, categoryFilepath });
            if (onDeleted) await onDeleted();
            resolve(true);
        });
        modal.open();
    });
}
