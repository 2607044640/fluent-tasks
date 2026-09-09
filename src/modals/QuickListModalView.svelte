<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { DataService } from "../DataService";
    import { EventBus } from "../EventBus";
    import { EventName, VIEW_TYPE_MAIN } from "../types";
    import type { CategoryInfo, SidebarItem, GroupInfo } from "../types";
    import { moveSidebarItem, toggleGroupExpandedState, getFlatCategories, filterSidebarTree } from "../utils/sidebarTreeUtils";
    import { INPUT_FOCUS_DELAY_MS } from "../constants";
    import { Menu, Notice } from "obsidian";
    import type { App } from "obsidian";

    // =============================================
    // Props
    // =============================================
    export let app: App;
    export let plugin: any = null;
    export let dataService: DataService;
    export let showTip: boolean = false;
    export let remainingTips: number = 0;
    export let closeModal: () => void = () => {};

    // =============================================
    // State
    // =============================================
    let sidebarItems: SidebarItem[] = [];
    let categories: CategoryInfo[] = [];
    let taskCounts: Record<string, number> = {};
    let searchQuery: string = "";
    let focusedIndex: number = 0;
    let isGridLayout: boolean = plugin?.settings?.quickListGridLayout ?? true;

    // Inline Add List / Group State
    let isAddingList: boolean = false;
    let newListName: string = "";
    let isAddingGroup: boolean = false;
    let newGroupName: string = "";

    // Inline Rename State
    let editingItemId: string = "";
    let editingItemType: "category" | "group" = "category";
    let editingName: string = "";
    let renameInputEl: HTMLInputElement;

    // Drag & Drop reordering state
    let draggedListId: string = "";
    let dragOverListId: string = "";
    let dragListPosition: "top" | "bottom" | "inside" | null = null;

    // DOM Element Bindings
    let searchInputEl: HTMLInputElement;
    let modalContainerEl: HTMLElement;
    let addListInputEl: HTMLInputElement;
    let addGroupInputEl: HTMLInputElement;

    $: isFiltering = !!searchQuery.trim();
    $: filteredItems = filterSidebarTree(sidebarItems, searchQuery);
    $: flatCategories = getFlatCategories(filteredItems);
    $: groupItems = filteredItems.filter(i => i.type === "group") as GroupInfo[];
    $: rootCategories = filteredItems.filter(i => i.type === "category") as CategoryInfo[];
    $: if (focusedIndex >= flatCategories.length) {
        focusedIndex = Math.max(0, flatCategories.length - 1);
    }

    async function toggleLayoutMode() {
        isGridLayout = !isGridLayout;
        if (plugin?.settings) {
            plugin.settings.quickListGridLayout = isGridLayout;
            await plugin.saveSettings();
        }
    }

    onMount(async () => {
        await loadData();
        EventBus.on(EventName.CATEGORY_LIST_CHANGED, handleExternalListChanged);
        EventBus.on(EventName.TASK_UPDATED, handleExternalTaskUpdated);

        setTimeout(() => {
            searchInputEl?.focus();
        }, 50);
    });

    onDestroy(() => {
        EventBus.off(EventName.CATEGORY_LIST_CHANGED, handleExternalListChanged);
        EventBus.off(EventName.TASK_UPDATED, handleExternalTaskUpdated);
    });

    function handleExternalListChanged() {
        void loadData();
    }

    function handleExternalTaskUpdated() {
        void refreshTaskCounts();
    }

    async function loadData() {
        sidebarItems = await dataService.getSidebarItems();
        categories = await dataService.getCategories();
        await refreshTaskCounts();
    }

    async function refreshTaskCounts() {
        const countPromises = categories.map(async (cat) => {
            try {
                const catTasks = await dataService.getTasks(cat.filepath);
                taskCounts[cat.filepath] = catTasks.filter(t => !t.completed).length;
            } catch {
                taskCounts[cat.filepath] = 0;
            }
        });
        await Promise.all(countPromises);
        taskCounts = { ...taskCounts };
    }

    async function toggleGroup(group: GroupInfo) {
        sidebarItems = toggleGroupExpandedState(sidebarItems, group.id);
        await dataService.saveSidebarState(sidebarItems);
    }

    async function openCategoryInCenterOnly(cat: CategoryInfo) {
        if (!cat) return;

        // 1. Collapse left and right sidebars if open & suppress auto-expansion
        if (plugin && typeof plugin.collapseSidebars === "function") {
            plugin.collapseSidebars(1200);
        } else {
            const leftSplit = (app.workspace as any).leftSplit;
            if (leftSplit && !leftSplit.collapsed) leftSplit.collapse();
            const rightSplit = (app.workspace as any).rightSplit;
            if (rightSplit && !rightSplit.collapsed) rightSplit.collapse();
        }

        // 2. Reveal/Activate TaskMainView in center ONLY
        const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
        let leaf = leaves[0];
        if (!leaf) {
            leaf = app.workspace.getLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_MAIN, active: true });
        }
        await app.workspace.revealLeaf(leaf);

        // 3. Select category in main view
        EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat, focusInput: false });

        // 4. Close modal
        closeModal();
    }

    // =============================================
    // Drag & Drop Lists / Groups (Tree Reordering)
    // =============================================
    function handleListDragStart(e: DragEvent, item: SidebarItem | CategoryInfo) {
        draggedListId = item.id;
        if (e.dataTransfer) {
            e.dataTransfer.setData("text/plain", item.id);
            e.dataTransfer.effectAllowed = "move";
        }
    }

    function handleListDragOver(e: DragEvent, target: SidebarItem | CategoryInfo, isGroupHeader: boolean = false) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

        if (!draggedListId || target.id === draggedListId) {
            dragOverListId = "";
            dragListPosition = null;
            return;
        }

        dragOverListId = target.id || "";
        const el = e.currentTarget as HTMLElement;
        const rect = el.getBoundingClientRect();
        const relY = e.clientY - rect.top;

        if (isGroupHeader) {
            dragListPosition = relY < rect.height * 0.35 ? "top" : "inside";
        } else {
            dragListPosition = relY < rect.height * 0.5 ? "top" : "bottom";
        }
    }

    function handleListDragLeave() {
        dragOverListId = "";
        dragListPosition = null;
    }

    async function handleListDrop(target: SidebarItem | CategoryInfo) {
        if (!draggedListId || !dragOverListId || !dragListPosition) return;
        const movedId = draggedListId;
        const targetId = target.id || "";
        const pos = dragListPosition;

        draggedListId = "";
        dragOverListId = "";
        dragListPosition = null;

        if (movedId === targetId) return;

        sidebarItems = moveSidebarItem(sidebarItems, movedId, targetId, pos);
        await dataService.saveSidebarState(sidebarItems);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems });
    }

    // =============================================
    // Inline Rename & Context Menus
    // =============================================
    function startRenameItem(item: { id: string; name: string; type: "category" | "group" }) {
        editingItemId = item.id;
        editingItemType = item.type;
        editingName = item.name;
        setTimeout(() => {
            renameInputEl?.focus();
            renameInputEl?.select();
        }, 30);
    }

    async function commitRename() {
        const newName = editingName.trim();
        if (!newName || !editingItemId) {
            cancelRename();
            return;
        }

        try {
            if (editingItemType === "category") {
                const cat = categories.find(c => c.id === editingItemId || c.filepath === editingItemId);
                if (cat && cat.name !== newName) {
                    await dataService.renameCategory(cat.filepath, newName);
                }
            } else {
                await dataService.renameGroup(editingItemId, newName);
            }
            await loadData();
        } catch (e) {
            console.error("[QuickListModal] Rename failed:", e);
        }
        cancelRename();
    }

    function cancelRename() {
        editingItemId = "";
        editingName = "";
    }

    function showItemContextMenu(e: MouseEvent, item: { id: string; name: string; type: "category" | "group"; filepath?: string }) {
        e.preventDefault();
        e.stopPropagation();

        const menu = new Menu();
        menu.addItem((i) => {
            i.setTitle("Rename (F2)")
             .setIcon("edit")
             .onClick(() => startRenameItem(item));
        });

        menu.addItem((i) => {
            i.setTitle("Delete")
             .setIcon("trash")
             .setWarning(true)
             .onClick(async () => {
                 if (item.type === "category" && item.filepath) {
                     await dataService.deleteCategory(item.filepath);
                 }
                 await loadData();
             });
        });

        menu.showAtMouseEvent(e);
    }

    // =============================================
    // Inline Add List / Add Group
    // =============================================
    function startAddList() {
        isAddingList = true;
        newListName = "";
        setTimeout(() => addListInputEl?.focus(), INPUT_FOCUS_DELAY_MS);
    }

    async function commitAddList() {
        const name = newListName.trim();
        if (!name) {
            isAddingList = false;
            return;
        }
        try {
            const newCat = await dataService.createCategory(name);
            await loadData();
            await openCategoryInCenterOnly(newCat);
        } catch (e) {
            new Notice(`Failed to create list: ${e}`);
        }
        isAddingList = false;
        newListName = "";
    }

    function startAddGroup() {
        isAddingGroup = true;
        newGroupName = "";
        setTimeout(() => addGroupInputEl?.focus(), INPUT_FOCUS_DELAY_MS);
    }

    async function commitAddGroup() {
        const name = newGroupName.trim();
        if (!name) {
            isAddingGroup = false;
            return;
        }
        try {
            await dataService.createGroup(name);
            await loadData();
        } catch (e) {
            new Notice(`Failed to create group: ${e}`);
        }
        isAddingGroup = false;
        newGroupName = "";
    }

    // =============================================
    // Keyboard Physics (1D & 2D Directional Navigation)
    // =============================================
    function navigateDirection(direction: "up" | "down" | "left" | "right") {
        if (!flatCategories || flatCategories.length === 0) return;

        // If in classic single-column list mode, use standard linear navigation:
        if (!isGridLayout) {
            if (direction === "down") {
                focusedIndex = Math.min(flatCategories.length - 1, focusedIndex + 1);
            } else if (direction === "up") {
                focusedIndex = Math.max(0, focusedIndex - 1);
            }
            scrollFocusedIntoView();
            return;
        }

        // In 2D Grid Board layout: Geometric Spatial Navigation
        const items = Array.from(modalContainerEl?.querySelectorAll(".quick-modal-list-item") || []) as HTMLElement[];
        if (items.length === 0) return;

        // Get currently focused element (or default to first item)
        let currentEl = modalContainerEl?.querySelector(".quick-modal-list-item.is-focused") as HTMLElement | null;
        if (!currentEl) {
            currentEl = items[0];
            const targetPath = currentEl.dataset.filepath;
            const idx = flatCategories.findIndex(c => c.filepath === targetPath);
            if (idx !== -1) focusedIndex = idx;
            scrollFocusedIntoView();
            return;
        }

        const currentRect = currentEl.getBoundingClientRect();
        const currentCenterX = currentRect.left + currentRect.width / 2;
        const currentCenterY = currentRect.top + currentRect.height / 2;

        let bestCandidate: HTMLElement | null = null;
        let minScore = Infinity;

        for (const item of items) {
            if (item === currentEl) continue;
            const rect = item.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const dx = centerX - currentCenterX;
            const dy = centerY - currentCenterY;

            let isEligible = false;
            let score = Infinity;

            switch (direction) {
                case "down":
                    if (rect.top >= currentRect.bottom - 4) {
                        isEligible = true;
                        // Strongly prefer elements in the same column (small |dx|)
                        score = dy + Math.abs(dx) * 3.0;
                    }
                    break;
                case "up":
                    if (rect.bottom <= currentRect.top + 4) {
                        isEligible = true;
                        score = -dy + Math.abs(dx) * 3.0;
                    }
                    break;
                case "right":
                    if (rect.left >= currentRect.right - 8) {
                        isEligible = true;
                        // Strongly prefer elements aligned on the same row (small |dy|)
                        score = dx + Math.abs(dy) * 2.5;
                    }
                    break;
                case "left":
                    if (rect.right <= currentRect.left + 8) {
                        isEligible = true;
                        score = -dx + Math.abs(dy) * 2.5;
                    }
                    break;
            }

            if (isEligible && score < minScore) {
                minScore = score;
                bestCandidate = item;
            }
        }

        // If no candidate found in strict direction, handle boundary wrapping
        if (!bestCandidate) {
            if (direction === "down") {
                focusedIndex = (focusedIndex + 1) % flatCategories.length;
                scrollFocusedIntoView();
                return;
            } else if (direction === "up") {
                focusedIndex = (focusedIndex - 1 + flatCategories.length) % flatCategories.length;
                scrollFocusedIntoView();
                return;
            } else if (direction === "right") {
                // Wrap around to leftmost column
                let leftmostCand: HTMLElement | null = null;
                let minX = Infinity;
                let minDy = Infinity;
                for (const item of items) {
                    const rect = item.getBoundingClientRect();
                    const centerY = rect.top + rect.height / 2;
                    const dy = Math.abs(centerY - currentCenterY);
                    if (rect.left < minX - 20) {
                        minX = rect.left;
                        minDy = dy;
                        leftmostCand = item;
                    } else if (Math.abs(rect.left - minX) <= 20 && dy < minDy) {
                        minDy = dy;
                        leftmostCand = item;
                    }
                }
                bestCandidate = leftmostCand;
            } else if (direction === "left") {
                // Wrap around to rightmost column
                let rightmostCand: HTMLElement | null = null;
                let maxX = -Infinity;
                let minDy = Infinity;
                for (const item of items) {
                    const rect = item.getBoundingClientRect();
                    const centerY = rect.top + rect.height / 2;
                    const dy = Math.abs(centerY - currentCenterY);
                    if (rect.right > maxX + 20) {
                        maxX = rect.right;
                        minDy = dy;
                        rightmostCand = item;
                    } else if (Math.abs(rect.right - maxX) <= 20 && dy < minDy) {
                        minDy = dy;
                        rightmostCand = item;
                    }
                }
                bestCandidate = rightmostCand;
            }
        }

        if (bestCandidate) {
            const targetPath = bestCandidate.dataset.filepath;
            const newIndex = flatCategories.findIndex(c => c.filepath === targetPath);
            if (newIndex !== -1) {
                focusedIndex = newIndex;
                scrollFocusedIntoView();
            }
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.isComposing || e.keyCode === 229) return;

        if (e.key === "F2") {
            e.preventDefault();
            e.stopPropagation();
            if (flatCategories[focusedIndex]) {
                const cat = flatCategories[focusedIndex];
                startRenameItem({ id: cat.id || "", name: cat.name, type: "category" });
            }
            return;
        }

        if (editingItemId) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void commitRename();
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelRename();
            }
            return;
        }

        if (isAddingList || isAddingGroup) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (isAddingList) void commitAddList();
                else void commitAddGroup();
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                isAddingList = false;
                isAddingGroup = false;
            }
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            navigateDirection("down");
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            navigateDirection("up");
            return;
        }

        if (e.key === "ArrowLeft") {
            // Allow cursor navigation inside search input when text is selected or cursor > 0
            if (document.activeElement === searchInputEl && searchQuery.length > 0 && searchInputEl.selectionStart !== 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            navigateDirection("left");
            return;
        }

        if (e.key === "ArrowRight") {
            // Allow cursor navigation inside search input when text is selected or cursor < length
            if (document.activeElement === searchInputEl && searchQuery.length > 0 && searchInputEl.selectionStart !== searchQuery.length) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            navigateDirection("right");
            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (flatCategories.length > 0 && flatCategories[focusedIndex]) {
                void openCategoryInCenterOnly(flatCategories[focusedIndex]);
            }
            return;
        }

        if (e.key === "Escape") {
            if (searchQuery) {
                e.preventDefault();
                e.stopPropagation();
                searchQuery = "";
                return;
            }
            closeModal();
            return;
        }
    }

    function scrollFocusedIntoView() {
        setTimeout(() => {
            const el = modalContainerEl?.querySelector(".quick-modal-list-item.is-focused") as HTMLElement | null;
            if (el) {
                el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
            }
        }, 10);
    }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions a11y-no-noninteractive-tabindex a11y-click-events-have-key-events -->
<div 
    class="quick-modal-container quick-list-only-container"
    bind:this={modalContainerEl}
    on:keydown={handleKeydown}
    tabindex="0"
    role="region"
>
    {#if showTip}
        <div class="quick-modal-tip-banner">
            💡 提示: 在 <b>设置 → 快捷键</b> 中为 <code>Fluent Tasks: Open Quick List Modal</code> 设置快捷键 (剩余 {remainingTips} 次提醒)
        </div>
    {/if}

    <!-- Search & Layout Toggle Header -->
    <div class="quick-modal-filter-bar">
        <span class="quick-modal-filter-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
        </span>
        <input 
            type="text" 
            class="quick-modal-filter-input"
            placeholder="Type to filter lists (↑↓←→ navigate, F2 rename, Enter to open in center)..."
            bind:value={searchQuery}
            bind:this={searchInputEl}
        />
        {#if searchQuery}
            <button class="quick-modal-filter-clear" on:click={() => { searchQuery = ""; searchInputEl?.focus(); }}>✕</button>
        {/if}
        <button 
            class="quick-modal-layout-toggle-btn"
            title={isGridLayout ? "Switch to Classic Single-Column List" : "Switch to Grid Board Layout"}
            on:click={toggleLayoutMode}
        >
            {#if isGridLayout}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="7"></rect>
                    <rect x="14" y="3" width="7" height="7"></rect>
                    <rect x="14" y="14" width="7" height="7"></rect>
                    <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
                <span>Grid</span>
            {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="8" y1="6" x2="21" y2="6"></line>
                    <line x1="8" y1="12" x2="21" y2="12"></line>
                    <line x1="8" y1="18" x2="21" y2="18"></line>
                    <line x1="3" y1="6" x2="3.01" y2="6"></line>
                    <line x1="3" y1="12" x2="3.01" y2="12"></line>
                    <line x1="3" y1="18" x2="3.01" y2="18"></line>
                </svg>
                <span>List</span>
            {/if}
        </button>
    </div>

    {#if isGridLayout}
        <!-- =============================================
             Grid Board / Dashboard Card Layout (图表平铺看板)
             ============================================= -->
        <div class="quick-list-grid-board">
            {#if filteredItems.length === 0}
                <div class="quick-modal-empty">No matching lists or groups found.</div>
            {:else}
                <!-- Standalone Root Categories Card (if any exist) -->
                {#if rootCategories.length > 0}
                    <div class="quick-grid-card is-root-card">
                        <div class="quick-grid-card-header">
                            <div class="quick-grid-card-title-wrap">
                                <span class="quick-grid-card-icon">📁</span>
                                <span class="quick-grid-card-title">Lists</span>
                            </div>
                            <span class="quick-grid-card-count">{rootCategories.length}</span>
                        </div>
                        <div class="quick-grid-card-items">
                            {#each rootCategories as cat (cat.id)}
                                <div 
                                    class="quick-modal-list-item is-grid-item"
                                    class:is-focused={flatCategories[focusedIndex]?.filepath === cat.filepath}
                                    class:drag-over-top={dragOverListId === cat.id && dragListPosition === "top"}
                                    class:drag-over-bottom={dragOverListId === cat.id && dragListPosition === "bottom"}
                                    data-filepath={cat.filepath}
                                    role="button"
                                    tabindex="0"
                                    draggable="true"
                                    on:dragstart={(e) => handleListDragStart(e, cat)}
                                    on:dragover={(e) => handleListDragOver(e, cat, false)}
                                    on:dragleave={handleListDragLeave}
                                    on:drop|preventDefault={() => handleListDrop(cat)}
                                    on:click={() => openCategoryInCenterOnly(cat)}
                                    on:contextmenu={(e) => showItemContextMenu(e, { id: cat.id || "", name: cat.name, type: "category", filepath: cat.filepath })}
                                >
                                    <span class="quick-modal-list-icon">📁</span>
                                    
                                    {#if editingItemId === cat.id}
                                        <input 
                                            type="text" 
                                            class="quick-modal-inline-rename-input"
                                            bind:value={editingName}
                                            bind:this={renameInputEl}
                                            on:blur={commitRename}
                                        />
                                    {:else}
                                        <span class="quick-modal-list-name" title={cat.name}>{cat.name}</span>
                                    {/if}

                                    {#if (taskCounts[cat.filepath] ?? 0) > 0}
                                        <span class="quick-modal-badge">{taskCounts[cat.filepath]}</span>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Group Cards -->
                {#each groupItems as group (group.id)}
                    <div 
                        class="quick-grid-card"
                        class:drag-over-top={dragOverListId === group.id && dragListPosition === "top"}
                        class:drag-over-bottom={dragOverListId === group.id && dragListPosition === "bottom"}
                        class:drag-over-inside={dragOverListId === group.id && dragListPosition === "inside"}
                    >
                        <div 
                            class="quick-grid-card-header"
                            draggable="true"
                            on:dragstart={(e) => handleListDragStart(e, group)}
                            on:dragover={(e) => handleListDragOver(e, group, true)}
                            on:dragleave={handleListDragLeave}
                            on:drop|preventDefault={() => handleListDrop(group)}
                            on:contextmenu={(e) => showItemContextMenu(e, { id: group.id, name: group.name, type: "group" })}
                        >
                            <div class="quick-grid-card-title-wrap">
                                <!-- svelte-ignore a11y-click-events-have-key-events -->
                                <span class="quick-modal-group-chevron" on:click|stopPropagation={() => toggleGroup(group)}>
                                    {group.isExpanded ? "▼" : "▶"}
                                </span>

                                {#if editingItemId === group.id}
                                    <input 
                                        type="text" 
                                        class="quick-modal-inline-rename-input"
                                        bind:value={editingName}
                                        bind:this={renameInputEl}
                                        on:blur={commitRename}
                                    />
                                {:else}
                                    <span class="quick-grid-card-title" on:click={() => toggleGroup(group)}>
                                        {group.name}
                                    </span>
                                {/if}
                            </div>

                            <span class="quick-grid-card-count">
                                {group.items ? group.items.length : 0}
                            </span>
                        </div>

                        {#if group.isExpanded && group.items && group.items.length > 0}
                            <div class="quick-grid-card-items">
                                {#each group.items as child (child.id)}
                                    <div 
                                        class="quick-modal-list-item is-grid-item"
                                        class:is-focused={flatCategories[focusedIndex]?.filepath === child.filepath}
                                        class:drag-over-top={dragOverListId === child.id && dragListPosition === "top"}
                                        class:drag-over-bottom={dragOverListId === child.id && dragListPosition === "bottom"}
                                        data-filepath={child.filepath}
                                        role="button"
                                        tabindex="0"
                                        draggable="true"
                                        on:dragstart={(e) => handleListDragStart(e, child)}
                                        on:dragover={(e) => handleListDragOver(e, child, false)}
                                        on:dragleave={handleListDragLeave}
                                        on:drop|preventDefault={() => handleListDrop(child)}
                                        on:click={() => openCategoryInCenterOnly(child)}
                                        on:contextmenu={(e) => showItemContextMenu(e, { id: child.id || "", name: child.name, type: "category", filepath: child.filepath })}
                                    >
                                        <span class="quick-modal-list-icon">📁</span>
                                        
                                        {#if editingItemId === child.id}
                                            <input 
                                                type="text" 
                                                class="quick-modal-inline-rename-input"
                                                bind:value={editingName}
                                                bind:this={renameInputEl}
                                                on:blur={commitRename}
                                            />
                                        {:else}
                                            <span class="quick-modal-list-name" title={child.name}>{child.name}</span>
                                        {/if}

                                        {#if (taskCounts[child.filepath] ?? 0) > 0}
                                            <span class="quick-modal-badge">{taskCounts[child.filepath]}</span>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}
            {/if}
        </div>
    {:else}
        <!-- =============================================
             Classic Single-Column Hierarchical Tree Body
             ============================================= -->
        <div class="quick-list-scrollable">
            {#if filteredItems.length === 0}
                <div class="quick-modal-empty">No matching lists or groups found.</div>
            {:else}
                {#each filteredItems as item (item.id)}
                    {#if item.type === "group"}
                        <!-- Group Header -->
                        <div 
                            class="quick-modal-group-container"
                            class:drag-over-top={dragOverListId === item.id && dragListPosition === "top"}
                            class:drag-over-bottom={dragOverListId === item.id && dragListPosition === "bottom"}
                            class:drag-over-inside={dragOverListId === item.id && dragListPosition === "inside"}
                        >
                            <div 
                                class="quick-modal-group-header"
                                draggable="true"
                                on:dragstart={(e) => handleListDragStart(e, item)}
                                on:dragover={(e) => handleListDragOver(e, item, true)}
                                on:dragleave={handleListDragLeave}
                                on:drop|preventDefault={() => handleListDrop(item)}
                                on:contextmenu={(e) => showItemContextMenu(e, { id: item.id, name: item.name, type: "group" })}
                            >
                                <!-- svelte-ignore a11y-click-events-have-key-events -->
                                <span class="quick-modal-group-chevron" on:click|stopPropagation={() => toggleGroup(item)}>
                                    {item.isExpanded ? "▼" : "▶"}
                                </span>

                                {#if editingItemId === item.id}
                                    <input 
                                        type="text" 
                                        class="quick-modal-inline-rename-input"
                                        bind:value={editingName}
                                        bind:this={renameInputEl}
                                        on:blur={commitRename}
                                    />
                                {:else}
                                    <span class="quick-modal-group-title" on:click={() => toggleGroup(item)}>
                                        {item.name}
                                    </span>
                                {/if}
                            </div>

                            <!-- Nested Group Children -->
                            {#if item.isExpanded && item.items}
                                <div class="quick-modal-group-children">
                                    {#each item.items as child (child.id)}
                                        <div 
                                            class="quick-modal-list-item is-nested"
                                            class:is-focused={flatCategories[focusedIndex]?.filepath === child.filepath}
                                            class:drag-over-top={dragOverListId === child.id && dragListPosition === "top"}
                                            class:drag-over-bottom={dragOverListId === child.id && dragListPosition === "bottom"}
                                            data-filepath={child.filepath}
                                            role="button"
                                            tabindex="0"
                                            draggable="true"
                                            on:dragstart={(e) => handleListDragStart(e, child)}
                                            on:dragover={(e) => handleListDragOver(e, child, false)}
                                            on:dragleave={handleListDragLeave}
                                            on:drop|preventDefault={() => handleListDrop(child)}
                                            on:click={() => openCategoryInCenterOnly(child)}
                                            on:contextmenu={(e) => showItemContextMenu(e, { id: child.id || "", name: child.name, type: "category", filepath: child.filepath })}
                                        >
                                            <span class="quick-modal-list-icon">📁</span>
                                            
                                            {#if editingItemId === child.id}
                                                <input 
                                                    type="text" 
                                                    class="quick-modal-inline-rename-input"
                                                    bind:value={editingName}
                                                    bind:this={renameInputEl}
                                                    on:blur={commitRename}
                                                />
                                            {:else}
                                                <span class="quick-modal-list-name">{child.name}</span>
                                            {/if}

                                            {#if (taskCounts[child.filepath] ?? 0) > 0}
                                                <span class="quick-modal-badge">{taskCounts[child.filepath]}</span>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {:else}
                        <!-- Root Category Item -->
                        <div 
                            class="quick-modal-list-item"
                            class:is-focused={flatCategories[focusedIndex]?.filepath === item.filepath}
                            class:drag-over-top={dragOverListId === item.id && dragListPosition === "top"}
                            class:drag-over-bottom={dragOverListId === item.id && dragListPosition === "bottom"}
                            data-filepath={item.filepath}
                            role="button"
                            tabindex="0"
                            draggable="true"
                            on:dragstart={(e) => handleListDragStart(e, item)}
                            on:dragover={(e) => handleListDragOver(e, item, false)}
                            on:dragleave={handleListDragLeave}
                            on:drop|preventDefault={() => handleListDrop(item)}
                            on:click={() => openCategoryInCenterOnly(item)}
                            on:contextmenu={(e) => showItemContextMenu(e, { id: item.id || "", name: item.name, type: "category", filepath: item.filepath })}
                        >
                            <span class="quick-modal-list-icon">📁</span>
                            
                            {#if editingItemId === item.id}
                                <input 
                                    type="text" 
                                    class="quick-modal-inline-rename-input"
                                    bind:value={editingName}
                                    bind:this={renameInputEl}
                                    on:blur={commitRename}
                                />
                            {:else}
                                <span class="quick-modal-list-name">{item.name}</span>
                            {/if}

                            {#if (taskCounts[item.filepath] ?? 0) > 0}
                                <span class="quick-modal-badge">{taskCounts[item.filepath]}</span>
                            {/if}
                        </div>
                    {/if}
                {/each}
            {/if}
        </div>
    {/if}

    <!-- Bottom Action Bar & Status Bar Footer -->
    <div class="quick-modal-list-pane-footer">
        {#if isAddingList}
            <div class="quick-modal-footer-add-wrap">
                <input 
                    type="text" 
                    class="quick-modal-inline-add-input"
                    placeholder="New list name (Enter to save, Esc to cancel)..."
                    bind:value={newListName}
                    bind:this={addListInputEl}
                    on:blur={commitAddList}
                />
            </div>
        {:else if isAddingGroup}
            <div class="quick-modal-footer-add-wrap">
                <input 
                    type="text" 
                    class="quick-modal-inline-add-input"
                    placeholder="New group name (Enter to save, Esc to cancel)..."
                    bind:value={newGroupName}
                    bind:this={addGroupInputEl}
                    on:blur={commitAddGroup}
                />
            </div>
        {:else}
            <button class="quick-modal-bottom-btn" on:click={startAddList}>+ New list</button>
            <button class="quick-modal-bottom-btn" on:click={startAddGroup}>+ New group</button>
        {/if}
    </div>

    <div class="quick-modal-status-bar">
        <span><b>↑↓←→</b> Navigate</span>
        <span><b>F2</b> Rename</span>
        <span><b>Enter</b> Open in Center View</span>
        <span><b>Esc</b> Close</span>
    </div>
</div>
