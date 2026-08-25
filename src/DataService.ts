import { App } from "obsidian";
import { TaskItem, CategoryInfo, SidebarItem, GroupInfo } from "./types";
import { AtomicIOPipeline } from "./services/AtomicIOPipeline";
import { CategoryService } from "./services/CategoryService";
import { TaskService } from "./services/TaskService";

/**
 * DataService.ts
 * Facade pattern bridging the old monolithic DataService to the new atomic microservices.
 */
export class DataService {
    private io: AtomicIOPipeline;
    private categorySvc: CategoryService;
    private taskSvc: TaskService;

    constructor(app: App) {
        this.io = new AtomicIOPipeline(app);
        this.categorySvc = new CategoryService(app, this.io);
        this.taskSvc = new TaskService(this.io);
    }

    async ensureDataFolder(): Promise<void> {
        return this.io.ensureDataFolder();
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
        return this.categorySvc.renameGroup(groupId, newName);
    }

    async getCategories(): Promise<CategoryInfo[]> {
        const items = await this.categorySvc.getSidebarItems();
        const categories: CategoryInfo[] = [];
        for (const item of items) {
            if (item.type === "group") {
                categories.push(...item.items);
            } else if (item.type === "category") {
                categories.push(item);
            }
        }
        return categories;
    }
    async createCategory(name: string): Promise<CategoryInfo> {
        return this.categorySvc.createCategory(name);
    }
    async deleteCategory(filepath: string): Promise<void> {
        return this.categorySvc.deleteCategory(filepath);
    }
    async renameCategory(filepath: string, newName: string): Promise<CategoryInfo> {
        return this.categorySvc.renameCategory(filepath, newName);
    }

    // Task Operations
    async getTasks(categoryFilepath: string): Promise<TaskItem[]> {
        return this.taskSvc.getTasks(categoryFilepath);
    }
    async saveTasks(categoryFilepath: string, tasks: TaskItem[]): Promise<void> {
        return this.taskSvc.saveTasks(categoryFilepath, tasks);
    }
    async addTask(categoryFilepath: string, title: string): Promise<TaskItem> {
        return this.taskSvc.addTask(categoryFilepath, title);
    }
    async updateTask(categoryFilepath: string, updatedTask: TaskItem): Promise<void> {
        return this.taskSvc.updateTask(categoryFilepath, updatedTask);
    }
    async deleteTask(categoryFilepath: string, task: TaskItem): Promise<void> {
        return this.taskSvc.deleteTask(categoryFilepath, task);
    }
    async moveTask(task: TaskItem, sourceFilepath: string, targetFilepath: string): Promise<void> {
        return this.taskSvc.moveTask(task, sourceFilepath, targetFilepath);
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
}
