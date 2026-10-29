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

import { Plugin, ItemView, WorkspaceLeaf, TFile, Scope, App, ViewStateResult, Notice } from "obsidian";
import { VIEW_TYPE_SIDEBAR, VIEW_TYPE_MAIN, VIEW_TYPE_DETAIL, DATA_FOLDER, EventName, type CategoryInfo, type TaskItem, STARRED_CATEGORY_PATH } from "./types";
import { EventBus } from "./EventBus";
import { Logger } from "./Logger";
import { DataService } from "./DataService";
import TaskSidebarView from "./TaskSidebarView.svelte";
import TaskMainView from "./TaskMainView.svelte";
import TaskDetailView from "./TaskDetailView.svelte";
import UndoToastContainer from "./UndoToastContainer.svelte";
import HistoryToastContainer from "./components/HistoryToastContainer.svelte";
import { HistoryService } from "./services/HistoryService";
import { FluentTasksSettings, DEFAULT_SETTINGS, FluentTasksSettingTab } from "./settings";
import { TaskSearchModal } from "./TaskSearchModal";
import { QuickTaskModal } from "./modals/QuickTaskModal";
import { QuickListModal } from "./modals/QuickListModal";
import { TaskDetailModal } from "./modals/TaskDetailModal";
import { BackupModal } from "./modals/BackupModal";
import { BackupService } from "./services/BackupService";
import { getTodayLocalDateString } from "./utils/timeUtils";
import { t } from "./lang/helpers";
import { LinkedNoteService } from "./services/LinkedNoteService";
import { isQuickListHotkeyAssigned, openHotkeySettingsForQuickList } from "./utils/hotkeyUtils";
import { SidebarCoordinator, type ISidebarPluginHost } from "./services/SidebarCoordinator";
import "./styles.css";

// =============================================
// Svelte View Wrappers (Obsidian ItemView → Svelte)
// =============================================

interface TaskSidebarViewComponent extends TaskSidebarView {
    triggerRenameHoveredOrActive: () => boolean;
    locateAndRevealCategory: (filepath: string) => Promise<boolean>;
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
    navigateBack: () => Promise<boolean>;
    navigateForward: () => Promise<boolean>;
    toggleMultiSelect: () => void;
    openBackupModal: () => void;
    openSearch?: () => void;
    closeSearch?: () => void;
    toggleSearch?: () => void;
    startRenameCategory: () => void;
    cancelRenameCategory: () => void;
    isHoveringOrFocusedCategoryTitle: () => boolean;
    toggleStarByTaskId: (taskId: string) => Promise<void>;
    applySettingsUpdate: (settings?: any) => void;
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

        this.scope = new Scope(this.app.scope);
        this.scope.register(["Mod"], "f", (evt) => {
            if (this.component?.openSearch) {
                this.component.openSearch();
                evt.preventDefault();
                return false;
            }
        });
        this.scope.register([], "F2", (evt) => {
            if (this.component?.isHoveringOrFocusedCategoryTitle?.()) {
                this.component.startRenameCategory?.();
                evt.preventDefault();
                return false;
            }
        });
        this.scope.register(["Alt"], "ArrowLeft", (evt) => {
            if (evt.repeat) return false;
            if (this.component?.navigateBack) {
                void this.component.navigateBack();
                evt.preventDefault();
                return false;
            }
        });
        this.scope.register(["Alt"], "ArrowRight", (evt) => {
            if (evt.repeat) return false;
            if (this.component?.navigateForward) {
                void this.component.navigateForward();
                evt.preventDefault();
                return false;
            }
        });
    }

    getViewType(): string { return VIEW_TYPE_MAIN; }
    
    getDisplayText(): string {
        const cat = this.component?.getCurrentCategory();
        if (this.plugin?.settings?.showListTitleInHeader && cat?.name) {
            return cat.filepath === STARRED_CATEGORY_PATH ? `★ ${cat.name}` : cat.name;
        }
        return "Tasks";
    }

    getHeaderTitleEl(): HTMLElement | null {
        const leafEl = (this.leaf as any).containerEl as HTMLElement | undefined;
        return ((this as any).titleEl as HTMLElement | null)
            || this.containerEl?.querySelector<HTMLElement>(".view-header-title")
            || ((this.leaf as any).viewHeaderEl?.querySelector(".view-header-title") as HTMLElement | null)
            || leafEl?.querySelector<HTMLElement>(".view-header-title")
            || (this.containerEl?.parentElement?.querySelector<HTMLElement>(".view-header-title") ?? null);
    }

    updateHeaderTitle(): void {
        const enabled = Boolean(this.plugin?.settings?.showListTitleInHeader);
        const leafEl = (this.leaf as any).containerEl as HTMLElement | undefined;
        leafEl?.toggleClass("has-fluent-tasks-header-title", enabled);

        const headerTitleEl = this.getHeaderTitleEl();
        const cat = this.component?.getCurrentCategory();
        if (headerTitleEl) {
            if (enabled && cat?.name) {
                const titleText = cat.filepath === STARRED_CATEGORY_PATH ? `★ ${cat.name}` : cat.name;
                headerTitleEl.textContent = titleText;
                headerTitleEl.setAttribute("title", t("rename_list_tooltip") || "Click to rename list");
                headerTitleEl.setCssStyles({ cursor: "pointer" });
            } else {
                headerTitleEl.textContent = "Tasks";
                headerTitleEl.removeAttribute("title");
                headerTitleEl.setCssStyles({ cursor: "" });
            }
        }

        (this.leaf as any).updateHeader?.();
    }

    updateHeaderStyle(): void {
        this.updateHeaderTitle();
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
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();

        // Native capture-phase keydown listener on the main view container element
        this.containerEl.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (evt.key === "F2") {
                if (this.component?.isHoveringOrFocusedCategoryTitle?.()) {
                    this.component.startRenameCategory?.();
                    evt.preventDefault();
                    evt.stopPropagation();
                }
            }
        }, true);

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

        this.updateHeaderTitle();
        setTimeout(() => {
            this.updateHeaderTitle();
            const headerTitleEl = this.getHeaderTitleEl();
            if (headerTitleEl && !(headerTitleEl as any).__fluent_click_registered) {
                (headerTitleEl as any).__fluent_click_registered = true;
                this.registerDomEvent(headerTitleEl, "click", () => {
                    if (this.plugin?.settings?.showListTitleInHeader) {
                        this.component?.startRenameCategory?.();
                    }
                });
            }
        }, 50);
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

export default class FluentTasksPlugin extends Plugin implements ISidebarPluginHost {
    private dataService!: DataService;
    private ribbonIconEl: HTMLElement | null = null;
    settings: FluentTasksSettings = Object.assign({}, DEFAULT_SETTINGS);
    public activeDetailModal: TaskDetailModal | null = null;
    public lastSelectedTask?: TaskItem;
    public lastSelectedCategoryFilepath?: string;
    public sidebarCoordinator!: SidebarCoordinator;
    private undoContainerEl: HTMLElement | null = null;
    private undoToastComponent: UndoToastContainer | null = null;
    public historyService!: HistoryService;
    private historyToastContainerEl: HTMLElement | null = null;
    private historyToastComponent: HistoryToastContainer | null = null;

    get isSidebarTemporarilyExpandedForDrag(): boolean {
        return this.sidebarCoordinator?.isSidebarTemporarilyExpandedForDrag ?? false;
    }

    openTaskDetailModal(task?: TaskItem, categoryFilepath?: string): void {
        if (task && categoryFilepath) {
            this.lastSelectedTask = task;
            this.lastSelectedCategoryFilepath = categoryFilepath;
        }

        if (this.activeDetailModal) {
            if (task && categoryFilepath) {
                this.activeDetailModal.loadTask(task, categoryFilepath);
            }
            return;
        }

        const targetTask = task || this.lastSelectedTask;
        const targetPath = categoryFilepath || this.lastSelectedCategoryFilepath;

        this.activeDetailModal = new TaskDetailModal(
            this.app,
            this,
            this.dataService,
            targetTask,
            targetPath
        );
        this.activeDetailModal.open();
    }

    toggleStarOnHoveredTask(): void {
        const hovered = (window as any).__fluent_tasks_hovered_task;
        if (hovered && typeof hovered.toggle === "function") {
            void hovered.toggle();
            return;
        }

        // Fallback: check DOM hover state
        const hoveredTaskEl = document.querySelector(".task-item:hover, .quick-modal-task-item:hover");
        if (hoveredTaskEl) {
            const taskIdAttr = hoveredTaskEl.id || "";
            const taskId = taskIdAttr.replace(/^task-/, "");
            if (taskId) {
                const mainLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN)[0];
                if (mainLeaf && mainLeaf.view instanceof TaskMainViewWrapper) {
                    const comp = mainLeaf.view.getComponent();
                    if (comp?.toggleStarByTaskId) {
                        void comp.toggleStarByTaskId(taskId);
                        return;
                    }
                }
            }
        }
    }

    handleDetailModalModeEnabled(): void {
        this.sidebarCoordinator.handleDetailModalModeEnabled();
    }

    async handleHideLeftSidebarChanged(value: boolean): Promise<void> {
        await this.sidebarCoordinator.handleHideLeftSidebarChanged(value);
    }

    async onload(): Promise<void> {
        // Synchronous initialization before any async awaits
        this.dataService = new DataService(this.app);
        this.sidebarCoordinator = new SidebarCoordinator(this);
        this.addSettingTab(new FluentTasksSettingTab(this.app, this));

        Logger.init(this.app);
        void Logger.log("Fluent Tasks plugin loading...");

        await this.loadSettings();

        // Register all three view types (must be synchronous, before layout ready)
        this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new TaskSidebarViewWrapper(leaf, this.dataService, this));
        this.registerView(VIEW_TYPE_MAIN, (leaf) => new TaskMainViewWrapper(leaf, this.dataService, this));
        this.registerView(VIEW_TYPE_DETAIL, (leaf) => new TaskDetailViewWrapper(leaf, this.dataService, this));

        // Mount global Undo Toast container to document.body
        this.undoContainerEl = document.body.createDiv({ cls: "fluent-tasks-undo-root" });
        this.undoToastComponent = new UndoToastContainer({
            target: this.undoContainerEl,
            props: {
                plugin: this,
                dataService: this.dataService,
            },
        });

        // Initialize Action History Service (Undo / Redo) and top-right Toast container
        this.historyService = new HistoryService(this.app, this.dataService, this);
        this.dataService.setHistoryService(this.historyService);

        this.historyToastContainerEl = document.body.createDiv({ cls: "fluent-tasks-history-root" });
        this.historyToastComponent = new HistoryToastContainer({
            target: this.historyToastContainerEl,
        });
        this.historyService.setToastComponent(this.historyToastComponent);

        // Global capture-phase shortcut listener for Ctrl+Z and Ctrl+Y when focused on fluent-tasks
        this.registerDomEvent(window, "keydown", (e: KeyboardEvent) => {
            const isCtrlOrMeta = e.ctrlKey || e.metaKey;
            if (!isCtrlOrMeta || e.altKey) return;

            const isUndo = (e.key === "z" || e.key === "Z") && !e.shiftKey;
            const isRedo = (e.key === "y" || e.key === "Y") || ((e.key === "z" || e.key === "Z") && e.shiftKey);

            if (!isUndo && !isRedo) return;

            if (!this.isFluentTasksFocused()) {
                return;
            }

            if (this.isUserActivelyTyping()) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            if (isUndo) {
                void this.historyService.undo();
            } else {
                void this.historyService.redo();
            }
        }, true);

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
            callback: () => {
                if (this.settings.openDetailInModal) {
                    this.openTaskDetailModal();
                } else {
                    void this.activateView(VIEW_TYPE_DETAIL, "right");
                }
            },
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
                if (mainLeaf && mainLeaf.view instanceof TaskMainViewWrapper) {
                    const comp = mainLeaf.view.getComponent();
                    if (comp?.openSearch) {
                        comp.openSearch();
                        return;
                    }
                }
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
                const mainLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
                for (const leaf of mainLeaves) {
                    if (leaf.view instanceof TaskMainViewWrapper) {
                        const comp = leaf.view.getComponent();
                        if (comp?.isHoveringOrFocusedCategoryTitle?.()) {
                            comp.startRenameCategory?.();
                            return;
                        }
                    }
                }
                const sidebarLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0];
                if (sidebarLeaf && sidebarLeaf.view instanceof TaskSidebarViewWrapper) {
                    sidebarLeaf.view.getComponent()?.triggerRenameHoveredOrActive();
                } else {
                    EventBus.emit(EventName.TRIGGER_SIDEBAR_RENAME, {});
                }
            },
        });

        this.addCommand({
            id: "open-quick-list-modal",
            name: "Open Quick List Modal (List only) (Recommended)",
            callback: () => {
                new QuickListModal(this.app, this, this.dataService).open();
            },
        });

        this.addCommand({
            id: "open-quick-task-modal",
            name: "Open Quick Task Modal (Experimental)",
            callback: () => {
                new QuickTaskModal(this.app, this, this.dataService).open();
            },
        });

        this.addCommand({
            id: "open-backup-modal",
            name: t("cmd_backup_manager"),
            callback: () => {
                new BackupModal(this.app, this, this.dataService).open();
            },
        });

        this.addCommand({
            id: "toggle-task-star-hover",
            name: "Toggle star on hovered task",
            callback: () => {
                this.toggleStarOnHoveredTask();
            },
        });

        this.addCommand({
            id: "navigate-list-back",
            name: "Navigate to previous list (Back)",
            checkCallback: (checking: boolean) => {
                const mainLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
                if (mainLeaves.length > 0) {
                    if (!checking) {
                        const comp = (mainLeaves[0].view as any).getComponent?.() as TaskMainViewComponent | undefined;
                        void comp?.navigateBack?.();
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: "navigate-list-forward",
            name: "Navigate to next list (Forward)",
            checkCallback: (checking: boolean) => {
                const mainLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
                if (mainLeaves.length > 0) {
                    if (!checking) {
                        const comp = (mainLeaves[0].view as any).getComponent?.() as TaskMainViewComponent | undefined;
                        void comp?.navigateForward?.();
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: "undo-action",
            name: "Undo last task action",
            checkCallback: (checking: boolean) => {
                if (checking) return this.isFluentTasksFocused();
                void this.historyService?.undo();
                return true;
            },
        });

        this.addCommand({
            id: "redo-action",
            name: "Redo last task action",
            checkCallback: (checking: boolean) => {
                if (checking) return this.isFluentTasksFocused();
                void this.historyService?.redo();
                return true;
            },
        });

        // FIX: All workspace/vault operations MUST wait until layout is ready.
        // Running them before this causes silent startup crashes on Obsidian boot.
        this.app.workspace.onLayoutReady(() => {
            void (async () => {
                await this.dataService.ensureDataFolder();

                await this.loadSettings();
                this.applySettings();

                if (this.settings.hideLeftSidebar) {
                    const wasLeftActive = this.isPluginLeftSidebarActive();
                    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
                    const leftSplit = this.app.workspace.leftSplit as { collapsed?: boolean; collapse: () => void } | null;
                    if (leftSplit && !leftSplit.collapsed && wasLeftActive) {
                        leftSplit.collapse();
                    }
                }

                // Check and run daily backup if enabled
                await BackupService.checkAndRunDailyBackup(this.app, this);

                // Auto-migrate legacy linked notes (replace taskId frontmatter with title and rename to <Category> <taskId>.md)
                void LinkedNoteService.migrateOldLinkedNotes(this.app, this.dataService).then((res) => {
                    if (res.migratedCount > 0) {
                        void Logger.log(`[LinkedNote] Auto-migrated ${res.migratedCount} legacy linked note(s):`, res.details);
                    }
                });

                // Register coordinated sidebar events (active-leaf-change, Ctrl+B)
                this.sidebarCoordinator.registerEventListeners(this);

            const isCategoryFile = (path?: string) => {
                if (!path || !path.startsWith(DATA_FOLDER + "/") || !path.endsWith(".md")) return false;
                const relPath = path.slice(DATA_FOLDER.length + 1);
                return !relPath.includes("/") && !relPath.includes("\\");
            };

            // Listen for external file modifications (AI, sync, external editors)
            this.registerEvent(
                this.app.vault.on("modify", (file) => {
                    if (!file || !(file instanceof TFile)) return;
                    if (isCategoryFile(file.path)) {
                        if (this.dataService.isInternalWrite(file.path)) {
                            return; // Skip self-generated optimistic writes
                        }
                        EventBus.emit(EventName.TASK_UPDATED, {
                            categoryFilepath: file.path,
                            isExternal: true,
                        });
                    } else if (file.path.startsWith(DATA_FOLDER + "/") && file.extension === "md") {
                        if (!this.dataService.isInternalWrite(file.path)) {
                            void LinkedNoteService.syncNotePropertyToTask(this.app, this.dataService, file);
                        }
                    }
                })
            );

            this.registerEvent(
                this.app.metadataCache.on("changed", (file) => {
                    if (file instanceof TFile && file.path.startsWith(DATA_FOLDER + "/") && file.extension === "md" && !isCategoryFile(file.path)) {
                        if (!this.dataService.isInternalWrite(file.path)) {
                            void LinkedNoteService.syncNotePropertyToTask(this.app, this.dataService, file);
                        }
                    }
                })
            );

            // Listen for category creation, deletion, and renaming to update commands in real-time
            const handleCategoryVaultChange = (file: any) => {
                if (file && isCategoryFile(file.path)) {
                    void this.registerCategoryCommands();
                }
            };
            this.registerEvent(this.app.vault.on("create", handleCategoryVaultChange));
            this.registerEvent(this.app.vault.on("delete", handleCategoryVaultChange));
            this.registerEvent(
                this.app.vault.on("rename", (file, oldPath) => {
                    handleCategoryVaultChange(file);

                    // If a category list file was renamed externally
                    if (isCategoryFile(oldPath) && file && isCategoryFile(file.path)) {
                        void LinkedNoteService.handleCategoryRename(
                            this.app,
                            this.dataService,
                            oldPath,
                            file.path
                        );
                    }

                    // Hot-sync note rename to task if linked
                    if (file instanceof TFile && file.extension === "md") {
                        if (!LinkedNoteService.isInternalRename(oldPath, file.path)) {
                            void LinkedNoteService.syncNoteRenameToTasks(
                                this.app,
                                this.dataService,
                                oldPath,
                                file
                            );
                        }
                    }
                })
            );

            // Manage dynamic opening/closing of the detail view
            EventBus.on(EventName.DETAIL_CLOSE, () => {
                this.app.workspace.detachLeavesOfType(VIEW_TYPE_DETAIL);
            });

            EventBus.on(EventName.CATEGORY_SELECTED, (payload: unknown) => {
                const p = payload as { category?: CategoryInfo; fromHistory?: boolean } | null;
                const category = p?.category;
                if (category) {
                    void (async () => {
                        if (this.settings.openDetailInModal) {
                            if (this.activeDetailModal) {
                                this.activeDetailModal.close();
                            }
                            const wasRightActive = this.isPluginRightSidebarActive();
                            const rightSplit = this.app.workspace.rightSplit as { collapsed?: boolean; collapse: () => void } | null;
                            if (rightSplit && !rightSplit.collapsed && wasRightActive) {
                                rightSplit.collapse();
                            }
                        }

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
                    } else {
                        // Restore category UI state from history (prevents UI desync on back/forward)
                        const mainComponent = (mainLeaf.view as any).getComponent?.() as TaskMainViewComponent | undefined;
                        if (mainComponent) {
                            const cat: CategoryInfo = {
                                id: category.filepath,
                                type: "category",
                                name: category.name,
                                filepath: category.filepath
                            };
                            await mainComponent.loadCategory(cat);
                        }
                    }
                            void this.app.workspace.revealLeaf(mainLeaf);
                        }
                    })();
                }
            });

            EventBus.on(EventName.CATEGORY_RENAMED, (payload: unknown) => {
                const p = payload as { oldFilepath?: string; category?: CategoryInfo } | null;
                if (!p?.category || !p?.oldFilepath) return;

                if (this.settings.defaultQuickListFocusFilepath === p.oldFilepath) {
                    this.settings.defaultQuickListFocusFilepath = p.category.filepath;
                    void this.saveSettings();
                }

                const mainLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
                for (const leaf of mainLeaves) {
                    if (leaf.view instanceof TaskMainViewWrapper) {
                        const comp = leaf.view.getComponent();
                        const cur = comp?.getCurrentCategory();
                        if (cur && (cur.filepath === p.oldFilepath || cur.id === p.oldFilepath)) {
                            void leaf.setViewState({
                                type: VIEW_TYPE_MAIN,
                                state: {
                                    categoryFilepath: p.category.filepath,
                                    categoryName: p.category.name,
                                },
                                active: true,
                            });
                            (leaf as any).updateHeader?.();
                        }
                    }
                }
            });

            EventBus.on(EventName.TASK_SELECTED, (payload: unknown) => {
                const p = payload as { task: TaskItem; categoryFilepath: string; skipModal?: boolean } | null;
                if (!p) return;
                this.lastSelectedTask = p.task;
                this.lastSelectedCategoryFilepath = p.categoryFilepath;

                void (async () => {
                    if (this.settings.openDetailInModal) {
                        if (p.skipModal) {
                            if (this.activeDetailModal) {
                                this.activeDetailModal.loadTask(p.task, p.categoryFilepath);
                            }
                            return;
                        }
                        const wasRightActive = this.isPluginRightSidebarActive();
                        const rightSplit = this.app.workspace.rightSplit as { collapsed?: boolean; collapse: () => void } | null;
                        if (rightSplit && !rightSplit.collapsed && wasRightActive) {
                            rightSplit.collapse();
                        }
                        this.openTaskDetailModal(p.task, p.categoryFilepath);
                        return;
                    }

                    // If user is currently editing an external file (e.g. Markdown note) and not on Fluent Tasks,
                    // update task in the background without popping open or expanding the right sidebar
                    if (!this.isPluginPageActive()) {
                        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DETAIL);
                        if (leaves.length > 0 && leaves[0].view instanceof TaskDetailViewWrapper) {
                            leaves[0].view.getComponent()?.loadTask(p.task, p.categoryFilepath);
                        }
                        return;
                    }

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
            if (this.settings.openDetailInModal) {
                this.handleDetailModalModeEnabled();
            }

            const needsMain = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN).length === 0;
            const needsSidebar = !this.settings.hideLeftSidebar && this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR).length === 0;
            if (needsMain || needsSidebar) {
                await this.activateAllViews();
            }

            await this.registerCategoryCommands();

            EventBus.on(EventName.CATEGORY_LIST_CHANGED, () => {
                void this.registerCategoryCommands();
            });

            // 1. Immediate recurring tasks rollover check on startup (force=true)
            void this.checkRecurringTasksRollover(true);

            // 2. Schedule recurring tasks check every 10 seconds ("每大概10s检查一下到没到明天")
            this.registerInterval(
                window.setInterval(() => {
                    void this.checkRecurringTasksRollover();
                }, 10000)
            );

            // 3. Check on window focus (when switching back to Obsidian)
            this.registerDomEvent(window, "focus", () => {
                void this.checkRecurringTasksRollover();
            });

            void Logger.log("Fluent Tasks plugin loaded successfully.");
            })();
        });
    }

    private isRollingOver = false;
    private lastRolloverDate = "";

    /** Check and rollover any recurring tasks whose new day has arrived or due date has passed ("过了就要重置时间到当天！") */
    async checkRecurringTasksRollover(force = false): Promise<void> {
        if (this.isRollingOver) return;

        const todayStr = getTodayLocalDateString();
        // Zero-overhead guard: skip redundant vault disk I/O if calendar day has not rolled over
        if (!force && this.lastRolloverDate === todayStr) {
            return;
        }

        this.isRollingOver = true;
        try {
            const anyChanged = await this.dataService.rolloverRecurringTasks();
            this.lastRolloverDate = todayStr;
            if (anyChanged) {
                void Logger.log("[Recurrence] Background rollover applied. Notifying views.");
                EventBus.emit(EventName.TASK_UPDATED, { isExternal: true });
            }
        } catch (err) {
            void Logger.log("Error during recurring task rollover:", err);
        } finally {
            this.isRollingOver = false;
        }
    }

    onunload(): void {
        if (this.undoToastComponent) {
            this.undoToastComponent.$destroy();
            this.undoToastComponent = null;
        }
        if (this.undoContainerEl) {
            this.undoContainerEl.remove();
            this.undoContainerEl = null;
        }

        if (this.historyToastComponent) {
            this.historyToastComponent.$destroy();
            this.historyToastComponent = null;
        }
        if (this.historyToastContainerEl) {
            this.historyToastContainerEl.remove();
            this.historyToastContainerEl = null;
        }
        if (this.historyService) {
            this.historyService.destroy();
        }

        if (this.ribbonIconEl) {
            this.ribbonIconEl.remove();
            this.ribbonIconEl = null;
        }

        // Clean up sidebar coordinator
        this.sidebarCoordinator?.destroy();

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
        if ((this.settings as any).disableStars !== undefined && this.settings.hiddenStarMode === undefined) {
            this.settings.hiddenStarMode = (this.settings as any).disableStars;
        }
        this.settings.disableStars = this.settings.hiddenStarMode;
    }

    async saveSettings() {
        this.settings.disableStars = this.settings.hiddenStarMode;
        await this.saveData(this.settings);
        EventBus.emit(EventName.SETTINGS_CHANGED, { settings: this.settings });

        // Direct notification to all active main view leaves for instant reactivity
        const mainLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
        for (const leaf of mainLeaves) {
            (leaf as any).updateHeader?.();
            if (leaf.view instanceof TaskMainViewWrapper) {
                leaf.view.updateHeaderStyle();
                const comp = leaf.view.getComponent();
                comp?.applySettingsUpdate?.(this.settings);
            }
        }

        if (this.activeDetailModal) {
            this.activeDetailModal.setCenterAligned(this.settings.centerAlignTasks ?? true);
        }
    }

    applySettings() {
        document.body.setCssProps({
            "--todo-accent": this.settings.accentColor,
            "--todo-accent-glow": `${this.settings.accentColor}99`,
            "--todo-accent-light": `${this.settings.accentColor}26`,
            "--todo-star": this.settings.accentColor,
            "--todo-star-light": `${this.settings.accentColor}26`,
            "--todo-star-border": `${this.settings.accentColor}4d`,
        });
    }

    // =============================================
    // Sidebar Delegation (Delegates to SidebarCoordinator)
    // =============================================

    suppressAutoSidebarExpansion(durationMs = 1200): void {
        this.sidebarCoordinator.suppressAutoSidebarExpansion(durationMs);
    }

    isSidebarLeafActive(viewType: string, position: "left" | "right"): boolean {
        return this.sidebarCoordinator.isSidebarLeafActive(viewType, position);
    }

    isPluginLeftSidebarActive(): boolean {
        return this.sidebarCoordinator.isPluginLeftSidebarActive();
    }

    isPluginRightSidebarActive(): boolean {
        return this.sidebarCoordinator.isPluginRightSidebarActive();
    }

    collapseSidebars(suppressAutoExpandDurationMs = 0, force = false, targetLeft = true, targetRight = true): void {
        this.sidebarCoordinator.collapseSidebars(suppressAutoExpandDurationMs, force, targetLeft, targetRight);
    }

    expandSidebarToList(): void {
        this.sidebarCoordinator.expandSidebarToList();
    }

    async handleTaskDragStart(targetCategoryPath?: string): Promise<void> {
        await this.sidebarCoordinator.handleTaskDragStart(targetCategoryPath);
    }

    handleTaskDragEnd(): void {
        this.sidebarCoordinator.handleTaskDragEnd();
    }

    isPluginPageActive(): boolean {
        return this.sidebarCoordinator.isPluginPageActive();
    }

    locateActiveCategoryInSidebar(): void {
        this.sidebarCoordinator.locateActiveCategoryInSidebar();
    }

    /**
     * Get the CategoryInfo currently displayed in the center main view.
     */
    getActiveCenterCategory(): CategoryInfo | null {
        const mainLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
        for (const leaf of mainLeaves) {
            if (leaf.view instanceof TaskMainViewWrapper) {
                const el = leaf.view.containerEl;
                const comp = leaf.view.getComponent();
                const cat = comp?.getCurrentCategory();
                if (cat && (!el || el.offsetParent !== null)) {
                    return cat;
                }
            }
        }
        for (const leaf of mainLeaves) {
            if (leaf.view instanceof TaskMainViewWrapper) {
                const cat = leaf.view.getComponent()?.getCurrentCategory();
                if (cat) return cat;
            }
        }
        return null;
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
                        this.collapseSidebars(1500);
                        await this.activateView(VIEW_TYPE_MAIN, "center");
                        EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat, focusInput: true });
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
        if (!this.settings.hideLeftSidebar) {
            await this.activateView(VIEW_TYPE_SIDEBAR, "left");
        } else {
            const wasLeftActive = this.isPluginLeftSidebarActive();
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
            const leftSplit = this.app.workspace.leftSplit as { collapsed?: boolean; collapse: () => void } | null;
            if (leftSplit && !leftSplit.collapsed && wasLeftActive) {
                leftSplit.collapse();
            }
        }
        await this.activateView(VIEW_TYPE_MAIN, "center");
        if (!this.settings.openDetailInModal) {
            await this.activateView(VIEW_TYPE_DETAIL, "right");
        }
    }

    /**
     * Activate a specific view in the designated position.
     * Handles: finding existing leaves, creating new ones, and revealing.
     */
    async activateView(
        viewType: string,
        position: "left" | "center" | "right"
    ): Promise<WorkspaceLeaf | null> {
        if (viewType === VIEW_TYPE_SIDEBAR && this.settings.hideLeftSidebar && !this.isSidebarTemporarilyExpandedForDrag) {
            return null;
        }
        if (viewType === VIEW_TYPE_DETAIL && this.settings.openDetailInModal) {
            return null;
        }

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

    isFluentTasksFocused(): boolean {
        const activeEl = document.activeElement;

        // 1. If Obsidian core prompt, command palette, or settings is open and has focus, NOT fluent-tasks
        if (activeEl?.closest(".prompt, .mod-settings")) {
            return false;
        }

        // 2. Check if a fluent-tasks modal is currently active
        const fluentModal = activeEl?.closest(
            ".task-detail-floating-modal, .task-steps-floating-modal, .quick-list-modal, .quick-task-modal, .task-focused-lists-modal, .task-backup-modal, .fluent-tasks-lightbox"
        );
        if (fluentModal) {
            return true;
        }

        // 3. If any standard modal is open, NOT fluent-tasks
        if (activeEl?.closest(".modal")) {
            return false;
        }

        // 4. Check if activeElement is explicitly in a Markdown editor or other note leaf
        if (activeEl?.closest(".cm-editor, .markdown-source-view, .markdown-rendered")) {
            return false;
        }

        // 5. Check if activeElement is explicitly inside a fluent-tasks view DOM container
        if (activeEl?.closest(".sidebar-container, .main-container, .detail-container, .fluent-tasks-view, .has-fluent-tasks-header-title")) {
            return true;
        }

        // 6. Check active leaf view type
        const activeLeaf = this.app.workspace.activeLeaf;
        if (!activeLeaf || !activeLeaf.view) {
            return false;
        }

        const viewType = activeLeaf.view.getViewType();
        const isOurLeaf = viewType === VIEW_TYPE_MAIN || viewType === VIEW_TYPE_SIDEBAR || viewType === VIEW_TYPE_DETAIL;
        if (!isOurLeaf) {
            return false;
        }

        // If activeLeaf is our leaf, make sure activeElement is not inside another leaf (e.g. split pane note)
        if (activeEl && activeEl !== document.body) {
            const otherLeaf = activeEl.closest(".workspace-leaf");
            const ourLeafEl = (activeLeaf as any).containerEl as HTMLElement | undefined;
            if (otherLeaf && ourLeafEl && otherLeaf !== ourLeafEl) {
                return false;
            }
        }

        return true;
    }

    isUserActivelyTyping(): boolean {
        const el = document.activeElement;
        if (!el) return false;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            if (el.type === "checkbox" || el.type === "radio" || el.type === "button" || el.type === "submit") {
                return false;
            }
            // Allow native undo inside the input if there is text being edited
            if (el.value.length > 0) {
                return true;
            }
            return false;
        }
        if ((el as HTMLElement).isContentEditable) {
            return true;
        }
        return false;
    }
}
