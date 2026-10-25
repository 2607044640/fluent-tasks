<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, type SidebarItem, type CategoryInfo, type GroupInfo, DATA_FOLDER, STARRED_CATEGORY_PATH, STARRED_CATEGORY_NAME } from "./types";
    import { killDndGhostElement, injectDndGhostShield, removeDndGhostShield } from "./utils/dndUtils";
    import { moveSidebarItem, moveListToGroupOrRoot, deleteGroupFromTree } from "./utils/sidebarTreeUtils";
    import { INPUT_FOCUS_DELAY_MS, BLUR_CONFIRM_DELAY_MS, DND_SHIELD_REMOVAL_DELAY_MS, DND_RESCUE_DELAY_MS } from "./constants";
    import { Menu, Notice, type App, type TAbstractFile, type EventRef } from "obsidian";
    import { TaskSearchModal } from "./TaskSearchModal";

    // =============================================
    // Props
    // =============================================
    export let app: App;
    export let dataService: DataService;
    export let plugin: any;

    // =============================================
    // State
    // =============================================
    let sidebarItems: SidebarItem[] = [];
    let activeCategoryPath: string = "";
    let starredCount: number = 0;
    let dragOverPath: string = ""; // For task dragging
    let draggedItemId: string = ""; // For HTML5 DnD
    let dragOverId: string = ""; // For HTML5 DnD
    let dragPosition: "top" | "bottom" | "inside" | null = null; // For HTML5 DnD
    
    let isAddingList: boolean = false;
    let newListName: string = "";
    
    let isAddingGroup: boolean = false;
    let newGroupName: string = "";

    // Renaming state
    let hoveredItem: { type: "category" | "group"; id: string; name: string; filepath?: string } | null = null;
    let editingItemId: string | null = null;
    let editingItemType: "category" | "group" | null = null;
    let editingName: string = "";
    let editingOriginalName: string = "";
    let renameInputEl: HTMLInputElement | null = null;

    let vaultEventRefs: EventRef[] = [];

    // =============================================
    // Lifecycle
    // =============================================
    onMount(() => {
        app.workspace.onLayoutReady(async () => {
            await loadSidebarItems();

            const handleVaultChange = async (file: TAbstractFile) => {
                if (file && file.path && file.path.startsWith(DATA_FOLDER + "/") && file.path.endsWith(".md")) {
                    await loadSidebarItems();
                    // Check if the currently active category was deleted externally
                    const exists = sidebarItems.some(i => i.type === "category" && i.filepath === activeCategoryPath) ||
                                   sidebarItems.some(i => i.type === "group" && i.items.some(c => c.filepath === activeCategoryPath));
                    if (activeCategoryPath && !exists && activeCategoryPath !== STARRED_CATEGORY_PATH) {
                        activeCategoryPath = "";
                        EventBus.emit(EventName.CATEGORY_SELECTED, { category: null });
                    }
                    EventBus.emit(EventName.CATEGORY_LIST_CHANGED, {});
                }
            };

            vaultEventRefs.push(app.vault.on("create", handleVaultChange));
            vaultEventRefs.push(app.vault.on("delete", handleVaultChange));
            vaultEventRefs.push(app.vault.on("rename", handleVaultChange));
        });

        // Sync visual selection when category is selected externally (e.g. jump commands, search)
        EventBus.on(EventName.CATEGORY_SELECTED, handleExternalCategorySelected);
        EventBus.on(EventName.CATEGORY_LIST_CHANGED, handleExternalCategoryListChanged);
        EventBus.on(EventName.CATEGORY_RENAMED, handleCategoryRenamed);
        EventBus.on(EventName.TRIGGER_SIDEBAR_RENAME, handleTriggerRename);
        EventBus.on(EventName.REVEAL_SIDEBAR_CATEGORY, handleRevealSidebarCategory);
        EventBus.on(EventName.TASK_UPDATED, handleTaskChanged);
        EventBus.on(EventName.TASK_MOVED, handleTaskChanged);
        EventBus.on(EventName.TASK_DELETED, handleTaskChanged);
        EventBus.on(EventName.TASK_COMPLETED, handleTaskChanged);

        window.addEventListener("pointermove", handleGlobalPointerMove, true);
        window.addEventListener("pointerup", handleGlobalPointerUp, true);
        window.addEventListener("keydown", handleWindowKeydown, true);
        window.addEventListener("wheel", handleGlobalWheel, { capture: true, passive: false });
    });

    onDestroy(() => {
        stopSidebarAutoScroll();
        window.removeEventListener("pointermove", handleGlobalPointerMove, true);
        window.removeEventListener("pointerup", handleGlobalPointerUp, true);
        window.removeEventListener("keydown", handleWindowKeydown, true);
        window.removeEventListener("wheel", handleGlobalWheel, { capture: true });
        EventBus.off(EventName.CATEGORY_SELECTED, handleExternalCategorySelected);
        EventBus.off(EventName.CATEGORY_LIST_CHANGED, handleExternalCategoryListChanged);
        EventBus.off(EventName.CATEGORY_RENAMED, handleCategoryRenamed);
        EventBus.off(EventName.TRIGGER_SIDEBAR_RENAME, handleTriggerRename);
        EventBus.off(EventName.REVEAL_SIDEBAR_CATEGORY, handleRevealSidebarCategory);
        EventBus.off(EventName.TASK_UPDATED, handleTaskChanged);
        EventBus.off(EventName.TASK_MOVED, handleTaskChanged);
        EventBus.off(EventName.TASK_DELETED, handleTaskChanged);
        EventBus.off(EventName.TASK_COMPLETED, handleTaskChanged);
        vaultEventRefs.forEach(ref => app.vault.offref(ref));
    });

    function handleCategoryRenamed(payload: any) {
        if (!payload || !payload.category) return;
        if (activeCategoryPath === payload.oldFilepath) {
            activeCategoryPath = payload.category.filepath;
        }
        void loadSidebarItems();
    }

    function handleExternalCategorySelected(payload: any) {
        if (payload && payload.category) {
            activeCategoryPath = payload.category.filepath;
            if (payload.fromHistory) {
                setTimeout(() => {
                    const activeEl = document.querySelector(`.category-item[data-filepath="${CSS.escape(payload.category.filepath)}"]`);
                    activeEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }, 50);
            }
        } else {
            activeCategoryPath = "";
        }
    }

    async function handleExternalCategoryListChanged(payload?: any) {
        if (payload && Array.isArray(payload.sidebarItems)) {
            sidebarItems = payload.sidebarItems;
        } else {
            await loadSidebarItems();
        }
        await refreshStarredCount();
    }

    async function handleTaskChanged() {
        await refreshStarredCount();
    }

    async function refreshStarredCount() {
        try {
            starredCount = await dataService.getStarredCount();
        } catch (e) {
            console.error("[TaskSidebarView] Failed to refresh starred count:", e);
        }
    }

    async function loadSidebarItems() {
        sidebarItems = await dataService.getSidebarItems();
        await refreshStarredCount();
    }

    // =============================================
    // UI Actions
    // =============================================
    function selectCategory(cat: CategoryInfo) {
        activeCategoryPath = cat.filepath;
        EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat });
    }

    async function saveAndSyncSidebarState(newItems: SidebarItem[]) {
        sidebarItems = newItems;
        await dataService.saveSidebarState(newItems);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems: newItems });
    }

    function toggleGroup(group: SidebarItem) {
        if (group.type === "group") {
            const nextItems = sidebarItems.map(item => {
                if (item.id === group.id && item.type === "group") {
                    return {
                        ...item,
                        isExpanded: !item.isExpanded
                    };
                }
                return item;
            });
            saveAndSyncSidebarState(nextItems);
        }
    }

    // =============================================
    // Renaming Logic (F2 on Hover or Focus)
    // =============================================
    let sidebarContainerEl: HTMLElement | null = null;
    let customListsEl: HTMLElement | null = null;
    let isMouseInsideSidebar: boolean = false;
    let lastMouseX: number = 0;
    let lastMouseY: number = 0;
    let sidebarScrollAnimId: number | null = null;
    let sidebarScrollSpeed: number = 0;
    const AUTO_SCROLL_EDGE_ZONE = 70;
    const AUTO_SCROLL_MAX_SPEED = 14;

    function handleSidebarMouseEnter() {
        isMouseInsideSidebar = true;
    }

    function handleSidebarMouseLeave() {
        isMouseInsideSidebar = false;
        hoveredItem = null;
    }

    function isSidebarExpanded(): boolean {
        if (!sidebarContainerEl) return false;

        // 1. Check if parent split (leftSplit or rightSplit) is collapsed
        const leftSplit = (app.workspace as any)?.leftSplit;
        if (leftSplit) {
            const isInsideLeftSplit = !!sidebarContainerEl.closest('.mod-left-split');
            if (isInsideLeftSplit && leftSplit.collapsed === true) {
                return false;
            }
        }
        const rightSplit = (app.workspace as any)?.rightSplit;
        if (rightSplit) {
            const isInsideRightSplit = !!sidebarContainerEl.closest('.mod-right-split');
            if (isInsideRightSplit && rightSplit.collapsed === true) {
                return false;
            }
        }

        // 2. DOM dimension and visibility check
        if (sidebarContainerEl.offsetParent === null && !sidebarContainerEl.closest('.modal')) {
            return false;
        }
        const rect = sidebarContainerEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        return true;
    }

    function isSidebarFocused(): boolean {
        if (!sidebarContainerEl) return false;
        const active = document.activeElement;
        if (!active) return false;

        // Either active element is inside our sidebar container
        if (sidebarContainerEl.contains(active)) return true;

        // Or active element is inside the same workspace-leaf container
        const leafEl = sidebarContainerEl.closest('.workspace-leaf');
        if (leafEl && leafEl.contains(active)) return true;

        return false;
    }

    function setHoveredCategory(cat: CategoryInfo) {
        hoveredItem = { type: "category", id: cat.id, name: cat.name, filepath: cat.filepath };
    }

    function setHoveredGroup(group: SidebarItem) {
        hoveredItem = { type: "group", id: group.id, name: group.name };
    }

    function clearHoveredItem(id?: string) {
        if (!id || (hoveredItem && hoveredItem.id === id)) {
            hoveredItem = null;
        }
    }

    function getTargetFromElement(el: HTMLElement): { type: "category" | "group"; id: string; name: string; filepath?: string } | null {
        const catEl = el.closest(".category-item") as HTMLElement | null;
        if (catEl) {
            const filepath = catEl.dataset.filepath;
            const itemid = catEl.dataset.itemid;
            for (const item of sidebarItems) {
                if (item.id === itemid || (item.type === "category" && item.filepath === filepath)) {
                    return { type: "category", id: item.id, name: item.name, filepath: (item as CategoryInfo).filepath };
                }
                if (item.type === "group") {
                    const child = item.items.find(c => c.id === itemid || c.filepath === filepath);
                    if (child) {
                        return { type: "category", id: child.id, name: child.name, filepath: child.filepath };
                    }
                }
            }
        }

        const groupEl = el.closest(".group-header, .group-container") as HTMLElement | null;
        if (groupEl) {
            const groupid = groupEl.dataset.groupid || groupEl.dataset.itemid;
            const group = sidebarItems.find(i => i.id === groupid && i.type === "group");
            if (group) {
                return { type: "group", id: group.id, name: group.name };
            }
        }

        return null;
    }

    function getHoveredItemTarget(): { type: "category" | "group"; id: string; name: string; filepath?: string } | null {
        if (!sidebarContainerEl) return null;

        // 1. Direct hover tracking verified by mouse bounds / DOM hit
        const elUnderCursor = document.elementFromPoint(lastMouseX, lastMouseY);
        if (elUnderCursor && sidebarContainerEl.contains(elUnderCursor)) {
            const target = getTargetFromElement(elUnderCursor as HTMLElement);
            if (target) return target;
        }

        // 2. Query CSS :hover match strictly within sidebar container
        try {
            const hoveredEl = sidebarContainerEl.querySelector('.category-item:hover, .group-header:hover, .group-container:hover') as HTMLElement | null;
            if (hoveredEl) {
                const target = getTargetFromElement(hoveredEl);
                if (target) return target;
            }
        } catch {
            // Ignore if querySelector :hover fails in unusual environments
        }

        // 3. Fallback to hoveredItem only if mouse is confirmed to be inside the sidebar
        if (hoveredItem && isMouseInsideSidebar) {
            return hoveredItem;
        }

        return null;
    }

    export function triggerRenameHoveredOrActive(): boolean {
        if (editingItemId || isAddingList || isAddingGroup) return false;

        // Must be expanded (not collapsed)
        if (!isSidebarExpanded()) return false;

        // 1. Check if an item in the sidebar is hovered by the mouse
        const hovered = getHoveredItemTarget();
        if (hovered) {
            startRenaming(hovered);
            return true;
        }

        // 2. Check if the sidebar is focused
        if (isSidebarFocused()) {
            // 2a. Check if active DOM element with focus is a specific category or group
            const activeEl = document.activeElement as HTMLElement | null;
            if (activeEl) {
                const target = getTargetFromElement(activeEl);
                if (target) {
                    startRenaming(target);
                    return true;
                }
            }

            // 2b. Fallback to currently selected active category in the sidebar when sidebar is focused
            if (activeCategoryPath) {
                for (const item of sidebarItems) {
                    if (item.type === "category" && item.filepath === activeCategoryPath) {
                        startRenaming({ type: "category", id: item.id, name: item.name, filepath: item.filepath });
                        return true;
                    }
                    if (item.type === "group") {
                        const child = item.items.find(c => c.filepath === activeCategoryPath);
                        if (child) {
                            startRenaming({ type: "category", id: child.id, name: child.name, filepath: child.filepath });
                            return true;
                        }
                    }
                }
            }
        }

        // Neither hovering over a list in sidebar nor sidebar being focused: DO NOT hijack F2!
        return false;
    }

    function handleTriggerRename() {
        triggerRenameHoveredOrActive();
    }

    function handleRevealSidebarCategory(payload: any) {
        if (payload && payload.filepath) {
            void locateAndRevealCategory(payload.filepath);
        }
    }

    /**
     * Locate and reveal a category in the sidebar tree.
     * If the category is inside a collapsed group, auto-expand that group beforehand.
     * Smoothly scrolls the item into view with a gentle highlight pulse.
     */
    export async function locateAndRevealCategory(filepath: string): Promise<boolean> {
        if (!filepath) return false;

        // Ensure sidebar state is loaded
        if (!sidebarItems || sidebarItems.length === 0) {
            await loadSidebarItems();
        }

        let targetCategory: CategoryInfo | null = null;
        let parentGroup: GroupInfo | null = null;

        if (filepath === STARRED_CATEGORY_PATH) {
            targetCategory = { id: STARRED_CATEGORY_PATH, name: STARRED_CATEGORY_NAME, filepath: STARRED_CATEGORY_PATH, isSmartList: true };
        } else {
            for (const item of sidebarItems) {
                if (item.type === "category" && item.filepath === filepath) {
                    targetCategory = item;
                    break;
                } else if (item.type === "group") {
                    const child = item.items.find(c => c.filepath === filepath);
                    if (child) {
                        targetCategory = child;
                        parentGroup = item;
                        break;
                    }
                }
            }
        }

        if (!targetCategory) return false;

        // If inside a group and group is collapsed, expand it beforehand!
        if (parentGroup && !parentGroup.isExpanded) {
            parentGroup.isExpanded = true;
            sidebarItems = [...sidebarItems];
            await saveAndSyncSidebarState(sidebarItems);
        }

        activeCategoryPath = filepath;

        await tick();

        // Delay slightly to ensure Obsidian's sidebar width animation (~150ms-200ms) has expanded container layout
        setTimeout(() => {
            const escapedPath = CSS.escape(filepath);
            const targetEl = document.querySelector(`.category-item[data-filepath="${escapedPath}"]`) as HTMLElement | null;
            if (targetEl) {
                targetEl.scrollIntoView({ block: "center", behavior: "smooth" });
                targetEl.classList.remove("locate-highlight");
                void targetEl.offsetWidth; // Force reflow to cleanly restart CSS animation
                targetEl.classList.add("locate-highlight");
                setTimeout(() => {
                    targetEl?.classList.remove("locate-highlight");
                }, 1600);
            }
        }, 120);

        return true;
    }

    function startRenaming(target: any) {
        editingItemId = target.id;
        editingItemType = target.type;
        editingName = target.name;
        editingOriginalName = target.name;
        setTimeout(() => {
            if (renameInputEl) {
                renameInputEl.focus();
                renameInputEl.select();
            } else {
                const el = document.querySelector(".sidebar-rename-input") as HTMLInputElement | null;
                if (el) {
                    el.focus();
                    el.select();
                }
            }
        }, 30);
    }

    function cancelRename() {
        editingItemId = null;
        editingItemType = null;
    }

    async function confirmRename() {
        if (!editingItemId) return;
        const newName = editingName.trim();
        const targetId = editingItemId;
        const targetType = editingItemType;
        const oldName = editingOriginalName;

        editingItemId = null;
        editingItemType = null;

        if (!newName || newName === oldName) {
            return;
        }

        if (targetType === "category") {
            let catFilepath = "";
            for (const item of sidebarItems) {
                if (item.id === targetId && item.type === "category") {
                    catFilepath = item.filepath;
                    break;
                } else if (item.type === "group") {
                    const child = item.items.find(c => c.id === targetId);
                    if (child) {
                        catFilepath = child.filepath;
                        break;
                    }
                }
            }
            if (catFilepath) {
                try {
                    const updatedCat = await dataService.renameCategory(catFilepath, newName);
                    if (activeCategoryPath === catFilepath) {
                        activeCategoryPath = updatedCat.filepath;
                        EventBus.emit(EventName.CATEGORY_SELECTED, { category: updatedCat });
                    }
                    await loadSidebarItems();
                } catch (err: any) {
                    console.error("[Fluent Tasks] Failed to rename category:", err);
                }
            }
        } else if (targetType === "group") {
            try {
                await dataService.renameGroup(targetId, newName);
                await loadSidebarItems();
            } catch (err: any) {
                console.error("[Fluent Tasks] Failed to rename group:", err);
            }
        }
    }

    function handleRenameKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            void confirmRename();
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelRename();
        }
    }

    function handleWindowKeydown(e: KeyboardEvent) {
        if (e.key === "F2") {
            if (triggerRenameHoveredOrActive()) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }

    async function handleCategoryContextMenu(e: MouseEvent, cat: CategoryInfo) {
        e.preventDefault();
        const menu = new Menu();

        menu.addItem((item: any) => {
            item.setTitle("Rename List (F2)")
                .setIcon("edit")
                .onClick(() => {
                    startRenaming({ type: "category", id: cat.id, name: cat.name, filepath: cat.filepath });
                });
        });

        menu.addItem((item: any) => {
            item.setTitle("Delete List")
                .setIcon("trash")
                .onClick(async () => {
                    await dataService.deleteCategory(cat.filepath);
                });
        });

        menu.addSeparator();

        menu.addItem((item: any) => {
            item.setTitle("Move list to root")
                .setIcon("folder-output")
                .onClick(async () => {
                    await moveListToGroup(cat.id, "root");
                });
        });

        for (const group of sidebarItems.filter(i => i.type === "group")) {
            menu.addItem((item: any) => {
                item.setTitle(`Move list to ${group.name}`)
                    .setIcon("folder-input")
                    .onClick(async () => {
                        await moveListToGroup(cat.id, group.id);
                    });
            });
        }

        menu.showAtMouseEvent(e);
    }

    async function handleGroupContextMenu(e: MouseEvent, group: SidebarItem) {
        if (group.type !== "group") return;
        e.preventDefault();
        const menu = new Menu();

        menu.addItem((item: any) => {
            item.setTitle("Rename Group (F2)")
                .setIcon("edit")
                .onClick(() => {
                    startRenaming({ type: "group", id: group.id, name: group.name });
                });
        });

        menu.addItem((item: any) => {
            item.setTitle("Delete Group")
                .setIcon("trash")
                .onClick(async () => {
                    await deleteGroup(group.id);
                });
        });

        menu.showAtMouseEvent(e);
    }

    async function deleteGroup(groupId: string) {
        const nextSidebarItems = deleteGroupFromTree(sidebarItems, groupId);
        await saveAndSyncSidebarState(nextSidebarItems);
    }

    async function moveListToGroup(listId: string, targetGroupId: string) {
        const nextSidebarItems = moveListToGroupOrRoot(sidebarItems, listId, targetGroupId);
        await saveAndSyncSidebarState(nextSidebarItems);
    }

    // =============================================
    // HTML5 Native Drag & Drop Handlers
    // =============================================
    function getDraggedItem(): SidebarItem | null {
        for (const item of sidebarItems) {
            if (item.id === draggedItemId) return item;
            if (item.type === "group" && item.items) {
                const child = item.items.find(c => c.id === draggedItemId);
                if (child) return child;
            }
        }
        return null;
    }

    function handleDragStart(e: DragEvent, item: SidebarItem | CategoryInfo) {
        draggedItemId = item.id;
        (window as any).__mstodo_category_drag = true;
        if (e.dataTransfer) {
            e.dataTransfer.setData("text/plain", item.id);
            e.dataTransfer.effectAllowed = "move";
        }
    }

    function startSidebarAutoScroll() {
        if (sidebarScrollAnimId !== null) return;
        sidebarScrollAnimId = window.requestAnimationFrame(stepSidebarAutoScroll);
    }

    function stopSidebarAutoScroll() {
        if (sidebarScrollAnimId !== null) {
            window.cancelAnimationFrame(sidebarScrollAnimId);
            sidebarScrollAnimId = null;
        }
        sidebarScrollSpeed = 0;
    }

    function stepSidebarAutoScroll() {
        if (!customListsEl || sidebarScrollSpeed === 0) {
            sidebarScrollAnimId = null;
            return;
        }

        const prevScrollTop = customListsEl.scrollTop;
        customListsEl.scrollTop += sidebarScrollSpeed;

        if (customListsEl.scrollTop === prevScrollTop) {
            stopSidebarAutoScroll();
            return;
        }

        updateDragOverUnderMouse();
        updateCategoryDragOverUnderMouse(lastMouseX, lastMouseY);
        sidebarScrollAnimId = window.requestAnimationFrame(stepSidebarAutoScroll);
    }

    function updateSidebarAutoScroll(clientY: number, listsRect: DOMRect) {
        if (!customListsEl) return;

        // Top edge zone: scroll UP if there is room to scroll up
        if (clientY < listsRect.top + AUTO_SCROLL_EDGE_ZONE) {
            if (customListsEl.scrollTop <= 0) {
                stopSidebarAutoScroll();
                return;
            }
            const proximity = Math.min(2.5, Math.max(0.2, (listsRect.top + AUTO_SCROLL_EDGE_ZONE - clientY) / AUTO_SCROLL_EDGE_ZONE));
            sidebarScrollSpeed = -Math.round(proximity * AUTO_SCROLL_MAX_SPEED);
            startSidebarAutoScroll();
        } 
        // Bottom edge zone: scroll DOWN if there is room to scroll down
        else if (clientY > listsRect.bottom - AUTO_SCROLL_EDGE_ZONE) {
            if (customListsEl.scrollTop + customListsEl.clientHeight >= customListsEl.scrollHeight - 1) {
                stopSidebarAutoScroll();
                return;
            }
            const proximity = Math.min(2.5, Math.max(0.2, (clientY - (listsRect.bottom - AUTO_SCROLL_EDGE_ZONE)) / AUTO_SCROLL_EDGE_ZONE));
            sidebarScrollSpeed = Math.round(proximity * AUTO_SCROLL_MAX_SPEED);
            startSidebarAutoScroll();
        } 
        // Middle dead zone
        else {
            stopSidebarAutoScroll();
        }
    }

    function updateDragOverUnderMouse() {
        const dragData = (window as any).__mstodo_drag_data;
        if (!dragData) {
            if (dragOverPath) dragOverPath = "";
            return;
        }

        const categoryEls = document.querySelectorAll(".category-item[data-filepath]");
        let found = false;
        for (let i = 0; i < categoryEls.length; i++) {
            const el = categoryEls[i];
            const rect = el.getBoundingClientRect();
            if (
                lastMouseX >= rect.left && lastMouseX <= rect.right &&
                lastMouseY >= rect.top && lastMouseY <= rect.bottom
            ) {
                dragOverPath = el.getAttribute("data-filepath") || "";
                found = true;
                break;
            }
        }
        if (!found) dragOverPath = "";
    }

    function updateCategoryDragOverUnderMouse(clientX: number, clientY: number) {
        if (!draggedItemId && !(window as any).__mstodo_category_drag) return;
        const draggedItem = getDraggedItem();
        if (!draggedItem || !customListsEl) return;

        const listsRect = customListsEl.getBoundingClientRect();

        // If cursor is past the bottom of the items, drop at root-bottom
        if (clientY > listsRect.bottom - 24) {
            const lastItem = getLastItem();
            if (lastItem) {
                dragOverId = lastItem.id;
                dragPosition = "bottom";
            } else {
                dragOverId = "root-bottom";
                dragPosition = "bottom";
            }
            return;
        }

        const elUnder = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
        if (!elUnder) return;

        const itemEl = elUnder.closest(".category-item, .group-header") as HTMLElement | null;
        if (!itemEl) {
            return;
        }

        const itemId = itemEl.dataset.itemid || itemEl.dataset.groupid;
        if (!itemId || itemId === draggedItemId) {
            dragOverId = "";
            dragPosition = null;
            return;
        }

        let targetItem: SidebarItem | CategoryInfo | null = null;
        let parentGroup: any = null;
        for (const item of sidebarItems) {
            if (item.id === itemId) {
                targetItem = item;
                break;
            }
            if (item.type === "group" && item.items) {
                const child = item.items.find(c => c.id === itemId);
                if (child) {
                    targetItem = child;
                    parentGroup = item;
                    break;
                }
            }
        }

        if (!targetItem) return;

        // Groups cannot be placed inside groups or next to children inside groups
        if (draggedItem.type === "group" && parentGroup) {
            dragOverId = "";
            dragPosition = null;
            return;
        }

        dragOverId = targetItem.id;
        const rect = itemEl.getBoundingClientRect();
        const relativeY = clientY - rect.top;

        if (targetItem.type === "group") {
            if (draggedItem.type === "group") {
                dragPosition = relativeY < rect.height * 0.5 ? "top" : "bottom";
            } else if (!targetItem.isExpanded || targetItem.items.length === 0) {
                if (relativeY < rect.height * 0.33) {
                    dragPosition = "top";
                } else if (relativeY > rect.height * 0.67) {
                    dragPosition = "bottom";
                } else {
                    dragPosition = "inside";
                }
            } else {
                if (relativeY < rect.height * 0.4) {
                    dragPosition = "top";
                } else {
                    dragPosition = "inside";
                }
            }
        } else {
            dragPosition = relativeY < rect.height * 0.5 ? "top" : "bottom";
        }
    }

    function handleGlobalWheel(e: WheelEvent) {
        if (e.buttons !== 1) {
            (window as any).__mstodo_drag_data = null;
            (window as any).__mstodo_category_drag = null;
            draggedItemId = "";
            return;
        }
        const isCategoryDragging = !!draggedItemId || !!(window as any).__mstodo_category_drag;
        const isTaskDragging = !!(window as any).__mstodo_drag_data;
        if (!isCategoryDragging && !isTaskDragging) return;
        if (!customListsEl) return;

        let isOverSidebar = false;
        if (sidebarContainerEl) {
            const rect = sidebarContainerEl.getBoundingClientRect();
            if (
                e.clientX >= rect.left - 30 &&
                e.clientX <= rect.right + 30 &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom
            ) {
                isOverSidebar = true;
            }
        }
        if (!isOverSidebar && customListsEl) {
            const rect = customListsEl.getBoundingClientRect();
            if (
                e.clientX >= rect.left - 30 &&
                e.clientX <= rect.right + 30 &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom
            ) {
                isOverSidebar = true;
            }
        }

        if (!isOverSidebar) return;

        e.preventDefault();
        e.stopPropagation();

        stopSidebarAutoScroll();

        const delta = e.deltaMode === 1 ? e.deltaY * 24 : (e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY);
        customListsEl.scrollTop += delta;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        if (isTaskDragging) {
            updateDragOverUnderMouse();
        }
        if (isCategoryDragging) {
            updateCategoryDragOverUnderMouse(e.clientX, e.clientY);
        }
    }

    function checkAutoScroll(e: DragEvent) {
        if (!customListsEl || !sidebarContainerEl) return;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        const sidebarRect = sidebarContainerEl.getBoundingClientRect();
        const listsRect = customListsEl.getBoundingClientRect();
        if (e.clientX >= sidebarRect.left - 20 && e.clientX <= sidebarRect.right + 20) {
            updateSidebarAutoScroll(e.clientY, listsRect);
        } else {
            stopSidebarAutoScroll();
        }
    }

    function handleDragLeave(e: DragEvent) {
        const el = e.currentTarget as HTMLElement;
        const related = e.relatedTarget as HTMLElement | null;
        if (!related || !el.contains(related)) {
            const itemId = el.dataset.itemid || el.dataset.groupid || el.dataset.filepath;
            if (dragOverId === itemId) {
                dragOverId = "";
                dragPosition = null;
            }
        }
    }

    function handleDragOver(e: DragEvent, target: SidebarItem | CategoryInfo, parentGroup?: any) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

        checkAutoScroll(e);

        if (target.id === draggedItemId) {
            dragOverId = "";
            dragPosition = null;
            return;
        }

        const draggedItem = getDraggedItem();
        if (!draggedItem) return;

        // Groups cannot be placed inside groups or next to children inside groups
        if (draggedItem.type === "group" && parentGroup) {
            dragOverId = "";
            dragPosition = null;
            return;
        }

        dragOverId = target.id;
        const el = e.currentTarget as HTMLElement;
        const rect = el.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;

        if (target.type === "group") {
            if (draggedItem.type === "group") {
                dragPosition = relativeY < rect.height * 0.5 ? "top" : "bottom";
            } else if (!target.isExpanded || target.items.length === 0) {
                if (relativeY < rect.height * 0.33) {
                    dragPosition = "top";
                } else if (relativeY > rect.height * 0.67) {
                    dragPosition = "bottom";
                } else {
                    dragPosition = "inside";
                }
            } else {
                // Expanded group header: top 40% drops before group, bottom 60% drops into group
                if (relativeY < rect.height * 0.4) {
                    dragPosition = "top";
                } else {
                    dragPosition = "inside";
                }
            }
        } else {
            dragPosition = relativeY < rect.height * 0.5 ? "top" : "bottom";
        }
    }

    function handleDragEnd() {
        stopSidebarAutoScroll();
        draggedItemId = "";
        dragOverId = "";
        dragPosition = null;
        (window as any).__mstodo_category_drag = false;
    }

    async function handleDrop(e: DragEvent, target: SidebarItem | CategoryInfo, parentGroup?: any) {
        e.preventDefault();
        
        const pos = dragPosition;
        const targetId = target.id;
        const movedItemId = draggedItemId; // Capture BEFORE resetting
        
        handleDragEnd(); // Reset dragging UI styles

        if (!pos || !movedItemId || targetId === movedItemId) return;

        const nextItems = moveSidebarItem(sidebarItems, movedItemId, targetId, pos);
        await saveAndSyncSidebarState(nextItems);
    }

    function getLastItem(): SidebarItem | CategoryInfo | null {
        if (sidebarItems.length === 0) return null;
        const lastRoot = sidebarItems[sidebarItems.length - 1];
        if (lastRoot.type === "group" && lastRoot.isExpanded && lastRoot.items.length > 0) {
            return lastRoot.items[lastRoot.items.length - 1];
        }
        return lastRoot;
    }

    function handleRootDragOver(e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

        checkAutoScroll(e);

        const draggedItem = getDraggedItem();
        if (!draggedItem) return;

        const lastItem = getLastItem();
        if (lastItem) {
            dragOverId = lastItem.id;
            dragPosition = "bottom";
        } else {
            dragOverId = "root-bottom";
            dragPosition = "bottom";
        }
    }

    async function handleRootDrop(e: DragEvent) {
        e.preventDefault();
        const movedItemId = draggedItemId;
        handleDragEnd();

        if (!movedItemId) return;

        const nextItems = moveListToGroupOrRoot(sidebarItems, movedItemId, "root");
        await saveAndSyncSidebarState(nextItems);
    }

    // =============================================
    // Creation Forms
    // =============================================
    function startAddingList() {
        isAddingList = true;
        isAddingGroup = false;
        newListName = "";
        setTimeout(() => {
            const input = document.querySelector(".new-list-input") as HTMLInputElement;
            if (input) input.focus();
        }, INPUT_FOCUS_DELAY_MS);
    }

    let isCreatingList = false;

    async function confirmAddList() {
        if (isCreatingList) return;
        const name = newListName.trim();
        if (!name) {
            isAddingList = false;
            return;
        }
        isCreatingList = true;
        try {
            const newCat = await dataService.createCategory(name);
            await loadSidebarItems();
            selectCategory(newCat);
        } catch (e) {
            console.error("[Fluent Tasks] Failed to create list:", e);
        } finally {
            isCreatingList = false;
            isAddingList = false;
            newListName = "";
        }
    }

    function handleNewListKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") confirmAddList();
        else if (e.key === "Escape") isAddingList = false;
    }

    function handleNewListBlur() {
        setTimeout(() => { if (isAddingList && !isCreatingList) confirmAddList(); }, BLUR_CONFIRM_DELAY_MS);
    }

    // --- Add Group ---
    function startAddingGroup() {
        isAddingGroup = true;
        isAddingList = false;
        newGroupName = "";
        setTimeout(() => {
            const input = document.querySelector(".new-group-input") as HTMLInputElement;
            if (input) input.focus();
        }, INPUT_FOCUS_DELAY_MS);
    }

    let isCreatingGroup = false;

    async function confirmAddGroup() {
        if (isCreatingGroup) return;
        const name = newGroupName.trim();
        if (!name) {
            isAddingGroup = false;
            return;
        }
        isCreatingGroup = true;
        try {
            await dataService.createGroup(name);
            await loadSidebarItems();
        } catch (e) {
            console.error("[Fluent Tasks] Failed to create group:", e);
        } finally {
            isCreatingGroup = false;
            isAddingGroup = false;
            newGroupName = "";
        }
    }

    function handleNewGroupKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") confirmAddGroup();
        else if (e.key === "Escape") isAddingGroup = false;
    }

    function handleNewGroupBlur() {
        setTimeout(() => { if (isAddingGroup && !isCreatingGroup) confirmAddGroup(); }, BLUR_CONFIRM_DELAY_MS);
    }

    // =============================================
    // Cross-Pane Drag Radar (Physics Collision)
    // =============================================
    function handleGlobalPointerMove(e: PointerEvent) {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        if (sidebarContainerEl) {
            const rect = sidebarContainerEl.getBoundingClientRect();
            isMouseInsideSidebar = (
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom
            );
            if (!isMouseInsideSidebar && hoveredItem) {
                hoveredItem = null;
            }
        }

        const ghost = document.getElementById('dnd-action-dragged-el') as HTMLElement;
        if (ghost) {
            const overModal = document.elementFromPoint(e.clientX, e.clientY)?.closest('.modal-container, .workspace-ribbon');
            ghost.style.opacity = overModal ? '0' : '1';
            if (overModal) {
                dragOverPath = "";
                stopSidebarAutoScroll();
                return;
            }
        }

        const dragData = (window as any).__mstodo_drag_data;
        if (!dragData) {
            if (dragOverPath) dragOverPath = "";
            stopSidebarAutoScroll();
            return;
        }

        if (sidebarContainerEl && customListsEl) {
            const sidebarRect = sidebarContainerEl.getBoundingClientRect();
            const isHorizontallyInSidebar = (
                e.clientX >= sidebarRect.left - 20 &&
                e.clientX <= sidebarRect.right + 20
            );

            if (isHorizontallyInSidebar && e.clientY >= sidebarRect.top && e.clientY <= sidebarRect.bottom) {
                const listsRect = customListsEl.getBoundingClientRect();
                updateSidebarAutoScroll(e.clientY, listsRect);
            } else {
                stopSidebarAutoScroll();
            }
        } else {
            stopSidebarAutoScroll();
        }

        updateDragOverUnderMouse();
    }

    function findCategoryName(filepath: string): string {
        if (filepath === STARRED_CATEGORY_PATH) return STARRED_CATEGORY_NAME;
        for (const item of sidebarItems) {
            if (item.type !== "group" && (item as CategoryInfo).filepath === filepath) {
                return (item as CategoryInfo).name;
            }
            if (item.type === "group" && (item as GroupInfo).items) {
                const child = (item as GroupInfo).items.find(c => c.filepath === filepath);
                if (child) return child.name;
            }
        }
        return filepath.replace(/\.md$/, "").split("/").pop() || filepath;
    }

    async function handleGlobalPointerUp(e: PointerEvent) {
        stopSidebarAutoScroll();
        const dragData = (window as any).__mstodo_drag_data;
        if (!dragData) return;

        const targetPath = dragOverPath;
        dragOverPath = "";

        if (!targetPath) {
            return;
        }
        if (targetPath === dragData.sourceFilepath) {
            (window as any).__mstodo_drag_data = null;
            killDndGhostElement();
            return;
        }

        if (targetPath === STARRED_CATEGORY_PATH) {
            dragData.movedToTarget = targetPath;
            const { task, sourceFilepath } = dragData;
            (window as any).__mstodo_drag_data = null;
            killDndGhostElement();
            if (!task.starred) {
                task.starred = true;
                void (async () => {
                    try {
                        await dataService.updateTask(sourceFilepath, task);
                        EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath: sourceFilepath });
                        new Notice(`Starred task: "${task.title}"`);
                        await refreshStarredCount();
                    } catch (err) {
                        console.error("[TaskSidebarView] Star drop failed:", err);
                    }
                })();
            }
            return;
        }

        // Mark that this task was moved cross-pane to targetPath
        dragData.movedToTarget = targetPath;
        const { task, sourceFilepath } = dragData;

        killDndGhostElement();
        injectDndGhostShield();

        try {
            await dataService.moveTask(task, sourceFilepath, targetPath);
            EventBus.emit(EventName.TASK_MOVED, {
                task, sourcePath: sourceFilepath, targetPath
            });
            const targetName = findCategoryName(targetPath);
            new Notice(`Moved to "${targetName}"`);
        } catch (err) {
            console.error("[MStodo Sidebar] Move failed:", err);
        }

        setTimeout(() => removeDndGhostShield(), DND_SHIELD_REMOVAL_DELAY_MS);
    }

    function handleRescuePointerUp(e: PointerEvent) {
        stopSidebarAutoScroll();
        const isDraggingTask = !!(window as any).__mstodo_drag_data;
        const isDraggingCat = !!draggedItemId;
        
        if (!isDraggingTask && !isDraggingCat) return;

        setTimeout(() => {
            const stillDraggingTask = !!(window as any).__mstodo_drag_data;
            const stillDraggingCat = !!draggedItemId;
            if (stillDraggingTask || stillDraggingCat) {
                window.dispatchEvent(new PointerEvent("pointerup", {
                    bubbles: true,
                    cancelable: true,
                    clientX: e.clientX,
                    clientY: e.clientY
                }));
            }
        }, DND_RESCUE_DELAY_MS);
    }

    function openGlobalSearch() {
        new TaskSearchModal(app, plugin, dataService).open();
    }
</script>

<svelte:window 
    on:pointerup|capture={handleGlobalPointerUp} 
    on:pointerup|capture={handleRescuePointerUp} 
/>

<div 
    class="sidebar-container"
    bind:this={sidebarContainerEl}
    tabindex="-1"
    on:mouseenter={handleSidebarMouseEnter}
    on:mouseleave={handleSidebarMouseLeave}
    on:wheel={handleGlobalWheel}
>
    <div class="sidebar-header" style="display: flex; align-items: center; justify-content: space-between;">
        <span>Lists</span>
        <span class="icon-btn" on:click={openGlobalSearch}
              role="button" tabindex="0" aria-label="Search all tasks" title="Search all tasks"
              on:keydown={(e) => e.key === "Enter" && openGlobalSearch()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
        </span>
    </div>
    {#if starredCount > 0}
        <div class="smart-lists-container">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
                class="category-item smart-category-item"
                class:active={activeCategoryPath === STARRED_CATEGORY_PATH}
                class:drag-over={dragOverPath === STARRED_CATEGORY_PATH}
                data-filepath={STARRED_CATEGORY_PATH}
                on:click={() => selectCategory({ id: STARRED_CATEGORY_PATH, name: STARRED_CATEGORY_NAME, filepath: STARRED_CATEGORY_PATH, isSmartList: true })}
                tabindex="0"
                role="button"
            >
                <span class="cat-icon smart-star-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--todo-star, var(--todo-accent, #8b5cf6))" stroke="var(--todo-star, var(--todo-accent, #8b5cf6))" stroke-width="1.5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                </span>
                <span class="cat-name">Starred</span>
                <span class="smart-count-badge">{starredCount}</span>
            </div>
        </div>
    {/if}
    <div class="custom-lists" 
         bind:this={customListsEl}
         data-root="true"
         role="list"
         class:drag-over-bottom={dragOverId === "root-bottom"}
         on:dragover={handleRootDragOver}
         on:drop={handleRootDrop}
         on:wheel={handleGlobalWheel}
    >
        {#each sidebarItems as item (item.id)}
            {#if item.type === 'category'}
                <div
                    draggable={editingItemId !== item.id}
                    data-itemid={item.id}
                    on:mouseenter={() => setHoveredCategory(item)}
                    on:mouseleave={() => clearHoveredItem(item.id)}
                    on:dragstart={(e) => handleDragStart(e, item)}
                    on:dragover|stopPropagation={(e) => handleDragOver(e, item)}
                    on:dragleave={handleDragLeave}
                    on:drop|stopPropagation={(e) => handleDrop(e, item)}
                    on:dragend={handleDragEnd}
                    class="category-item"
                    class:active={activeCategoryPath === item.filepath}
                    class:drag-over={(dragOverId === item.id && dragPosition === 'inside') || dragOverPath === item.filepath}
                    class:drag-over-top={dragOverId === item.id && dragPosition === 'top'}
                    class:drag-over-bottom={dragOverId === item.id && dragPosition === 'bottom'}
                    data-filepath={item.filepath}
                    on:click={() => { if (editingItemId !== item.id) selectCategory(item); }}
                    on:contextmenu={(e) => handleCategoryContextMenu(e, item)}
                    on:keydown={(e) => e.key === "Enter" && editingItemId !== item.id && selectCategory(item)}
                    tabindex="0"
                    role="button"
                >
                    <span class="cat-icon drag-handle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                        </svg>
                    </span>
                    {#if editingItemId === item.id}
                        <!-- svelte-ignore a11y-autofocus -->
                        <input
                            class="sidebar-rename-input"
                            type="text"
                            bind:value={editingName}
                            bind:this={renameInputEl}
                            on:keydown={handleRenameKeydown}
                            on:blur={confirmRename}
                            on:click|stopPropagation={() => {}}
                            autofocus
                        />
                    {:else}
                        <span class="cat-name drag-handle">{item.name}</span>
                    {/if}
                </div>
            {:else if item.type === 'group'}
                <div
                    draggable={editingItemId !== item.id}
                    data-itemid={item.id}
                    on:dragstart={(e) => handleDragStart(e, item)}
                    on:dragend={handleDragEnd}
                    class="group-container"
                    class:drag-over={dragOverId === item.id && dragPosition === 'inside'}
                    class:drag-over-top={dragOverId === item.id && dragPosition === 'top'}
                    class:drag-over-bottom={dragOverId === item.id && dragPosition === 'bottom'}
                    role="listitem"
                >
                    <div class="group-header"
                         data-itemid={item.id}
                         data-groupid={item.id}
                         on:mouseenter={() => setHoveredGroup(item)}
                         on:mouseleave={() => clearHoveredItem(item.id)}
                         on:dragover|stopPropagation={(e) => handleDragOver(e, item)}
                         on:dragleave={handleDragLeave}
                         on:drop|stopPropagation={(e) => handleDrop(e, item)}
                         on:click|stopPropagation={() => { if (editingItemId !== item.id) toggleGroup(item); }}
                         on:contextmenu|stopPropagation={(e) => handleGroupContextMenu(e, item)}
                         role="button" tabindex="0"
                         on:keydown={(e) => e.key === "Enter" && editingItemId !== item.id && toggleGroup(item)}>
                        {#if editingItemId === item.id}
                            <!-- svelte-ignore a11y-autofocus -->
                            <input
                                class="sidebar-rename-input"
                                type="text"
                                bind:value={editingName}
                                bind:this={renameInputEl}
                                on:keydown={handleRenameKeydown}
                                on:blur={confirmRename}
                                on:click|stopPropagation={() => {}}
                                autofocus
                            />
                        {:else}
                            <span class="group-name">{item.name}</span>
                        {/if}
                        <svg class="chevron {item.isExpanded ? 'expanded' : ''}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                    {#if item.isExpanded}
                        <div class="group-items"
                             data-groupid={item.id}
                             class:empty={item.items.length === 0}
                             class:drag-over={dragOverId === item.id && dragPosition === 'inside'}
                             on:dragover|stopPropagation={(e) => item.items.length === 0 ? handleDragOver(e, item) : undefined}
                             on:drop|stopPropagation={(e) => item.items.length === 0 ? handleDrop(e, item) : undefined}
                             role="list">
                            {#each item.items as cat (cat.id)}
                                <div
                                    draggable={editingItemId !== cat.id}
                                    data-itemid={cat.id}
                                    on:mouseenter={() => setHoveredCategory(cat)}
                                    on:mouseleave={() => clearHoveredItem(cat.id)}
                                    on:dragstart|stopPropagation={(e) => handleDragStart(e, cat)}
                                    on:dragover|stopPropagation={(e) => handleDragOver(e, cat, item)}
                                    on:dragleave={handleDragLeave}
                                    on:drop|stopPropagation={(e) => handleDrop(e, cat, item)}
                                    on:dragend|stopPropagation={handleDragEnd}
                                    class="category-item"
                                    class:active={activeCategoryPath === cat.filepath}
                                    class:drag-over={dragOverPath === cat.filepath}
                                    class:drag-over-top={dragOverId === cat.id && dragPosition === 'top'}
                                    class:drag-over-bottom={dragOverId === cat.id && dragPosition === 'bottom'}
                                    data-filepath={cat.filepath}
                                    on:click={() => { if (editingItemId !== cat.id) selectCategory(cat); }}
                                    on:contextmenu={(e) => handleCategoryContextMenu(e, cat)}
                                    on:keydown={(e) => e.key === "Enter" && editingItemId !== cat.id && selectCategory(cat)}
                                    tabindex="0"
                                    role="button"
                                >
                                    <span class="cat-icon">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                        </svg>
                                    </span>
                                    {#if editingItemId === cat.id}
                                        <!-- svelte-ignore a11y-autofocus -->
                                        <input
                                            class="sidebar-rename-input"
                                            type="text"
                                            bind:value={editingName}
                                            bind:this={renameInputEl}
                                            on:keydown={handleRenameKeydown}
                                            on:blur={confirmRename}
                                            on:click|stopPropagation={() => {}}
                                            autofocus
                                        />
                                    {:else}
                                        <span class="cat-name">{cat.name}</span>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}
        {/each}
    </div>

    <div class="add-list-container">
        {#if isAddingList}
            <input
                class="new-list-input"
                type="text"
                placeholder="Name your new list..."
                bind:value={newListName}
                on:keydown={handleNewListKeydown}
                on:blur={handleNewListBlur}
            />
            <span class="folder-icon" on:click={confirmAddList} role="button" tabindex="0"
                  on:keydown={(e) => e.key === "Enter" && confirmAddList()}>
                <!-- Checkmark Icon -->
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </span>
        {:else if isAddingGroup}
            <input
                class="new-group-input"
                type="text"
                placeholder="Name your new group..."
                bind:value={newGroupName}
                on:keydown={handleNewGroupKeydown}
                on:blur={handleNewGroupBlur}
            />
            <span class="folder-icon" on:click={confirmAddGroup} role="button" tabindex="0"
                  on:keydown={(e) => e.key === "Enter" && confirmAddGroup()}>
                <!-- Checkmark Icon -->
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </span>
        {:else}
            <div class="add-list-btn" on:click={startAddingList} role="button" tabindex="0"
                 aria-label="Add new list" title="Add new list"
                 on:keydown={(e) => e.key === "Enter" && startAddingList()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span>New list</span>
            </div>
            
            <div class="add-group-btn" on:click={startAddingGroup} role="button" tabindex="0"
                 aria-label="Add new group" title="Add new group"
                 on:keydown={(e) => e.key === "Enter" && startAddingGroup()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    <line x1="12" y1="11" x2="12" y2="17"/>
                    <line x1="9" y1="14" x2="15" y2="14"/>
                </svg>
            </div>
        {/if}
    </div>
</div>
