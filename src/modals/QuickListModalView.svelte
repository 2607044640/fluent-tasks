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

    $: flatCategories = getFlatCategories(sidebarItems);
    $: isFiltering = !!searchQuery.trim();
    $: filteredItems = filterSidebarTree(sidebarItems, searchQuery);

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
        flatCategories = getFlatCategories(sidebarItems);
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
    // Keyboard Physics
    // =============================================
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
            if (flatCategories.length > 0) {
                focusedIndex = Math.min(flatCategories.length - 1, focusedIndex + 1);
                scrollFocusedIntoView();
            }
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            if (flatCategories.length > 0) {
                focusedIndex = Math.max(0, focusedIndex - 1);
                scrollFocusedIntoView();
            }
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
                el.scrollIntoView({ block: "nearest", behavior: "auto" });
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

    <!-- Search Header -->
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
            placeholder="Type to filter lists (↑↓ navigate, F2 rename, Enter to open in center)..."
            bind:value={searchQuery}
            bind:this={searchInputEl}
        />
        {#if searchQuery}
            <button class="quick-modal-filter-clear" on:click={() => { searchQuery = ""; searchInputEl?.focus(); }}>✕</button>
        {/if}
    </div>

    <!-- Hierarchical Tree Body -->
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

            <!-- Inline Add Inputs -->
            {#if isAddingList}
                <div class="quick-modal-add-form">
                    <input 
                        type="text" 
                        class="quick-modal-inline-add-input"
                        placeholder="New list name (Enter to save, Esc to cancel)..."
                        bind:value={newListName}
                        bind:this={addListInputEl}
                        on:blur={commitAddList}
                    />
                </div>
            {/if}

            {#if isAddingGroup}
                <div class="quick-modal-add-form">
                    <input 
                        type="text" 
                        class="quick-modal-inline-add-input"
                        placeholder="New group name (Enter to save, Esc to cancel)..."
                        bind:value={newGroupName}
                        bind:this={addGroupInputEl}
                        on:blur={commitAddGroup}
                    />
                </div>
            {/if}
        {/if}
    </div>

    <!-- Bottom Action Bar & Status Bar Footer -->
    <div class="quick-modal-list-pane-footer">
        <button class="quick-modal-bottom-btn" on:click={startAddList}>+ New list</button>
        <button class="quick-modal-bottom-btn" on:click={startAddGroup}>+ New group</button>
    </div>

    <div class="quick-modal-status-bar">
        <span><b>↑↓</b> Navigate</span>
        <span><b>F2</b> Rename</span>
        <span><b>Enter</b> Open in Center View</span>
        <span><b>Esc</b> Close</span>
    </div>
</div>
