import { App, SuggestModal } from "obsidian";
import type { DataService } from "./DataService";
import type { TaskItem, CategoryInfo } from "./types";
import { EventBus } from "./EventBus";
import { EventName } from "./types";
import type FluentTasksPlugin from "./main";

export interface TaskSearchResult {
    task: TaskItem;
    category: CategoryInfo;
    matchField: string;
}

export class TaskSearchModal extends SuggestModal<TaskSearchResult> {
    private dataService: DataService;
    private plugin: FluentTasksPlugin;
    private scopeFilepath: string | null;
    private hideCompleted: boolean;
    private toggleEl: HTMLElement | null = null;

    constructor(app: App, plugin: FluentTasksPlugin, dataService: DataService, scopeFilepath?: string | null) {
        super(app);
        this.plugin = plugin;
        this.dataService = dataService;
        this.scopeFilepath = scopeFilepath ?? null;
        this.hideCompleted = plugin.settings.searchHideCompleted;
        this.setPlaceholder(
            scopeFilepath
                ? "Search in this list (title, steps, notes)..."
                : "Search all tasks (title, steps, notes)..."
        );
    }

    onOpen(): void {
        super.onOpen();
        this.modalEl.addClass("fluent-tasks-search-modal");
        
        // Inject filter toggle button next to the input
        const promptEl = this.modalEl.querySelector(".prompt-input-container");
        if (promptEl) {
            // Hide native clear button if present
            const clearBtn = promptEl.querySelector(".search-input-clear-button, .prompt-input-clear-button") as HTMLElement | null;
            if (clearBtn) clearBtn.style.display = "none";

            this.toggleEl = promptEl.createEl("button", {
                cls: "todo-search-filter-btn",
                attr: { "aria-label": "Toggle completed tasks filter" },
            });
            this.updateToggleLabel();
            this.toggleEl.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.hideCompleted = !this.hideCompleted;
                // Persist preference
                this.plugin.settings.searchHideCompleted = this.hideCompleted;
                void this.plugin.saveSettings();
                this.updateToggleLabel();
                // Re-trigger search by updating input
                this.inputEl.dispatchEvent(new Event("input"));
            });
        }
    }

    private updateToggleLabel(): void {
        if (!this.toggleEl) return;
        this.toggleEl.textContent = this.hideCompleted ? "Active only" : "All tasks";
        this.toggleEl.toggleClass("is-active", this.hideCompleted);
    }

    async getSuggestions(query: string): Promise<TaskSearchResult[]> {
        if (!query || query.trim().length === 0) return [];
        let results = await this.dataService.searchTasks(query, this.scopeFilepath);
        if (this.hideCompleted) {
            results = results.filter(r => !r.task.completed);
        }
        return results;
    }

    renderSuggestion(item: TaskSearchResult, el: HTMLElement): void {
        const titleEl = el.createDiv({ cls: "suggestion-title" });
        titleEl.setText(item.task.title);

        const descEl = el.createDiv({ cls: "suggestion-note" });
        const parts: string[] = [item.category.name, `Match: ${item.matchField}`];
        if (item.task.completed) parts.push("Completed");
        descEl.setText(parts.join("  ·  "));
    }

    onChooseSuggestion(item: TaskSearchResult, evt: MouseEvent | KeyboardEvent): void {
        // Switch to the category first
        EventBus.emit(EventName.CATEGORY_SELECTED, { category: item.category });
        // Then navigate to the specific task (scroll + highlight)
        setTimeout(() => {
            EventBus.emit(EventName.TASK_NAVIGATE, {
                taskId: item.task.id,
                isCompleted: item.task.completed,
            });
            // Also open the detail panel
            EventBus.emit(EventName.TASK_SELECTED, {
                task: item.task,
                categoryFilepath: item.category.filepath,
            });
        }, 200);
    }
}
