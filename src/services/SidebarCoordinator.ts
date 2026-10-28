import { App, ItemView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_SIDEBAR, VIEW_TYPE_MAIN, VIEW_TYPE_DETAIL, CategoryInfo, EventName } from "../types";
import { FluentTasksSettings } from "../settings";
import { EventBus } from "../EventBus";
import { isQuickListHotkeyAssigned } from "../utils/hotkeyUtils";
import { t } from "../lang/helpers";

export interface ISidebarPluginHost {
    app: App;
    settings: FluentTasksSettings;
    activateView(viewType: string, position: "left" | "center" | "right"): Promise<WorkspaceLeaf | null>;
    getActiveCenterCategory(): CategoryInfo | null;
}

export class SidebarCoordinator {
    private host: ISidebarPluginHost;

    private isUserClosingSidebar = false;
    private suppressAutoExpandSidebarUntil = 0;
    private _isSidebarTemporarilyExpandedForDrag = false;
    private dragEndCollapseTimeout: number | null = null;
    private lastSidebarLocateTime = 0;
    private activeSafetyCleanup: (() => void) | null = null;

    get isSidebarTemporarilyExpandedForDrag(): boolean {
        return this._isSidebarTemporarilyExpandedForDrag;
    }

    constructor(host: ISidebarPluginHost) {
        this.host = host;
    }

    /**
     * Register workspace active-leaf-change and Ctrl+B listeners.
     * Uses plugin.registerEvent and plugin.registerDomEvent so Obsidian
     * automatically cleans them up on plugin unload.
     */
    registerEventListeners(plugin: Plugin): void {
        let lastActiveViewType = this.host.app.workspace.getActiveViewOfType(ItemView)?.getViewType() || "";

        plugin.registerEvent(
            this.host.app.workspace.on("active-leaf-change", (leaf) => {
                if (!leaf || !leaf.view) return;
                const currentType = leaf.view.getViewType();

                const isPluginView = currentType === VIEW_TYPE_MAIN || 
                                     currentType === VIEW_TYPE_SIDEBAR || 
                                     currentType === VIEW_TYPE_DETAIL;

                const wasPluginView = lastActiveViewType === VIEW_TYPE_MAIN || 
                                      lastActiveViewType === VIEW_TYPE_SIDEBAR || 
                                      lastActiveViewType === VIEW_TYPE_DETAIL;

                // When switching focus from an external tab (e.g. Markdown note via Ctrl+Tab / Ctrl+Shift+Tab) to Fluent Tasks
                if (isPluginView && !wasPluginView) {
                    if (this.host.settings.hideLeftSidebar && !this._isSidebarTemporarilyExpandedForDrag) {
                        const wasLeftActive = this.isPluginLeftSidebarActive();
                        this.host.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
                        const leftSplit = this.host.app.workspace.leftSplit as { collapsed?: boolean; collapse: () => void } | null;
                        if (leftSplit && !leftSplit.collapsed && wasLeftActive) {
                            leftSplit.collapse();
                        }
                    } else if (this.host.settings.autoExpandSidebar) {
                        if (!this.isUserClosingSidebar && Date.now() > this.suppressAutoExpandSidebarUntil) {
                            this.expandSidebarToList();
                        }
                    }
                }

                // When switching focus away from Fluent Tasks to an external tab (e.g. Markdown note, settings, etc.)
                if (!isPluginView && wasPluginView && (this.host.settings.autoCollapseSidebarOnSwitch ?? true)) {
                    const isInsideLeftSidebar = (leaf as any).getRoot?.() === this.host.app.workspace.leftSplit ||
                                                !!((leaf as any).containerEl?.closest?.('.mod-left-split') || leaf.view?.containerEl?.closest?.('.mod-left-split'));
                    const isInsideRightSidebar = (leaf as any).getRoot?.() === this.host.app.workspace.rightSplit ||
                                                 !!((leaf as any).containerEl?.closest?.('.mod-right-split') || leaf.view?.containerEl?.closest?.('.mod-right-split'));
                    this.collapseSidebars(0, false, !isInsideLeftSidebar, !isInsideRightSidebar);
                }

                lastActiveViewType = currentType;
            })
        );

        // Keyboard-driven sidebar toggle handling (Ctrl+B / Cmd+B)
        plugin.registerDomEvent(window, "keydown", (evt: KeyboardEvent) => {
            const isMod = (evt.ctrlKey || evt.metaKey) && !evt.shiftKey && !evt.altKey;
            const isB = evt.key === "b" || evt.key === "B" || evt.code === "KeyB";
            if (isMod && isB) {
                const leftSplit = this.host.app.workspace.leftSplit as any;
                const isCurrentlyCollapsed = !leftSplit || !!leftSplit.collapsed;

                if (!isCurrentlyCollapsed) {
                    // CASE 1: SIDEBAR IS CURRENTLY OPEN.
                    // User is pressing Ctrl+B to CLOSE it.
                    // Suppress auto-expand to guarantee it NEVER pops back open!
                    this.suppressAutoSidebarExpansion(3000);
                    this.isUserClosingSidebar = true;
                    window.setTimeout(() => {
                        this.isUserClosingSidebar = false;
                    }, 600);
                    // Let Obsidian's native app:toggle-left-sidebar command collapse it cleanly.
                    return;
                }

                // CASE 2: SIDEBAR IS CURRENTLY CLOSED.
                // User is pressing Ctrl+B to EXPAND it.
                if (!this.isPluginPageActive()) {
                    return; // Ordinary markdown note -> native Obsidian behavior only
                }

                // On Fluent Tasks page: let Obsidian expand it, then locate list after expand animation
                window.setTimeout(() => {
                    const currentLeftSplit = this.host.app.workspace.leftSplit as any;
                    if (currentLeftSplit && !currentLeftSplit.collapsed) {
                        this.locateActiveCategoryInSidebar();
                    }
                }, 150);
            }
        }, true);
    }

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
        const split = (position === "left" ? this.host.app.workspace.leftSplit : this.host.app.workspace.rightSplit) as {
            collapsed?: boolean;
            children?: any[];
        } | null;

        if (!split || split.collapsed) {
            return false;
        }

        const leaves = this.host.app.workspace.getLeavesOfType(viewType);
        if (leaves.length === 0) return false;

        for (const leaf of leaves) {
            // 1. Structural check via WorkspaceTabs parent and currentTab index
            const parent = (leaf as any).parent;
            if (parent && Array.isArray(parent.children)) {
                if (parent.children.length === 1 && parent.children[0] === leaf) {
                    return true;
                }
                const currentTabIdx = typeof parent.currentTab === "number" ? parent.currentTab : -1;
                if (currentTabIdx >= 0 && parent.children[currentTabIdx] === leaf) {
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
    collapseSidebars(suppressAutoExpandDurationMs = 0, force = false, targetLeft = true, targetRight = true): void {
        if (suppressAutoExpandDurationMs > 0) {
            this.suppressAutoSidebarExpansion(suppressAutoExpandDurationMs);
        }
        if (targetLeft) {
            const leftSplit = this.host.app.workspace.leftSplit as { collapsed?: boolean; collapse: () => void } | null;
            if (leftSplit && !leftSplit.collapsed && !this._isSidebarTemporarilyExpandedForDrag) {
                if (force || this.isPluginLeftSidebarActive()) {
                    leftSplit.collapse();
                }
            }
        }
        if (targetRight) {
            const rightSplit = this.host.app.workspace.rightSplit as { collapsed?: boolean; collapse: () => void } | null;
            if (rightSplit && !rightSplit.collapsed) {
                if (force || this.isPluginRightSidebarActive()) {
                    rightSplit.collapse();
                }
            }
        }
    }

    /**
     * Expand the left sidebar and reveal the Fluent Tasks sidebar list tab.
     */
    expandSidebarToList(): void {
        if (this.host.settings.hideLeftSidebar) return;
        const leftSplit = this.host.app.workspace.leftSplit as { collapsed?: boolean; expand: () => void } | null;
        if (leftSplit?.collapsed) {
            leftSplit.expand();
        }
        const sidebarLeaves = this.host.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);
        if (sidebarLeaves.length > 0) {
            void this.host.app.workspace.revealLeaf(sidebarLeaves[0]);
        } else {
            void this.host.activateView(VIEW_TYPE_SIDEBAR, "left");
        }
        window.setTimeout(() => {
            const currentLeftSplit = this.host.app.workspace.leftSplit as any;
            if (currentLeftSplit && !currentLeftSplit.collapsed) {
                this.locateActiveCategoryInSidebar();
            }
        }, 120);
    }

    /**
     * When hideLeftSidebar (Floating UI mode) or autoExpandSidebarOnDrag is enabled,
     * temporarily open the left sidebar when a task starts being dragged,
     * and locate/reveal the current category in the tree.
     * If the sidebar is already open and displaying Fluent Tasks sidebar,
     * do not open again, only locate the list.
     */
    async handleTaskDragStart(targetCategoryPath?: string): Promise<void> {
        const isEnabled = this.host.settings.hideLeftSidebar || this.host.settings.autoExpandSidebarOnDrag;
        if (!isEnabled) return;

        if (this.dragEndCollapseTimeout !== null) {
            window.clearTimeout(this.dragEndCollapseTimeout);
            this.dragEndCollapseTimeout = null;
        }

        const leftSplit = this.host.app.workspace.leftSplit as { collapsed?: boolean; expand: () => void; collapse: () => void } | null;
        const isAlreadyExpandedWithPlugin = !!(leftSplit && !leftSplit.collapsed && this.isPluginLeftSidebarActive());

        if (isAlreadyExpandedWithPlugin) {
            // Sidebar is already expanded and showing our plugin's sidebar!
            // No need to expand or mark for auto-collapse; just locate and reveal the list.
            this._isSidebarTemporarilyExpandedForDrag = false;
        } else {
            this._isSidebarTemporarilyExpandedForDrag = true;

            let sidebarLeaves = this.host.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);
            let sidebarLeaf = sidebarLeaves.length > 0 ? sidebarLeaves[0] : null;
            if (!sidebarLeaf) {
                sidebarLeaf = await this.host.activateView(VIEW_TYPE_SIDEBAR, "left");
            }

            if (leftSplit?.collapsed) {
                leftSplit.expand();
            }
            if (sidebarLeaf) {
                void this.host.app.workspace.revealLeaf(sidebarLeaf);
            }
        }

        const catPath = targetCategoryPath || this.host.getActiveCenterCategory()?.filepath;
        if (catPath) {
            window.setTimeout(() => {
                const currentLeaves = this.host.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);
                if (currentLeaves.length > 0) {
                    const sidebarView = currentLeaves[0].view as any;
                    if (typeof sidebarView?.getComponent === "function") {
                        void sidebarView.getComponent()?.locateAndRevealCategory(catPath);
                    }
                }
            }, 60);
        }

        if (this.activeSafetyCleanup) {
            this.activeSafetyCleanup();
        }

        const safetyCleanup = () => {
            window.removeEventListener("pointerup", safetyCleanup, true);
            window.removeEventListener("pointercancel", safetyCleanup, true);
            this.activeSafetyCleanup = null;
            this.handleTaskDragEnd();
        };
        this.activeSafetyCleanup = safetyCleanup;
        window.addEventListener("pointerup", safetyCleanup, { once: true, capture: true });
        window.addEventListener("pointercancel", safetyCleanup, { once: true, capture: true });
    }

    /**
     * When task dragging finishes, hide the temporarily opened left sidebar.
     */
    handleTaskDragEnd(): void {
        if (!this._isSidebarTemporarilyExpandedForDrag) return;
        this._isSidebarTemporarilyExpandedForDrag = false;

        if (this.dragEndCollapseTimeout !== null) {
            window.clearTimeout(this.dragEndCollapseTimeout);
        }

        this.dragEndCollapseTimeout = window.setTimeout(() => {
            this.dragEndCollapseTimeout = null;
            if (this._isSidebarTemporarilyExpandedForDrag) return;
            const leftSplit = this.host.app.workspace.leftSplit as { collapsed?: boolean; collapse: () => void } | null;
            if (leftSplit && !leftSplit.collapsed) {
                leftSplit.collapse();
            }
            if (this.host.settings.hideLeftSidebar) {
                this.host.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
            }
        }, 150);
    }

    /**
     * Check whether the active workspace focus or visible center leaf belongs to Fluent Tasks.
     */
    isPluginPageActive(): boolean {
        // 1. Check current active view type
        const activeType = this.host.app.workspace.getActiveViewOfType(ItemView)?.getViewType();
        if (activeType === VIEW_TYPE_MAIN || activeType === VIEW_TYPE_SIDEBAR || activeType === VIEW_TYPE_DETAIL) {
            return true;
        }

        // 2. Check if the center workspace visible leaf is VIEW_TYPE_MAIN
        const mainLeaves = this.host.app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
        for (const leaf of mainLeaves) {
            const el = leaf.view?.containerEl;
            if (el && el.offsetParent !== null) {
                return true;
            }
        }
        return false;
    }

    /**
     * Locate the active center category in the left sidebar tree.
     * MUST ONLY operate when the left sidebar is confirmed to be expanded.
     * NEVER forces sidebar expansion if the user collapsed it.
     */
    locateActiveCategoryInSidebar(): void {
        if (this.host.settings.hideLeftSidebar) return;
        const leftSplit = this.host.app.workspace.leftSplit as any;
        if (!leftSplit || leftSplit.collapsed) {
            return; // Safety guard: NEVER do anything if sidebar is collapsed!
        }

        const now = Date.now();
        if (now - this.lastSidebarLocateTime < 300) {
            return; // Prevent duplicate triggers within 300ms
        }
        this.lastSidebarLocateTime = now;

        if (!this.isPluginPageActive()) {
            return; // Only execute when working on Fluent Tasks page
        }

        const centerCat = this.host.getActiveCenterCategory();
        if (!centerCat) {
            return;
        }

        const sidebarLeaves = this.host.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);
        if (sidebarLeaves.length > 0) {
            const sidebarLeaf = sidebarLeaves[0];
            // If sidebar view is not currently the active tab in sidedock, switch to it without forcing expand:
            if (!this.isSidebarLeafActive(VIEW_TYPE_SIDEBAR, "left")) {
                void this.host.app.workspace.revealLeaf(sidebarLeaf);
            }
            const sidebarView = sidebarLeaf.view as any;
            if (typeof sidebarView?.getComponent === "function") {
                void sidebarView.getComponent()?.locateAndRevealCategory(centerCat.filepath);
            }
        }
    }

    /**
     * Handle Detail Modal Mode toggle: detaches right leaf and collapses right split if it was showing detail.
     */
    handleDetailModalModeEnabled(): void {
        const wasRightActive = this.isPluginRightSidebarActive();
        this.host.app.workspace.detachLeavesOfType(VIEW_TYPE_DETAIL);
        const rightSplit = this.host.app.workspace.rightSplit as { collapsed?: boolean; collapse: () => void } | null;
        if (rightSplit && !rightSplit.collapsed && wasRightActive) {
            rightSplit.collapse();
        }
    }

    /**
     * Handle Hide Left Sidebar setting toggle.
     */
    async handleHideLeftSidebarChanged(value: boolean): Promise<void> {
        if (value) {
            const wasLeftActive = this.isPluginLeftSidebarActive();
            this.host.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
            const leftSplit = this.host.app.workspace.leftSplit as { collapsed?: boolean; collapse: () => void } | null;
            if (leftSplit && !leftSplit.collapsed && wasLeftActive) {
                leftSplit.collapse();
            }
            if (!isQuickListHotkeyAssigned(this.host.app)) {
                new Notice(t("warn_bind_hotkey_notice") || "⚠️ [Fluent Tasks] 'Hide Left Sidebar' is enabled, but no hotkey is bound for the Floating UI! Please assign a hotkey in Settings -> Hotkeys.", 8000);
            }
        } else {
            await this.host.activateView(VIEW_TYPE_SIDEBAR, "left");
            const leftSplit = this.host.app.workspace.leftSplit as { collapsed?: boolean; expand: () => void } | null;
            if (leftSplit?.collapsed) {
                leftSplit.expand();
            }
        }
        EventBus.emit(EventName.SETTINGS_CHANGED, { settings: this.host.settings });
    }

    /**
     * Cleanup resources and pending timeouts on unload.
     */
    destroy(): void {
        if (this.dragEndCollapseTimeout !== null) {
            window.clearTimeout(this.dragEndCollapseTimeout);
            this.dragEndCollapseTimeout = null;
        }
        if (this.activeSafetyCleanup) {
            this.activeSafetyCleanup();
            this.activeSafetyCleanup = null;
        }
    }
}
