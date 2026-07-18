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

import { Plugin, ItemView, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_SIDEBAR, VIEW_TYPE_MAIN, VIEW_TYPE_DETAIL, EventName } from "./types";
import { EventBus } from "./EventBus";
import { Logger } from "./Logger";
import { DataService } from "./DataService";
import TaskSidebarView from "./TaskSidebarView.svelte";
import TaskMainView from "./TaskMainView.svelte";
import TaskDetailView from "./TaskDetailView.svelte";
import { FluentTasksSettings, DEFAULT_SETTINGS, FluentTasksSettingTab } from "./settings";
import "./styles.css";

// =============================================
// Svelte View Wrappers (Obsidian ItemView → Svelte)
// =============================================

class TaskSidebarViewWrapper extends ItemView {
    private component: TaskSidebarView | null = null;
    private dataService: DataService;

    constructor(leaf: WorkspaceLeaf, dataService: DataService) {
        super(leaf);
        this.dataService = dataService;
    }

    getViewType(): string { return VIEW_TYPE_SIDEBAR; }
    getDisplayText(): string { return "Fluent Tasks"; }
    getIcon(): string { return "list"; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.component = new TaskSidebarView({
            target: container,
            props: { app: this.app, dataService: this.dataService },
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

    constructor(leaf: WorkspaceLeaf, dataService: DataService) {
        super(leaf);
        this.dataService = dataService;
    }

    getViewType(): string { return VIEW_TYPE_MAIN; }
    getDisplayText(): string { return "Tasks"; }
    getIcon(): string { return "check-square"; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.component = new TaskMainView({
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

    /** Expose the inner Svelte component for direct method calls from the plugin */
    getComponent(): TaskMainView | null {
        return this.component;
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
        this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new TaskSidebarViewWrapper(leaf, this.dataService));
        this.registerView(VIEW_TYPE_MAIN, (leaf) => new TaskMainViewWrapper(leaf, this.dataService));
        this.registerView(VIEW_TYPE_DETAIL, (leaf) => new TaskDetailViewWrapper(leaf, this.dataService));

        // Ribbon icon - always visible in left sidebar
        this.addRibbonIcon("check-square", "Open Fluent Tasks", () => {
            this.activateAllViews();
        });

        // Register commands
        this.addCommand({
            id: "open-all-views",
            name: "Open all views",
            callback: () => this.activateAllViews(),
        });

        this.addCommand({
            id: "open-sidebar",
            name: "Open sidebar",
            callback: () => this.activateView(VIEW_TYPE_SIDEBAR, "left"),
        });

        this.addCommand({
            id: "open-main-view",
            name: "Open main view",
            callback: () => this.activateView(VIEW_TYPE_MAIN, "center"),
        });

        this.addCommand({
            id: "open-detail-view",
            name: "Open detail view",
            callback: () => this.activateView(VIEW_TYPE_DETAIL, "right"),
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

            EventBus.on(EventName.TASK_SELECTED, async (payload: any) => {
                const leaf = await this.activateView(VIEW_TYPE_DETAIL, "right");
                if (leaf && leaf.view instanceof TaskDetailViewWrapper) {
                    const comp = leaf.view.getComponent();
                    if (comp) {
                        comp.loadTask(payload.task, payload.categoryFilepath);
                    }
                }
            });

            // Automatically open views on startup if not already open
            if (this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR).length === 0) {
                await this.activateAllViews();
            }

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
