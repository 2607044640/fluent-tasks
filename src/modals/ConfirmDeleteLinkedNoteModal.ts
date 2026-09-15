import { App, Modal, TFile } from "obsidian";
import type { TaskItem } from "../types";
import { EventName } from "../types";
import { EventBus } from "../EventBus";
import type { DataService } from "../DataService";
import { LinkedNoteService } from "../services/LinkedNoteService";
import { t } from "../lang/helpers";

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

        const heading = contentEl.createEl("h3", {
            text: t("confirm_delete_linked_note_title", this.task.title),
            cls: "fluent-tasks-delete-modal-heading",
        });

        const p1 = contentEl.createEl("p", { cls: "fluent-tasks-delete-modal-p1" });
        p1.createSpan({ text: t("confirm_delete_linked_note_p1") });
        p1.createEl("strong", {
            text: ` ${this.noteFile.basename} `,
            cls: "fluent-tasks-delete-modal-badge",
        });

        contentEl.createEl("p", {
            text: t("confirm_delete_linked_note_p2"),
            cls: "fluent-tasks-delete-modal-p2",
        });

        const btnContainer = contentEl.createDiv({ cls: "fluent-tasks-delete-modal-buttons" });

        // Cancel
        const cancelBtn = btnContainer.createEl("button", { text: t("cancel") });
        cancelBtn.addEventListener("click", () => {
            this.decide(null);
            this.close();
        });

        // Task only
        const taskOnlyBtn = btnContainer.createEl("button", { text: t("delete_task_only_keep_note") });
        taskOnlyBtn.addEventListener("click", () => {
            this.decide(false);
            this.close();
        });

        // Both task and note
        const bothBtn = btnContainer.createEl("button", {
            text: t("delete_task_and_note"),
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
