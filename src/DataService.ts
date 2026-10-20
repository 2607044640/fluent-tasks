import { App } from "obsidian";
import { TaskItem, CategoryInfo, SidebarItem, GroupInfo, STARRED_CATEGORY_PATH } from "./types";
import { AtomicIOPipeline } from "./services/AtomicIOPipeline";
import { CategoryService } from "./services/CategoryService";
import { TaskService } from "./services/TaskService";
import { LinkedNoteService } from "./services/LinkedNoteService";
import { getFlatCategories } from "./utils/sidebarTreeUtils";

/**
 * DataService.ts
 * Facade pattern bridging the old monolithic DataService to the new atomic microservices.
 */
export class DataService {
    public app: App;
    private io: AtomicIOPipeline;
    private categorySvc: CategoryService;
    private taskSvc: TaskService;

    constructor(app: App) {
        this.app = app;
        this.io = new AtomicIOPipeline(app);
        this.categorySvc = new CategoryService(app, this.io);
        this.taskSvc = new TaskService(this.io);
    }

    public getApp(): App {
        return this.app;
    }

    async ensureDataFolder(): Promise<void> {
        return this.io.ensureDataFolder();
    }

    isInternalWrite(filepath: string): boolean {
        return this.io.isInternalWrite(filepath);
    }

    markInternalWrite(filepath: string, windowMs?: number): void {
        this.io.markInternalWrite(filepath, windowMs);
    }

    // Category Operations
    async getSidebarItems(): Promise<SidebarItem[]> {
        return this.categorySvc.getSidebarItems();
    }
    async saveSidebarState(items: SidebarItem[]): Promise<void> {
        return this.categorySvc.saveSidebarState(items);
    }
    async createGroup(name: string): Promise<GroupInfo> {
        return this.categorySvc.createGroup(name);
    }
    async renameGroup(groupId: string, newName: string): Promise<void> {
        const items = await this.categorySvc.getSidebarItems();
        const group = items.find(i => i.type === "group" && i.id === groupId);
        const oldName = group && group.type === "group" ? group.name : "";
        const memberPaths = group && group.type === "group"
            ? (group.items || []).map(c => c.filepath)
            : [];
        await this.categorySvc.renameGroup(groupId, newName);
        if (oldName && oldName !== newName) {
            for (const filepath of memberPaths) {
                await LinkedNoteService.handleGroupRename(this.app, this, filepath);
            }
        }
    }
    async findGroupNameForCategory(categoryFilepath: string): Promise<string> {
        return this.categorySvc.findGroupNameForCategory(categoryFilepath);
    }
    async deleteGroup(groupId: string): Promise<void> {
        return this.categorySvc.deleteGroup(groupId);
    }

    async getCategories(): Promise<CategoryInfo[]> {
        const items = await this.categorySvc.getSidebarItems();
        return getFlatCategories(items);
    }
    async createCategory(name: string): Promise<CategoryInfo> {
        return this.categorySvc.createCategory(name);
    }
    async deleteCategory(filepath: string): Promise<void> {
        return this.categorySvc.deleteCategory(filepath);
    }
    async restoreCategory(
        categoryName: string,
        categoryFilepath: string,
        fileContent: string,
        groupName?: string,
        index?: number
    ): Promise<CategoryInfo> {
        return this.categorySvc.restoreCategory(categoryName, categoryFilepath, fileContent, groupName, index);
    }
    async renameCategory(filepath: string, newName: string): Promise<CategoryInfo> {
        const oldFilepath = filepath;
        const newCat = await this.categorySvc.renameCategory(filepath, newName);
        await LinkedNoteService.handleCategoryRename(this.app, this, oldFilepath, newCat.filepath);
        return newCat;
    }

    // Task Operations
    async getTasks(categoryFilepath: string): Promise<TaskItem[]> {
        if (categoryFilepath === STARRED_CATEGORY_PATH) {
            const categories = await this.getCategories();
            const starredTasks: TaskItem[] = [];
            for (const cat of categories) {
                const tasks = await this.taskSvc.getTasks(cat.filepath);
                for (const t of tasks) {
                    if (t.starred) {
                        t.sourceFilepath = cat.filepath;
                        t.sourceCategoryName = cat.name;
                        starredTasks.push(t);
                    }
                }
            }
            return starredTasks;
        }
        return this.taskSvc.getTasks(categoryFilepath);
    }

    async getStarredCount(): Promise<number> {
        const categories = await this.getCategories();
        let count = 0;
        for (const cat of categories) {
            const tasks = await this.taskSvc.getTasks(cat.filepath);
            for (const t of tasks) {
                if (t.starred && !t.completed) {
                    count++;
                }
            }
        }
        return count;
    }

    async getTotalStarredCount(): Promise<number> {
        const categories = await this.getCategories();
        let count = 0;
        for (const cat of categories) {
            const tasks = await this.taskSvc.getTasks(cat.filepath);
            for (const t of tasks) {
                if (t.starred) {
                    count++;
                }
            }
        }
        return count;
    }

    async findCategoryForTaskId(taskId: string): Promise<string | null> {
        const categories = await this.getCategories();
        for (const cat of categories) {
            const tasks = await this.taskSvc.getTasks(cat.filepath);
            if (tasks.some(t => t.id === taskId)) {
                return cat.filepath;
            }
        }
        return null;
    }

    async saveTasks(categoryFilepath: string, tasks: TaskItem[]): Promise<void> {
        if (categoryFilepath === STARRED_CATEGORY_PATH) {
            for (const task of tasks) {
                const targetFile = task.sourceFilepath || await this.findCategoryForTaskId(task.id);
                if (targetFile) {
                    await this.taskSvc.updateTask(targetFile, task);
                }
            }
            return;
        }
        return this.taskSvc.saveTasks(categoryFilepath, tasks);
    }

    async addTask(categoryFilepath: string, title: string): Promise<TaskItem> {
        if (categoryFilepath === STARRED_CATEGORY_PATH) {
            const categories = await this.getCategories();
            if (categories.length === 0) {
                throw new Error("No category available to add task");
            }
            const targetCat = categories[0];
            const newTask = await this.taskSvc.addTask(targetCat.filepath, title);
            newTask.starred = true;
            newTask.sourceFilepath = targetCat.filepath;
            newTask.sourceCategoryName = targetCat.name;
            await this.taskSvc.updateTask(targetCat.filepath, newTask);
            return newTask;
        }
        return this.taskSvc.addTask(categoryFilepath, title);
    }

    async updateTask(categoryFilepath: string, updatedTask: TaskItem): Promise<void> {
        if (categoryFilepath === STARRED_CATEGORY_PATH) {
            const targetFile = updatedTask.sourceFilepath || await this.findCategoryForTaskId(updatedTask.id);
            if (targetFile) {
                return this.taskSvc.updateTask(targetFile, updatedTask);
            }
            throw new Error(`Failed to locate source category for task ${updatedTask.id}`);
        }
        return this.taskSvc.updateTask(categoryFilepath, updatedTask);
    }

    async deleteTask(categoryFilepath: string, task: TaskItem): Promise<void> {
        if (categoryFilepath === STARRED_CATEGORY_PATH) {
            const targetFile = task.sourceFilepath || await this.findCategoryForTaskId(task.id);
            if (targetFile) {
                return this.taskSvc.deleteTask(targetFile, task);
            }
            throw new Error(`Failed to locate source category for task ${task.id}`);
        }
        return this.taskSvc.deleteTask(categoryFilepath, task);
    }

    async moveTask(task: TaskItem, sourceFilepath: string, targetFilepath: string): Promise<void> {
        const actualSource = sourceFilepath === STARRED_CATEGORY_PATH 
            ? (task.sourceFilepath || await this.findCategoryForTaskId(task.id) || sourceFilepath)
            : sourceFilepath;
        await LinkedNoteService.handleTaskMove(this.app, this, task, actualSource, targetFilepath);
        return this.taskSvc.moveTask(task, actualSource, targetFilepath);
    }

    /** Deep search across tasks — matches title, steps text, and note content */
    async searchTasks(query: string, scopeFilepath?: string | null): Promise<Array<{ task: TaskItem; category: CategoryInfo; matchField: string }>> {
        const results: Array<{ task: TaskItem; category: CategoryInfo; matchField: string }> = [];
        const q = query.toLowerCase().trim();
        if (!q) return results;

        const categories = await this.getCategories();
        const targetCategories = scopeFilepath
            ? categories.filter(c => c.filepath === scopeFilepath)
            : categories;

        for (const cat of targetCategories) {
            const tasks = await this.getTasks(cat.filepath);
            for (const task of tasks) {
                if (task.title.toLowerCase().includes(q)) {
                    results.push({ task, category: cat, matchField: "Title" });
                } else if (task.steps && task.steps.some(s => s.text.toLowerCase().includes(q))) {
                    results.push({ task, category: cat, matchField: "Steps" });
                } else if (task.note && task.note.toLowerCase().includes(q)) {
                    results.push({ task, category: cat, matchField: "Note" });
                }
            }
        }
        return results;
    }

    /**
     * Rollover all recurring tasks across all categories.
     * Returns true if any files were updated.
     */
    async rolloverRecurringTasks(): Promise<boolean> {
        const categories = await this.getCategories();
        let anyChanged = false;
        for (const cat of categories) {
            const changed = await this.taskSvc.rolloverTasksInFile(cat.filepath);
            if (changed) anyChanged = true;
        }
        return anyChanged;
    }
}
