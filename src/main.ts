/**
 * main.ts
 * Plugin entry point — registers views, commands, and manages plugin lifecycle.
 *
 * Architecture:
 *   Plugin (main.ts)
 *     ├── TaskSidebarViewWrapper (LEFT)  → mounts TaskSidebarView.svelte
 *     ├── TaskMainViewWrapper   (CENTER) → mounts TaskMainView.svelte
 *     └── TaskDetailViewWrapper (RIGHT)  → mounts TaskDetailView.svelte
 *
 * All cross-view communication flows through EventBus.
 * All data I/O flows through DataService.
 */

import { Plugin, ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { VIEW_TYPE_SIDEBAR, VIEW_TYPE_MAIN, VIEW_TYPE_DETAIL, EventName } from "./types";
import { EventBus } from "./EventBus";
import { Logger } from "./Logger";
import { DataService } from "./DataService";
import TaskSidebarView from "./TaskSidebarView.svelte";
import TaskMainView from "./TaskMainView.svelte";
import TaskDetailView from "./TaskDetailView.svelte";
import { FluentTasksSettings, DEFAULT_SETTINGS, FluentTasksSettingTab } from "./settings";
import { TaskSearchModal } from "./TaskSearchModal";
import "./styles.css";

// =============================================
// Svelte View Wrappers (Obsidian ItemView → Svelte)
// =============================================

class TaskSidebarViewWrapper extends ItemView {
    private component: TaskSidebarView | null = null;
    private dataService: DataService;
    private plugin: FluentTasksPlugin;

    constructor(leaf: WorkspaceLeaf, dataService: DataService, plugin: FluentTasksPlugin) {
        super(leaf);
        this.dataService = dataService;
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_SIDEBAR; }
    getDisplayText(): string { return "Fluent Tasks"; }
    getIcon(): string { return "list"; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.component = new TaskSidebarView({
            target: container,
            props: { app: this.app, dataService: this.dataService, plugin: this.plugin },
        });
    }

    async onClose(): Promise<void> {
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }
}

class TaskMainViewWrapper extends ItemView {
    private component: TaskMainView | null = null;
    private dataService: DataService;
    private plugin: FluentTasksPlugin;

    constructor(leaf: WorkspaceLeaf, dataService: DataService, plugin: FluentTasksPlugin) {
        super(leaf);
        this.dataService = dataService;
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_MAIN; }
    getDisplayText(): string { return "Tasks"; }
    getIcon(): string { return "check-square"; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.component = new TaskMainView({
            target: container,
            props: { dataService: this.dataService, plugin: this.plugin },
        });
    }

    async onClose(): Promise<void> {
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }

    /** Expose the inner Svelte component for direct method calls from the plugin */
    getComponent(): TaskMainView | null {
        return this.component;
    }

    get file(): TFile | null {
        const cat = this.component?.getCurrentCategory();
        if (cat && cat.filepath) {
            const f = this.app.vault.getAbstractFileByPath(cat.filepath);
            if (f instanceof TFile) return f;
        }
        return null;
    }
}

class TaskDetailViewWrapper extends ItemView {
    private component: TaskDetailView | null = null;
    private dataService: DataService;

    constructor(leaf: WorkspaceLeaf, dataService: DataService) {
        super(leaf);
        this.dataService = dataService;
    }

    getViewType(): string { return VIEW_TYPE_DETAIL; }
    getDisplayText(): string { return "Task Details"; }
    getIcon(): string { return "file-text"; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.component = new TaskDetailView({
            target: container,
            props: { dataService: this.dataService },
        });
    }

    async onClose(): Promise<void> {
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }

    getComponent(): TaskDetailView | null {
        return this.component;
    }
}

// =============================================
// Plugin
// =============================================

export default class FluentTasksPlugin extends Plugin {
    private dataService!: DataService;
    settings!: FluentTasksSettings;

    async onload(): Promise<void> {
        Logger.init(this.app);
        Logger.log("Fluent Tasks plugin loading...");
        
        window.addEventListener('error', e => Logger.log("Global error:", e.error?.stack || e.message));
        window.addEventListener('unhandledrejection', e => Logger.log("Unhandled rejection:", e.reason?.stack || e.reason));

        // Instantiate DataService synchronously so it's available for ViewWrappers
        this.dataService = new DataService(this.app);

        // FIX: Register settings tab synchronously!
        // If we await loadSettings BEFORE adding the tab, plugins like 'settings-in-tab'
        // that monkey-patch the settings gear will miss our tab and cause the gear button to break.
        this.addSettingTab(new FluentTasksSettingTab(this.app, this));

        // Register all three view types (must be synchronous, before layout ready)
        this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new TaskSidebarViewWrapper(leaf, this.dataService, this));
        this.registerView(VIEW_TYPE_MAIN, (leaf) => new TaskMainViewWrapper(leaf, this.dataService, this));
        this.registerView(VIEW_TYPE_DETAIL, (leaf) => new TaskDetailViewWrapper(leaf, this.dataService));

        // Ribbon icon - always visible in left sidebar
        this.addRibbonIcon("check-square", "Open Fluent Tasks", () => {
            void this.activateAllViews();
        });

        // Register commands
        this.addCommand({
            id: "open-all-views",
            name: "Open all views",
            callback: () => { void this.activateAllViews(); },
        });

        this.addCommand({
            id: "open-sidebar",
            name: "Open sidebar",
            callback: () => { void this.activateView(VIEW_TYPE_SIDEBAR, "left"); },
        });

        this.addCommand({
            id: "open-main-view",
            name: "Open main view",
            callback: () => { void this.activateView(VIEW_TYPE_MAIN, "center"); },
        });

        this.addCommand({
            id: "open-detail-view",
            name: "Open detail view",
            callback: () => { void this.activateView(VIEW_TYPE_DETAIL, "right"); },
        });

        this.addCommand({
            id: "search-all-tasks",
            name: "Search all tasks",
            callback: () => {
                new TaskSearchModal(this.app, this, this.dataService).open();
            },
        });

        this.addCommand({
            id: "search-current-list",
            name: "Search tasks in current list",
            callback: () => {
                const mainLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN)[0];
                let scopePath: string | null = null;
                if (mainLeaf && mainLeaf.view instanceof TaskMainViewWrapper) {
                    const comp = mainLeaf.view.getComponent();
                    const cat = comp?.getCurrentCategory();
                    if (cat) scopePath = cat.filepath;
                }
                new TaskSearchModal(this.app, this, this.dataService, scopePath).open();
            },
        });

        // FIX: All workspace/vault operations MUST wait until layout is ready.
        // Running them before this causes silent startup crashes on Obsidian boot.
        this.app.workspace.onLayoutReady(async () => {
            await this.dataService.ensureDataFolder();

            await this.loadSettings();
            this.applySettings();

            // Manage dynamic opening/closing of the detail view
            EventBus.on(EventName.DETAIL_CLOSE, () => {
                this.app.workspace.detachLeavesOfType(VIEW_TYPE_DETAIL);
            });

            EventBus.on(EventName.CATEGORY_SELECTED, (payload: any) => {
                if (payload && payload.category) {
                    void this.activateView(VIEW_TYPE_MAIN, "center");
                }
            });

            EventBus.on(EventName.TASK_SELECTED, (payload: any) => {
                void (async () => {
                    const leaf = await this.activateView(VIEW_TYPE_DETAIL, "right");
                    if (leaf && leaf.view instanceof TaskDetailViewWrapper) {
                        const comp = leaf.view.getComponent();
                        if (comp) {
                            comp.loadTask(payload.task, payload.categoryFilepath);
                        }
                    }
                })();
            });

            // Automatically open views on startup if not already open
            if (this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR).length === 0) {
                await this.activateAllViews();
            }

            await this.registerCategoryCommands();

            EventBus.on(EventName.CATEGORY_LIST_CHANGED, () => {
                void this.registerCategoryCommands();
            });

            Logger.log("Fluent Tasks plugin loaded successfully.");
        });
    }


    async onunload(): Promise<void> {
        // Clean up EventBus to prevent memory leaks
        EventBus.destroy();

        // Clean up global drag data
        (window as any).__mstodo_drag_data = null;

        Logger.log("Fluent Tasks plugin unloaded.");
    }

    // =============================================
    // Settings Management
    // =============================================

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    applySettings() {
        document.body.setCssProps({
            "--todo-accent": this.settings.accentColor,
            "--todo-accent-glow": `${this.settings.accentColor}99`,
            "--todo-accent-light": `${this.settings.accentColor}26`,
        });
    }

    // =============================================
    // Sidebar Auto-Expand
    // =============================================

    /**
     * Expand the left sidebar and reveal the Fluent Tasks sidebar list tab.
     */
    expandSidebarToList(): void {
        const leftSplit = this.app.workspace.leftSplit as any;
        if (leftSplit.collapsed) {
            leftSplit.expand();
        }
        const sidebarLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);
        if (sidebarLeaves.length > 0) {
            this.app.workspace.revealLeaf(sidebarLeaves[0]);
        }
    }

    private registeredCategoryCommandIds: Set<string> = new Set();

    /** Register a jump command for each category list */
    async registerCategoryCommands(): Promise<void> {
        const categories = await this.dataService.getCategories();
        for (const cat of categories) {
            const commandId = `jump-to-list-${cat.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`;
            if (this.registeredCategoryCommandIds.has(commandId)) continue;
            this.registeredCategoryCommandIds.add(commandId);
            this.addCommand({
                id: commandId,
                name: `Jump to list: ${cat.name}`,
                callback: () => {
                    void (async () => {
                        await this.activateView(VIEW_TYPE_MAIN, "center");
                        EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat, focusInput: true });
                        if (this.settings.autoExpandSidebar) {
                            this.expandSidebarToList();
                        }
                    })();
                },
            });
        }
    }

    // =============================================
    // View Activation
    // =============================================

    /**
     * Open all three panels at once for the full MS To-Do experience.
     */
    async activateAllViews(): Promise<void> {
        await this.activateView(VIEW_TYPE_SIDEBAR, "left");
        await this.activateView(VIEW_TYPE_MAIN, "center");
        await this.activateView(VIEW_TYPE_DETAIL, "right");
    }

    /**
     * Activate a specific view in the designated position.
     * Handles: finding existing leaves, creating new ones, and revealing.
     */
    async activateView(
        viewType: string,
        position: "left" | "center" | "right"
    ): Promise<WorkspaceLeaf | null> {
        const { workspace } = this.app;

        // Check if the view already exists
        let leaf = workspace.getLeavesOfType(viewType)[0] ?? null;

        if (!leaf) {
            // Create in the appropriate position
            switch (position) {
                case "left":
                    leaf = workspace.getLeftLeaf(false);
                    break;
                case "right":
                    leaf = workspace.getRightLeaf(false);
                    break;
                case "center":
                default:
                    leaf = workspace.getLeaf(false);
                    break;
            }

            if (leaf) {
                await leaf.setViewState({ type: viewType, active: true });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }

        return leaf;
    }


}
