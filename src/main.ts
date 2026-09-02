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

import { Plugin, ItemView, WorkspaceLeaf, TFile, Scope, App, ViewStateResult } from "obsidian";
import { VIEW_TYPE_SIDEBAR, VIEW_TYPE_MAIN, VIEW_TYPE_DETAIL, DATA_FOLDER, EventName, type CategoryInfo, type TaskItem } from "./types";
import { EventBus } from "./EventBus";
import { Logger } from "./Logger";
import { DataService } from "./DataService";
import TaskSidebarView from "./TaskSidebarView.svelte";
import TaskMainView from "./TaskMainView.svelte";
import TaskDetailView from "./TaskDetailView.svelte";
import { FluentTasksSettings, DEFAULT_SETTINGS, FluentTasksSettingTab } from "./settings";
import { TaskSearchModal } from "./TaskSearchModal";
import { QuickTaskModal } from "./modals/QuickTaskModal";
import { QuickListModal } from "./modals/QuickListModal";
import "./styles.css";

// =============================================
// Svelte View Wrappers (Obsidian ItemView → Svelte)
// =============================================

interface TaskSidebarViewComponent extends TaskSidebarView {
    triggerRenameHoveredOrActive: () => boolean;
}

class TaskSidebarViewWrapper extends ItemView {
    private component: TaskSidebarViewComponent | null = null;
    private dataService: DataService;
    private plugin: FluentTasksPlugin;

    constructor(leaf: WorkspaceLeaf, dataService: DataService, plugin: FluentTasksPlugin) {
        super(leaf);
        this.dataService = dataService;
        this.plugin = plugin;

        // Correctly instantiate Scope linked to app.scope
        this.scope = new Scope(this.app.scope);
        this.scope.register([], "F2", (evt) => {
            if (this.component?.triggerRenameHoveredOrActive()) {
                evt.preventDefault();
                return false;
            }
        });
    }

    getViewType(): string { return VIEW_TYPE_SIDEBAR; }
    getDisplayText(): string { return "Fluent Tasks"; }
    getIcon(): string { return "list"; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();

        // Native capture-phase keydown listener on the sidebar view container element
        this.containerEl.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "F2") {
                if (this.component?.triggerRenameHoveredOrActive()) {
                    evt.preventDefault();
                    evt.stopPropagation();
                }
            }
        }, true);

        this.component = new TaskSidebarView({
            target: container,
            props: { app: this.app, dataService: this.dataService, plugin: this.plugin },
        }) as unknown as TaskSidebarViewComponent;
    }

    async onClose(): Promise<void> {
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }

    getComponent(): TaskSidebarViewComponent | null {
        return this.component;
    }
}

interface TaskMainViewComponent extends TaskMainView {
    openHintsModal: () => void;
    showGuidePopover: (e: MouseEvent) => void;
    scheduleHidePopover: () => void;
    getCurrentCategory: () => CategoryInfo | null;
    loadCategory: (cat: CategoryInfo) => Promise<void>;
}

class TaskMainViewWrapper extends ItemView {
    private component: TaskMainViewComponent | null = null;
    private dataService: DataService;
    private plugin: FluentTasksPlugin;
    public navigation = true; // Enables Obsidian Leaf Navigation & History tracking

    constructor(leaf: WorkspaceLeaf, dataService: DataService, plugin: FluentTasksPlugin) {
        super(leaf);
        this.navigation = true;
        this.dataService = dataService;
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_MAIN; }
    
    getDisplayText(): string {
        const cat = this.component?.getCurrentCategory();
        return cat?.name ? cat.name : "Tasks";
    }

    getIcon(): string { return "check-square"; }

    getState(): Record<string, any> {
        const cat = this.component?.getCurrentCategory();
        return {
            categoryFilepath: cat?.filepath || "",
            categoryName: cat?.name || "",
        };
    }

    async setState(state: any, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);
        if (state && state.categoryFilepath) {
            const file = this.app.vault.getAbstractFileByPath(state.categoryFilepath);
            if (file && file instanceof TFile) {
                const cat: CategoryInfo = {
                    id: state.categoryFilepath,
                    type: "category",
                    name: state.categoryName || file.basename,
                    filepath: state.categoryFilepath
                };
                if (this.component) {
                    await this.component.loadCategory(cat);
                }
                (this.leaf as any).updateHeader?.();
                // Notify sidebar to highlight restored list without creating recursive history loops
                EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat, fromHistory: true });
            }
        }
    }

    async onOpen(): Promise<void> {
        const guideAction = this.addAction("help-circle", "Features & shortcuts guide", () => {
            const comp = this.component;
            comp?.openHintsModal();
        });

        guideAction.addEventListener("mouseenter", (e: MouseEvent) => {
            const comp = this.component;
            comp?.showGuidePopover(e);
        });
        guideAction.addEventListener("mouseleave", () => {
            const comp = this.component;
            comp?.scheduleHidePopover();
        });

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.component = new TaskMainView({
            target: container,
            props: { dataService: this.dataService, plugin: this.plugin },
        }) as unknown as TaskMainViewComponent;

        // Restore initial state if available
        const state = this.getState();
        if (state?.categoryFilepath) {
            const file = this.app.vault.getAbstractFileByPath(state.categoryFilepath);
            if (file && file instanceof TFile) {
                const cat: CategoryInfo = {
                    id: state.categoryFilepath,
                    type: "category",
                    name: state.categoryName || file.basename,
                    filepath: state.categoryFilepath
                };
                await this.component.loadCategory(cat);
            }
        }
    }

    async onClose(): Promise<void> {
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }

    /** Expose the inner Svelte component for direct method calls from the plugin */
    getComponent(): TaskMainViewComponent | null {
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
    private plugin: FluentTasksPlugin;

    constructor(leaf: WorkspaceLeaf, dataService: DataService, plugin: FluentTasksPlugin) {
        super(leaf);
        this.dataService = dataService;
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_DETAIL; }
    getDisplayText(): string { return "Task Details"; }
    getIcon(): string { return "file-text"; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        this.component = new TaskDetailView({
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

    getComponent(): TaskDetailView | null {
        return this.component;
    }
}

// =============================================
// Plugin
// =============================================

export default class FluentTasksPlugin extends Plugin {
    private dataService!: DataService;
    private ribbonIconEl: HTMLElement | null = null;
    settings: FluentTasksSettings = Object.assign({}, DEFAULT_SETTINGS);

    async onload(): Promise<void> {
        // Synchronous initialization before any async awaits
        this.dataService = new DataService(this.app);
        this.addSettingTab(new FluentTasksSettingTab(this.app, this));

        Logger.init(this.app);
        void Logger.log("Fluent Tasks plugin loading...");

        await this.loadSettings();

        // Register all three view types (must be synchronous, before layout ready)
        this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new TaskSidebarViewWrapper(leaf, this.dataService, this));
        this.registerView(VIEW_TYPE_MAIN, (leaf) => new TaskMainViewWrapper(leaf, this.dataService, this));
        this.registerView(VIEW_TYPE_DETAIL, (leaf) => new TaskDetailViewWrapper(leaf, this.dataService, this));

        // Ribbon icon (controlled by hideRibbonIcon setting)
        this.refreshRibbonIcon();

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

        this.addCommand({
            id: "rename-hovered-list-or-group",
            name: "Rename hovered or active list / group (F2)",
            callback: () => {
                const sidebarLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0];
                if (sidebarLeaf && sidebarLeaf.view instanceof TaskSidebarViewWrapper) {
                    sidebarLeaf.view.getComponent()?.triggerRenameHoveredOrActive();
                } else {
                    EventBus.emit(EventName.TRIGGER_SIDEBAR_RENAME, {});
                }
            },
        });

        this.addCommand({
            id: "open-quick-task-modal",
            name: "Open Quick Task Modal",
            callback: () => {
                new QuickTaskModal(this.app, this, this.dataService).open();
            },
        });

        this.addCommand({
            id: "open-quick-list-modal",
            name: "Open Quick List Modal (List only)",
            callback: () => {
                new QuickListModal(this.app, this, this.dataService).open();
            },
        });

        // FIX: All workspace/vault operations MUST wait until layout is ready.
        // Running them before this causes silent startup crashes on Obsidian boot.
        this.app.workspace.onLayoutReady(() => {
            void (async () => {
                await this.dataService.ensureDataFolder();

                await this.loadSettings();
                this.applySettings();

                // Track active view type to expand sidebar ONLY when switching from external tabs (Ctrl+Tab, Ctrl+Shift+Tab, etc.)
                let lastActiveViewType = this.app.workspace.getActiveViewOfType(ItemView)?.getViewType() || "";

                this.registerEvent(
                    this.app.workspace.on("active-leaf-change", (leaf) => {
                        if (!leaf || !leaf.view) return;
                        const currentType = leaf.view.getViewType();

                        const isPluginView = currentType === VIEW_TYPE_MAIN || 
                                             currentType === VIEW_TYPE_SIDEBAR || 
                                             currentType === VIEW_TYPE_DETAIL;

                        const wasPluginView = lastActiveViewType === VIEW_TYPE_MAIN || 
                                              lastActiveViewType === VIEW_TYPE_SIDEBAR || 
                                              lastActiveViewType === VIEW_TYPE_DETAIL;

                        // When switching focus from an external tab (e.g. Markdown note via Ctrl+Tab / Ctrl+Shift+Tab) to Fluent Tasks
                        if (isPluginView && !wasPluginView && this.settings.autoExpandSidebar) {
                            if (Date.now() > this.suppressAutoExpandSidebarUntil) {
                                this.expandSidebarToList();
                            }
                        }

                        // When switching focus away from Fluent Tasks to an external tab (e.g. Markdown note, settings, etc.)
                        if (!isPluginView && wasPluginView && (this.settings.autoCollapseSidebarOnSwitch ?? true)) {
                            this.collapseSidebars();
                        }

                        lastActiveViewType = currentType;
                    })
                );

            // Listen for external file modifications (AI, sync, external editors)
            this.registerEvent(
                this.app.vault.on("modify", (file) => {
                    if (!file || !(file instanceof TFile)) return;
                    if (file.path.startsWith(DATA_FOLDER + "/") && file.path.endsWith(".md")) {
                        if (this.dataService.isInternalWrite(file.path)) {
                            return; // Skip self-generated optimistic writes
                        }
                        EventBus.emit(EventName.TASK_UPDATED, {
                            categoryFilepath: file.path,
                            isExternal: true,
                        });
                    }
                })
            );

            // Listen for category creation, deletion, and renaming to update commands in real-time
            const handleCategoryVaultChange = (file: any) => {
                if (file && file.path && file.path.startsWith(DATA_FOLDER + "/") && file.path.endsWith(".md")) {
                    void this.registerCategoryCommands();
                }
            };
            this.registerEvent(this.app.vault.on("create", handleCategoryVaultChange));
            this.registerEvent(this.app.vault.on("delete", handleCategoryVaultChange));
            this.registerEvent(this.app.vault.on("rename", handleCategoryVaultChange));

            // Manage dynamic opening/closing of the detail view
            EventBus.on(EventName.DETAIL_CLOSE, () => {
                this.app.workspace.detachLeavesOfType(VIEW_TYPE_DETAIL);
            });

            EventBus.on(EventName.CATEGORY_SELECTED, (payload: unknown) => {
                const p = payload as { category?: CategoryInfo; fromHistory?: boolean } | null;
                const category = p?.category;
                if (category) {
                    void (async () => {
                        const mainLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
                        let mainLeaf: WorkspaceLeaf | null = mainLeaves[0] ?? null;

                        if (!mainLeaf) {
                            mainLeaf = await this.activateView(VIEW_TYPE_MAIN, "center");
                        }

                        if (mainLeaf) {
                            if (!p?.fromHistory) {
                                await mainLeaf.setViewState({
                                    type: VIEW_TYPE_MAIN,
                                    state: {
                                        categoryFilepath: category.filepath,
                                        categoryName: category.name,
                                    },
                                    active: true,
                                });
                            }
                            void this.app.workspace.revealLeaf(mainLeaf);
                        }
                    })();
                }
            });

            EventBus.on(EventName.TASK_SELECTED, (payload: unknown) => {
                const p = payload as { task: TaskItem; categoryFilepath: string } | null;
                if (!p) return;
                void (async () => {
                    const leaf = await this.activateView(VIEW_TYPE_DETAIL, "right");
                    if (leaf && leaf.view instanceof TaskDetailViewWrapper) {
                        const comp = leaf.view.getComponent();
                        if (comp) {
                            comp.loadTask(p.task, p.categoryFilepath);
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

            void Logger.log("Fluent Tasks plugin loaded successfully.");
            })();
        });
    }

    onunload(): void {
        if (this.ribbonIconEl) {
            this.ribbonIconEl.remove();
            this.ribbonIconEl = null;
        }

        // Clean up EventBus to prevent memory leaks
        EventBus.destroy();

        // Clean up global drag data
        (window as Window & { __mstodo_drag_data?: unknown }).__mstodo_drag_data = null;

        void Logger.log("Fluent Tasks plugin unloaded.");
    }

    /** Dynamically add or remove ribbon icon based on settings */
    refreshRibbonIcon(): void {
        if (this.ribbonIconEl) {
            this.ribbonIconEl.remove();
            this.ribbonIconEl = null;
        }
        if (!this.settings?.hideRibbonIcon) {
            this.ribbonIconEl = this.addRibbonIcon("check-square", "Open Fluent Tasks", () => {
                void this.activateAllViews();
            });
        }
    }

    // =============================================
    // Settings Management
    // =============================================

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<FluentTasksSettings> | null);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        EventBus.emit(EventName.SETTINGS_CHANGED, { settings: this.settings });
    }

    applySettings() {
        document.body.setCssProps({
            "--todo-accent": this.settings.accentColor,
            "--todo-accent-glow": `${this.settings.accentColor}99`,
            "--todo-accent-light": `${this.settings.accentColor}26`,
        });
    }

    // =============================================
    // Sidebar Auto-Expand & Collapse Management
    // =============================================

    private suppressAutoExpandSidebarUntil = 0;

    /**
     * Suppress automatic sidebar expansion for a period of time (e.g. after jumping from quick modals).
     */
    suppressAutoSidebarExpansion(durationMs = 1200): void {
        this.suppressAutoExpandSidebarUntil = Date.now() + durationMs;
    }

    /**
     * Check if a specific viewType is currently the active/visible tab in the specified sidebar (left or right).
     * Returns false if the sidebar is collapsed or if another tool (e.g. Search, File Explorer, Outline) is active.
     */
    isSidebarLeafActive(viewType: string, position: "left" | "right"): boolean {
        const split = (position === "left" ? this.app.workspace.leftSplit : this.app.workspace.rightSplit) as {
            collapsed?: boolean;
            children?: any[];
        } | null;

        if (!split || split.collapsed) {
            return false;
        }

        const leaves = this.app.workspace.getLeavesOfType(viewType);
        if (leaves.length === 0) return false;

        for (const leaf of leaves) {
            // 1. Structural check via WorkspaceTabs parent and currentTab index
            const parent = (leaf as any).parent;
            if (parent && Array.isArray(parent.children) && typeof parent.currentTab === "number") {
                if (parent.children[parent.currentTab] === leaf) {
                    return true;
                }
            }

            // 2. DOM-level fallback check for active tab header
            const tabHeader = (leaf as any).tabHeaderEl as HTMLElement | undefined;
            if (tabHeader) {
                if (tabHeader.classList.contains("is-active") || tabHeader.getAttribute("aria-selected") === "true") {
                    return true;
                }
            }

            // 3. Container visibility check
            const containerEl = (leaf as any).containerEl as HTMLElement | undefined;
            if (containerEl && containerEl.offsetWidth > 0 && containerEl.offsetHeight > 0) {
                const style = window.getComputedStyle(containerEl);
                if (style.display !== "none" && style.visibility !== "hidden") {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Check if Fluent Tasks left sidebar view (VIEW_TYPE_SIDEBAR) is active and visible.
     */
    isPluginLeftSidebarActive(): boolean {
        return this.isSidebarLeafActive(VIEW_TYPE_SIDEBAR, "left");
    }

    /**
     * Check if Fluent Tasks right detail view (VIEW_TYPE_DETAIL) is active and visible.
     */
    isPluginRightSidebarActive(): boolean {
        return this.isSidebarLeafActive(VIEW_TYPE_DETAIL, "right");
    }

    /**
     * Collapse left and right sidebars IF they are currently displaying Fluent Tasks views,
     * while preserving other tools (like search, file explorer, outline, etc.).
     */
    collapseSidebars(durationMs = 1200, force = false): void {
        this.suppressAutoSidebarExpansion(durationMs);
        const leftSplit = this.app.workspace.leftSplit as { collapsed?: boolean; collapse: () => void } | null;
        if (leftSplit && !leftSplit.collapsed) {
            if (force || this.isPluginLeftSidebarActive()) {
                leftSplit.collapse();
            }
        }
        const rightSplit = this.app.workspace.rightSplit as { collapsed?: boolean; collapse: () => void } | null;
        if (rightSplit && !rightSplit.collapsed) {
            if (force || this.isPluginRightSidebarActive()) {
                rightSplit.collapse();
            }
        }
    }

    /**
     * Expand the left sidebar and reveal the Fluent Tasks sidebar list tab.
     */
    expandSidebarToList(): void {
        const leftSplit = this.app.workspace.leftSplit as { collapsed?: boolean; expand: () => void } | null;
        if (leftSplit?.collapsed) {
            leftSplit.expand();
        }
        const sidebarLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);
        if (sidebarLeaves.length > 0) {
            void this.app.workspace.revealLeaf(sidebarLeaves[0]);
        }
    }

    private registeredCategoryCommandIds: Set<string> = new Set();

    private getCategoryCommandId(cat: CategoryInfo): string {
        let hash = 0;
        const str = cat.filepath;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return `z-jump-to-list-${Math.abs(hash).toString(36)}`;
    }

    /** Register or refresh a jump command for each category list */
    async registerCategoryCommands(): Promise<void> {
        const categories = await this.dataService.getCategories();
        const activeCommandIds = new Set<string>();
        interface AppWithCommands extends App {
            commands?: {
                commands?: Record<string, { name: string }>;
                removeCommand?: (id: string) => void;
            };
        }
        const appCommands = (this.app as unknown as AppWithCommands).commands;

        // 1. Clean up legacy commands (e.g. old "jump-to-list-*" without z- prefix)
        if (appCommands?.commands) {
            for (const key of Object.keys(appCommands.commands)) {
                if (key.startsWith(`${this.manifest.id}:jump-to-list-`)) {
                    if (appCommands.removeCommand) {
                        appCommands.removeCommand(key);
                    } else {
                        delete appCommands.commands[key];
                    }
                }
            }
        }

        // 2. Register/update commands for all active lists
        for (const cat of categories) {
            const commandId = this.getCategoryCommandId(cat);
            activeCommandIds.add(commandId);
            const fullCommandId = `${this.manifest.id}:${commandId}`;

            if (this.registeredCategoryCommandIds.has(commandId)) {
                // Keep the display name in sync if renamed via F2
                if (appCommands?.commands?.[fullCommandId]) {
                    appCommands.commands[fullCommandId].name = `Z-Jump to list: ${cat.name}`;
                }
                continue;
            }

            this.registeredCategoryCommandIds.add(commandId);
            this.addCommand({
                id: commandId,
                name: `Z-Jump to list: ${cat.name}`,
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

        // 3. Remove obsolete commands for deleted or renamed lists
        for (const oldId of Array.from(this.registeredCategoryCommandIds)) {
            if (!activeCommandIds.has(oldId)) {
                const fullId = `${this.manifest.id}:${oldId}`;
                if (appCommands?.removeCommand) {
                    appCommands.removeCommand(fullId);
                } else if (appCommands?.commands) {
                    delete appCommands.commands[fullId];
                }
                this.registeredCategoryCommandIds.delete(oldId);
            }
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
        let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(viewType)[0] ?? null;

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
            void workspace.revealLeaf(leaf);
        }

        return leaf;
    }


}
