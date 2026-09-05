import { MarkdownParser } from "../MarkdownParser";
import { Logger } from "../Logger";
import { TaskItem } from "../types";
import { AtomicIOPipeline } from "./AtomicIOPipeline";
import { RecurrenceService } from "./RecurrenceService";
import { getTodayLocalDateString } from "../utils/timeUtils";

export class TaskService {
    private io: AtomicIOPipeline;

    constructor(io: AtomicIOPipeline) {
        this.io = io;
    }

    /** Insert a task before the first completed task, or append if none exist */
    private insertTaskBeforeCompleted(tasks: TaskItem[], task: TaskItem): void {
        tasks.unshift(task);
    }

    /** Read tasks from file (safe, read-only unless auto-healing or recurring rollover) */
    async getTasks(filepath: string): Promise<TaskItem[]> {
        const content = await this.io.readFile(filepath);
        const tasks = MarkdownParser.parseTasksFromMarkdown(content);
        
        // Self-healing deduplication at the backend layer
        const seenIds = new Set<string>();
        let uniqueTasks = tasks.filter(t => {
            if (seenIds.has(t.id)) return false;
            seenIds.add(t.id);
            return true;
        });

        let needsSave = false;

        if (uniqueTasks.length !== tasks.length) {
            Logger.log("[FluentTasks] Deduplicated tasks on load. Auto-healing file:", filepath);
            needsSave = true;
        }

        // Automatic rollover for recurring tasks (overdue reset or new-day reset)
        const todayStr = getTodayLocalDateString();
        const rolloverRes = RecurrenceService.rolloverTasks(uniqueTasks, todayStr);
        if (rolloverRes.changed) {
            uniqueTasks = rolloverRes.tasks;
            needsSave = true;
            Logger.log("[Recurrence] Rolled over recurring tasks for:", filepath);
        }

        if (needsSave) {
            await this.saveTasks(filepath, uniqueTasks);
        }

        return uniqueTasks;
    }

    /** Rollover recurring tasks in a specific file. Returns true if modified. */
    async rolloverTasksInFile(filepath: string): Promise<boolean> {
        const todayStr = getTodayLocalDateString();
        let changed = false;

        await this.io.processFile(filepath, (data: string) => {
            const tasks = MarkdownParser.parseTasksFromMarkdown(data);
            const res = RecurrenceService.rolloverTasks(tasks, todayStr);
            if (res.changed) {
                changed = true;
                return MarkdownParser.serializeTasksToMarkdown(res.tasks);
            }
            return data;
        });

        return changed;
    }

    /** Atomically overwrite the entire task list */
    async saveTasks(filepath: string, tasks: TaskItem[]): Promise<void> {
        await this.io.processFile(filepath, () => {
            return MarkdownParser.serializeTasksToMarkdown(tasks);
        });
    }

    /** Atomically add a task */
    async addTask(filepath: string, title: string): Promise<TaskItem> {
        let newTask: TaskItem | null = null;
        
        await this.io.processFile(filepath, (data: string) => {
            const tasks = MarkdownParser.parseTasksFromMarkdown(data);
            newTask = MarkdownParser.createTask(title);
            this.insertTaskBeforeCompleted(tasks, newTask);
            return MarkdownParser.serializeTasksToMarkdown(tasks);
        });
        
        if (newTask) {
            Logger.log("Added task:", title, "to", filepath);
            return newTask as TaskItem;
        }
        throw new Error("Failed to add task");
    }

    /** Atomically update a task */
    async updateTask(filepath: string, updatedTask: TaskItem): Promise<void> {
        await this.io.processFile(filepath, (data: string) => {
            const tasks = MarkdownParser.parseTasksFromMarkdown(data);
            const idx = MarkdownParser.findTaskIndex(tasks, updatedTask);
            
            if (idx === -1) {
                Logger.log("WARN: Task not found for update:", updatedTask.title);
                return data; // No changes
            }
            
            tasks[idx] = updatedTask;
            const incomplete = tasks.filter(t => !t.completed);
            const completed = tasks.filter(t => t.completed);
            return MarkdownParser.serializeTasksToMarkdown([...incomplete, ...completed]);
        });
    }

    /** Atomically delete a task */
    async deleteTask(filepath: string, task: TaskItem): Promise<void> {
        await this.io.processFile(filepath, (data: string) => {
            const tasks = MarkdownParser.parseTasksFromMarkdown(data);
            const idx = MarkdownParser.findTaskIndex(tasks, task);
            
            if (idx === -1) {
                Logger.log("WARN: Task not found for deletion:", task.title);
                return data; // No changes
            }
            
            tasks.splice(idx, 1);
            Logger.log("Deleted task:", task.title, "from", filepath);
            return MarkdownParser.serializeTasksToMarkdown(tasks);
        });
    }

    /** Cross-file task move (pseudo-atomic, but safe because we process sequentially) */
    async moveTask(task: TaskItem, sourceFilepath: string, targetFilepath: string): Promise<void> {
        if (sourceFilepath === targetFilepath) return;

        let movedTask: TaskItem | null = null;

        // 1. Atomically remove from source
        await this.io.processFile(sourceFilepath, (sourceData: string) => {
            const sourceTasks = MarkdownParser.parseTasksFromMarkdown(sourceData);
            const idx = MarkdownParser.findTaskIndex(sourceTasks, task);
            
            if (idx === -1) {
                Logger.log("WARN: Task not found in source for move:", task.title);
                return sourceData; // abort write
            }
            
            movedTask = sourceTasks.splice(idx, 1)[0];
            return MarkdownParser.serializeTasksToMarkdown(sourceTasks);
        });

        if (!movedTask) return; // Didn't find it in source

        // 2. Atomically add to target
        await this.io.processFile(targetFilepath, (targetData: string) => {
            const targetTasks = MarkdownParser.parseTasksFromMarkdown(targetData);
            this.insertTaskBeforeCompleted(targetTasks, movedTask as TaskItem);
            return MarkdownParser.serializeTasksToMarkdown(targetTasks);
        });

        Logger.log("Moved task:", task.title, "from", sourceFilepath, "to", targetFilepath);
    }
}
