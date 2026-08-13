import { App, SuggestModal } from "obsidian";
import type { DataService } from "./DataService";
import type { TaskItem, CategoryInfo } from "./types";
import { EventBus } from "./EventBus";
import { EventName } from "./types";

export interface TaskSearchResult {
    task: TaskItem;
    category: CategoryInfo;
    matchField: string;
}

export class TaskSearchModal extends SuggestModal<TaskSearchResult> {
    private dataService: DataService;
    private scopeFilepath: string | null;

    constructor(app: App, dataService: DataService, scopeFilepath?: string | null) {
        super(app);
        this.dataService = dataService;
        this.scopeFilepath = scopeFilepath ?? null;
        this.setPlaceholder(
            scopeFilepath
                ? "Search in this list (title, steps, notes)..."
                : "Search all tasks (title, steps, notes)..."
        );
    }

    async getSuggestions(query: string): Promise<TaskSearchResult[]> {
        if (!query || query.trim().length === 0) return [];
        return await this.dataService.searchTasks(query, this.scopeFilepath);
    }

    renderSuggestion(item: TaskSearchResult, el: HTMLElement): void {
        const titleEl = el.createDiv({ cls: "suggestion-title" });
        titleEl.setText(item.task.title);

        const descEl = el.createDiv({ cls: "suggestion-note" });
        descEl.setText(`📁 ${item.category.name}  ·  Match: ${item.matchField}${item.task.completed ? "  ·  ✅ Completed" : ""}`);
    }

    onChooseSuggestion(item: TaskSearchResult, evt: MouseEvent | KeyboardEvent): void {
        EventBus.emit(EventName.CATEGORY_SELECTED, { category: item.category });
        setTimeout(() => {
            EventBus.emit(EventName.TASK_SELECTED, {
                task: item.task,
                categoryFilepath: item.category.filepath,
            });
        }, 150);
    }
}
