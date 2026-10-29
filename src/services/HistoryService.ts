import { App, Notice } from "obsidian";
import type { DataService } from "../DataService";
import type FluentTasksPlugin from "../main";
import { TaskItem, EventName, TrashedImageBackup } from "../types";
import { EventBus } from "../EventBus";
import { getTaskWeight } from "../utils/taskUtils";
import type HistoryToastContainer from "../components/HistoryToastContainer.svelte";

export type HistoryActionType = "task_update" | "task_create" | "task_delete" | "task_move";

export interface TaskUpdateAction {
    type: "task_update";
    taskId: string;
    categoryFilepath: string;
    beforeTask: TaskItem;
    afterTask: TaskItem;
    field: "weight" | "why" | "title" | "note" | "steps" | "completed" | "starred" | "schedule" | "general";
    descriptionUndo: string;
    descriptionRedo: string;
    timestamp: number;
}

export interface TaskCreateAction {
    type: "task_create";
    taskId: string;
    categoryFilepath: string;
    task: TaskItem;
    descriptionUndo: string;
    descriptionRedo: string;
    timestamp: number;
}

export interface TaskDeleteAction {
    type: "task_delete";
    taskId: string;
    categoryFilepath: string;
    task: TaskItem;
    index?: number;
    trashedImages?: TrashedImageBackup[];
    descriptionUndo: string;
    descriptionRedo: string;
    timestamp: number;
}

export interface TaskMoveAction {
    type: "task_move";
    taskId: string;
    sourceFilepath: string;
    targetFilepath: string;
    task: TaskItem;
    descriptionUndo: string;
    descriptionRedo: string;
    timestamp: number;
}

export type HistoryAction = TaskUpdateAction | TaskCreateAction | TaskDeleteAction | TaskMoveAction;

function deepCloneTask(task: TaskItem): TaskItem {
    return JSON.parse(JSON.stringify(task)) as TaskItem;
}

function truncateText(str: string, maxLen: number): string {
    const clean = str.replace(/\s+/g, " ").trim();
    return clean.length > maxLen ? clean.slice(0, maxLen) + "..." : clean;
}

export class HistoryService {
    private app: App;
    private dataService: DataService;
    private plugin: FluentTasksPlugin;
    private undoStack: HistoryAction[] = [];
    private redoStack: HistoryAction[] = [];
    private toastComponent: HistoryToastContainer | null = null;
    public isUndoingOrRedoing: boolean = false;

    private static readonly MAX_STACK_SIZE = 60;
    private static readonly MERGE_WINDOW_MS = 2500;

    constructor(app: App, dataService: DataService, plugin: FluentTasksPlugin) {
        this.app = app;
        this.dataService = dataService;
        this.plugin = plugin;
    }

    public setToastComponent(toastComp: HistoryToastContainer | null): void {
        this.toastComponent = toastComp;
    }

    private detectField(before: TaskItem, after: TaskItem): TaskUpdateAction["field"] {
        if ((before.weight ?? 0) !== (after.weight ?? 0)) {
            return "weight";
        }
        const beforeWhys = before.whys && before.whys.length > 0 ? before.whys : (before.why ? [before.why] : []);
        const afterWhys = after.whys && after.whys.length > 0 ? after.whys : (after.why ? [after.why] : []);
        if (JSON.stringify(beforeWhys) !== JSON.stringify(afterWhys)) {
            return "why";
        }
        if (before.title !== after.title) {
            return "title";
        }
        if ((before.completed ?? false) !== (after.completed ?? false)) {
            return "completed";
        }
        if ((before.starred ?? false) !== (after.starred ?? false)) {
            return "starred";
        }
        if ((before.note ?? "") !== (after.note ?? "")) {
            return "note";
        }
        if (JSON.stringify(before.steps || []) !== JSON.stringify(after.steps || [])) {
            return "steps";
        }
        if (before.dueDate !== after.dueDate || JSON.stringify(before.recurrence) !== JSON.stringify(after.recurrence)) {
            return "schedule";
        }
        return "general";
    }

    private generateDescriptions(
        before: TaskItem,
        after: TaskItem,
        field: TaskUpdateAction["field"]
    ): { undo: string; redo: string } {
        const titleSnippet = truncateText(after.title || before.title || "Untitled", 26);
        const oldTitleSnippet = truncateText(before.title || "Untitled", 26);

        switch (field) {
            case "weight": {
                const oldW = getTaskWeight(before);
                const newW = getTaskWeight(after);
                return {
                    undo: `Reverted weight: ${newW} → ${oldW} on "${titleSnippet}"`,
                    redo: `Restored weight: ${oldW} → ${newW} on "${titleSnippet}"`,
                };
            }
            case "why": {
                const afterWhys = after.whys && after.whys.length > 0 ? after.whys : (after.why ? [after.why] : []);
                const beforeWhys = before.whys && before.whys.length > 0 ? before.whys : (before.why ? [before.why] : []);
                if (afterWhys.length > beforeWhys.length) {
                    const addedWhy = truncateText(afterWhys[afterWhys.length - 1], 24);
                    return {
                        undo: `Removed why "${addedWhy}" on "${titleSnippet}"`,
                        redo: `Restored why "${addedWhy}" on "${titleSnippet}"`,
                    };
                } else if (afterWhys.length < beforeWhys.length) {
                    return {
                        undo: `Restored removed why rationale on "${titleSnippet}"`,
                        redo: `Removed why rationale on "${titleSnippet}"`,
                    };
                }
                return {
                    undo: `Reverted why rationale on "${titleSnippet}"`,
                    redo: `Restored why rationale on "${titleSnippet}"`,
                };
            }
            case "title": {
                return {
                    undo: `Reverted title to "${oldTitleSnippet}"`,
                    redo: `Restored title to "${titleSnippet}"`,
                };
            }
            case "completed": {
                const isNowComp = after.completed ?? false;
                return {
                    undo: isNowComp ? `Marked "${titleSnippet}" as incomplete` : `Marked "${titleSnippet}" as completed`,
                    redo: isNowComp ? `Marked "${titleSnippet}" as completed` : `Marked "${titleSnippet}" as incomplete`,
                };
            }
            case "starred": {
                const isNowStar = after.starred ?? false;
                return {
                    undo: isNowStar ? `Unstarred "${titleSnippet}"` : `Starred "${titleSnippet}"`,
                    redo: isNowStar ? `Starred "${titleSnippet}"` : `Unstarred "${titleSnippet}"`,
                };
            }
            case "note": {
                return {
                    undo: `Reverted note on "${titleSnippet}"`,
                    redo: `Restored note on "${titleSnippet}"`,
                };
            }
            case "steps": {
                const beforeSteps = before.steps || [];
                const afterSteps = after.steps || [];
                if (afterSteps.length > beforeSteps.length) {
                    const added = afterSteps[afterSteps.length - 1];
                    const stepText = added?.text ? truncateText(added.text, 20) : "subtask";
                    return {
                        undo: `Deleted step "${stepText}" on "${titleSnippet}"`,
                        redo: `Restored step "${stepText}" on "${titleSnippet}"`,
                    };
                } else if (afterSteps.length < beforeSteps.length) {
                    const removed = beforeSteps.find(b => !afterSteps.some(a => a.id === b.id)) || beforeSteps[0];
                    const stepText = removed?.text ? truncateText(removed.text, 20) : "subtask";
                    return {
                        undo: `Restored deleted step "${stepText}" on "${titleSnippet}"`,
                        redo: `Deleted step "${stepText}" on "${titleSnippet}"`,
                    };
                }
                return {
                    undo: `Reverted subtasks change on "${titleSnippet}"`,
                    redo: `Restored subtasks change on "${titleSnippet}"`,
                };
            }
            case "schedule": {
                return {
                    undo: `Reverted schedule on "${titleSnippet}"`,
                    redo: `Restored schedule on "${titleSnippet}"`,
                };
            }
            default: {
                return {
                    undo: `Reverted changes on "${titleSnippet}"`,
                    redo: `Restored changes on "${titleSnippet}"`,
                };
            }
        }
    }

    public recordTaskUpdate(categoryFilepath: string, beforeTask: TaskItem, afterTask: TaskItem): void {
        if (this.isUndoingOrRedoing) return;

        const field = this.detectField(beforeTask, afterTask);
        // If nothing meaningful changed, skip
        if (field === "general" && JSON.stringify(beforeTask) === JSON.stringify(afterTask)) {
            return;
        }

        const now = Date.now();
        const lastAction = this.undoStack[this.undoStack.length - 1];

        // Merge rapid consecutive edits on same task & field (e.g. continuous weight wheel, text input)
        if (
            lastAction &&
            lastAction.type === "task_update" &&
            lastAction.taskId === afterTask.id &&
            lastAction.categoryFilepath === categoryFilepath &&
            lastAction.field === field &&
            now - lastAction.timestamp < HistoryService.MERGE_WINDOW_MS
        ) {
            lastAction.afterTask = deepCloneTask(afterTask);
            lastAction.timestamp = now;
            const descs = this.generateDescriptions(lastAction.beforeTask, lastAction.afterTask, field);
            lastAction.descriptionUndo = descs.undo;
            lastAction.descriptionRedo = descs.redo;
            this.redoStack = [];
            return;
        }

        const descs = this.generateDescriptions(beforeTask, afterTask, field);
        const action: TaskUpdateAction = {
            type: "task_update",
            taskId: afterTask.id,
            categoryFilepath,
            beforeTask: deepCloneTask(beforeTask),
            afterTask: deepCloneTask(afterTask),
            field,
            descriptionUndo: descs.undo,
            descriptionRedo: descs.redo,
            timestamp: now,
        };

        this.undoStack.push(action);
        if (this.undoStack.length > HistoryService.MAX_STACK_SIZE) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    public recordTaskCreated(categoryFilepath: string, task: TaskItem): void {
        if (this.isUndoingOrRedoing) return;

        const titleSnippet = truncateText(task.title || "Untitled", 26);
        const action: TaskCreateAction = {
            type: "task_create",
            taskId: task.id,
            categoryFilepath,
            task: deepCloneTask(task),
            descriptionUndo: `Deleted created task "${titleSnippet}"`,
            descriptionRedo: `Restored created task "${titleSnippet}"`,
            timestamp: Date.now(),
        };

        this.undoStack.push(action);
        if (this.undoStack.length > HistoryService.MAX_STACK_SIZE) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    public recordTaskDeleted(categoryFilepath: string, task: TaskItem, index?: number, trashedImages?: TrashedImageBackup[]): void {
        if (this.isUndoingOrRedoing) return;

        const titleSnippet = truncateText(task.title || "Untitled", 26);
        const action: TaskDeleteAction = {
            type: "task_delete",
            taskId: task.id,
            categoryFilepath,
            task: deepCloneTask(task),
            index,
            trashedImages,
            descriptionUndo: `Restored deleted task "${titleSnippet}"`,
            descriptionRedo: `Deleted task "${titleSnippet}"`,
            timestamp: Date.now(),
        };

        this.undoStack.push(action);
        if (this.undoStack.length > HistoryService.MAX_STACK_SIZE) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    public recordTaskMoved(sourceFilepath: string, targetFilepath: string, task: TaskItem): void {
        if (this.isUndoingOrRedoing) return;

        const titleSnippet = truncateText(task.title || "Untitled", 26);
        const sourceName = sourceFilepath.split("/").pop()?.replace(/\.md$/, "") || "source";
        const targetName = targetFilepath.split("/").pop()?.replace(/\.md$/, "") || "target";

        const action: TaskMoveAction = {
            type: "task_move",
            taskId: task.id,
            sourceFilepath,
            targetFilepath,
            task: deepCloneTask(task),
            descriptionUndo: `Moved "${titleSnippet}" back to "${sourceName}"`,
            descriptionRedo: `Moved "${titleSnippet}" to "${targetName}"`,
            timestamp: Date.now(),
        };

        this.undoStack.push(action);
        if (this.undoStack.length > HistoryService.MAX_STACK_SIZE) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    public async undo(): Promise<boolean> {
        if (this.undoStack.length === 0) {
            this.toastComponent?.showToast({
                type: "undo",
                title: "Undo",
                message: "Nothing to undo",
                isEmpty: true,
            });
            return false;
        }

        const action = this.undoStack.pop()!;
        this.isUndoingOrRedoing = true;

        try {
            if (action.type === "task_update") {
                await this.dataService.updateTask(action.categoryFilepath, action.beforeTask);
                EventBus.emit(EventName.TASK_UPDATED, {
                    task: action.beforeTask,
                    categoryFilepath: action.categoryFilepath,
                    isExternal: true,
                });
            } else if (action.type === "task_create") {
                await this.dataService.deleteTask(action.categoryFilepath, action.task);
                EventBus.emit(EventName.TASK_DELETED, {
                    task: action.task,
                    categoryFilepath: action.categoryFilepath,
                });
            } else if (action.type === "task_delete") {
                const currentTasks = await this.dataService.getTasks(action.categoryFilepath);
                const existingIds = new Set(currentTasks.map(t => t.id));
                if (!existingIds.has(action.task.id)) {
                    const insertIdx = typeof action.index === "number" && action.index >= 0 ? action.index : 0;
                    currentTasks.splice(insertIdx, 0, action.task);
                    await this.dataService.saveTasks(action.categoryFilepath, currentTasks);

                    if (action.trashedImages && Array.isArray(action.trashedImages)) {
                        for (const img of action.trashedImages) {
                            try {
                                const exists = await this.app.vault.adapter.exists(img.path);
                                if (!exists && img.binary && img.binary.byteLength > 0) {
                                    const lastSlash = img.path.lastIndexOf("/");
                                    if (lastSlash > 0) {
                                        const parentDir = img.path.substring(0, lastSlash);
                                        if (!(await this.app.vault.adapter.exists(parentDir))) {
                                            await this.app.vault.createFolder(parentDir).catch(() => {});
                                        }
                                    }
                                    await this.app.vault.createBinary(img.path, img.binary);
                                }
                            } catch (e) {
                                console.warn("[FluentTasks] Failed to restore image on undo:", e);
                            }
                        }
                    }

                    EventBus.emit(EventName.TASK_UPDATED, {
                        task: action.task,
                        categoryFilepath: action.categoryFilepath,
                        isExternal: true,
                    });
                }
            } else if (action.type === "task_move") {
                await this.dataService.moveTask(action.task, action.targetFilepath, action.sourceFilepath);
                EventBus.emit(EventName.TASK_MOVED, {
                    task: action.task,
                    sourcePath: action.targetFilepath,
                    targetPath: action.sourceFilepath,
                });
            }

            this.redoStack.push(action);
            this.toastComponent?.showToast({
                type: "undo",
                title: "Undo",
                message: action.descriptionUndo,
            });
            return true;
        } catch (err) {
            console.error("[FluentTasks] Error executing undo:", err);
            new Notice("Failed to undo action.");
            return false;
        } finally {
            this.isUndoingOrRedoing = false;
        }
    }

    public async redo(): Promise<boolean> {
        if (this.redoStack.length === 0) {
            this.toastComponent?.showToast({
                type: "redo",
                title: "Redo",
                message: "Nothing to redo",
                isEmpty: true,
            });
            return false;
        }

        const action = this.redoStack.pop()!;
        this.isUndoingOrRedoing = true;

        try {
            if (action.type === "task_update") {
                await this.dataService.updateTask(action.categoryFilepath, action.afterTask);
                EventBus.emit(EventName.TASK_UPDATED, {
                    task: action.afterTask,
                    categoryFilepath: action.categoryFilepath,
                    isExternal: true,
                });
            } else if (action.type === "task_create") {
                const currentTasks = await this.dataService.getTasks(action.categoryFilepath);
                const existingIds = new Set(currentTasks.map(t => t.id));
                if (!existingIds.has(action.task.id)) {
                    currentTasks.unshift(action.task);
                    await this.dataService.saveTasks(action.categoryFilepath, currentTasks);
                    EventBus.emit(EventName.TASK_UPDATED, {
                        task: action.task,
                        categoryFilepath: action.categoryFilepath,
                        isExternal: true,
                    });
                }
            } else if (action.type === "task_delete") {
                await this.dataService.deleteTask(action.categoryFilepath, action.task);
                EventBus.emit(EventName.TASK_DELETED, {
                    task: action.task,
                    categoryFilepath: action.categoryFilepath,
                });
            } else if (action.type === "task_move") {
                await this.dataService.moveTask(action.task, action.sourceFilepath, action.targetFilepath);
                EventBus.emit(EventName.TASK_MOVED, {
                    task: action.task,
                    sourcePath: action.sourceFilepath,
                    targetPath: action.targetFilepath,
                });
            }

            this.undoStack.push(action);
            this.toastComponent?.showToast({
                type: "redo",
                title: "Redo",
                message: action.descriptionRedo,
            });
            return true;
        } catch (err) {
            console.error("[FluentTasks] Error executing redo:", err);
            new Notice("Failed to redo action.");
            return false;
        } finally {
            this.isUndoingOrRedoing = false;
        }
    }

    public destroy(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.toastComponent = null;
    }
}
