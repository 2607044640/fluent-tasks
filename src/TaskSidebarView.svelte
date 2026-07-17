<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, type SidebarItem, type CategoryInfo, DATA_FOLDER } from "./types";
    import { killDndGhostElement, injectDndGhostShield, removeDndGhostShield } from "./utils/dndUtils";
    import { INPUT_FOCUS_DELAY_MS, BLUR_CONFIRM_DELAY_MS, DND_SHIELD_REMOVAL_DELAY_MS, DND_RESCUE_DELAY_MS } from "./constants";
    import { Menu, type App, type TAbstractFile, type EventRef } from "obsidian";

    // =============================================
    // Props
    // =============================================
    export let app: App;
    export let dataService: DataService;

    // =============================================
    // State
    // =============================================
    let sidebarItems: SidebarItem[] = [];
    let activeCategoryPath: string = "";
    let dragOverPath: string = ""; // For task dragging
    let draggedItemId: string = ""; // For HTML5 DnD
    let dragOverId: string = ""; // For HTML5 DnD
    let dragPosition: "top" | "bottom" | "inside" | null = null; // For HTML5 DnD
    
    let isAddingList: boolean = false;
    let newListName: string = "";
    
    let isAddingGroup: boolean = false;
    let newGroupName: string = "";

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
                    if (activeCategoryPath && !exists) {
                        activeCategoryPath = "";
                        EventBus.emit(EventName.CATEGORY_SELECTED, { category: null });
                    }
                }
            };

            vaultEventRefs.push(app.vault.on("create", handleVaultChange));
            vaultEventRefs.push(app.vault.on("delete", handleVaultChange));
            vaultEventRefs.push(app.vault.on("rename", handleVaultChange));
        });

        window.addEventListener("pointermove", handleGlobalPointerMove, true);
    });

    onDestroy(() => {
        window.removeEventListener("pointermove", handleGlobalPointerMove, true);
        vaultEventRefs.forEach(ref => app.vault.offref(ref));
    });

    async function loadSidebarItems() {
        sidebarItems = await dataService.getSidebarItems();
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

    async function handleCategoryContextMenu(e: MouseEvent, cat: CategoryInfo) {
        e.preventDefault();
        const menu = new Menu();

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

    async function moveListToGroup(listId: string, targetGroupId: string) {
        let listToMove: SidebarItem | null = null;
        let nextSidebarItems: SidebarItem[] = [];

        // Find and extract the item immutably from sidebarItems
        for (const item of sidebarItems) {
            if (item.id === listId) {
                listToMove = item;
            } else if (item.type === "group") {
                const childIdx = item.items.findIndex(c => c.id === listId);
                if (childIdx !== -1) {
                    listToMove = item.items[childIdx];
                    nextSidebarItems.push({
                        ...item,
                        items: item.items.filter(c => c.id !== listId)
                    });
                } else {
                    nextSidebarItems.push(item);
                }
            } else {
                nextSidebarItems.push(item);
            }
        }

        if (!listToMove) return;

        // 2. Insert the item into its new destination immutably
        if (targetGroupId === "root") {
            nextSidebarItems = [...nextSidebarItems, listToMove];
        } else {
            nextSidebarItems = nextSidebarItems.map(item => {
                if (item.type === "group" && item.id === targetGroupId) {
                    return {
                        ...item,
                        isExpanded: true,
                        items: [...item.items, listToMove as CategoryInfo]
                    };
                }
                return item;
            });
        }

        sidebarItems = nextSidebarItems;
        await dataService.saveSidebarState(sidebarItems);
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

    function handleDragOver(e: DragEvent, target: SidebarItem | CategoryInfo, parentGroup?: GroupInfo) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

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
                if (relativeY < rect.height * 0.5) {
                    dragPosition = "top";
                } else {
                    dragPosition = "bottom";
                }
            } else {
                if (relativeY < rect.height * 0.25) {
                    dragPosition = "top";
                } else if (relativeY > rect.height * 0.75) {
                    dragPosition = "bottom";
                } else {
                    dragPosition = "inside";
                }
            }
        } else {
            if (relativeY < rect.height * 0.5) {
                dragPosition = "top";
            } else {
                dragPosition = "bottom";
            }
        }
    }

    function handleDragEnd() {
        draggedItemId = "";
        dragOverId = "";
        dragPosition = null;
        (window as any).__mstodo_category_drag = false;
    }

    async function handleDrop(e: DragEvent, target: SidebarItem | CategoryInfo, parentGroup?: GroupInfo) {
        e.preventDefault();
        
        const pos = dragPosition;
        const targetId = target.id;
        const movedItemId = draggedItemId; // Capture BEFORE resetting
        
        handleDragEnd(); // Reset dragging UI styles

        if (!pos || !movedItemId || targetId === movedItemId) return;

        let listToMove: SidebarItem | null = null;
        
        // Remove item from sidebarItems recursively and return the item
        const extractItem = (list: SidebarItem[]): SidebarItem[] => {
            const nextList: SidebarItem[] = [];
            for (const item of list) {
                if (item.id === movedItemId) {
                    listToMove = item;
                } else if (item.type === "group") {
                    const childIdx = item.items.findIndex(c => c.id === movedItemId);
                    if (childIdx !== -1) {
                        listToMove = item.items[childIdx];
                        nextList.push({
                            ...item,
                            items: item.items.filter(c => c.id !== movedItemId)
                        });
                    } else {
                        nextList.push(item);
                    }
                } else {
                    nextList.push(item);
                }
            }
            return nextList;
        };

        let tempItems = extractItem(sidebarItems);
        if (!listToMove) return;

        if (pos === "inside") {
            tempItems = tempItems.map(item => {
                if (item.type === "group" && item.id === targetId) {
                    return {
                        ...item,
                        isExpanded: true,
                        items: [...item.items, listToMove as CategoryInfo]
                    };
                }
                return item;
            });
        } else {
            const insertNextTo = (list: SidebarItem[], tId: string, itemToInsert: SidebarItem, p: "top" | "bottom"): SidebarItem[] => {
                const nextList: SidebarItem[] = [];
                for (const item of list) {
                    if (item.id === tId) {
                        if (p === "top") {
                            nextList.push(itemToInsert);
                            nextList.push(item);
                        } else {
                            nextList.push(item);
                            nextList.push(itemToInsert);
                        }
                    } else if (item.type === "group") {
                        const targetIdx = item.items.findIndex(c => c.id === tId);
                        if (targetIdx !== -1) {
                            const newChildren = [...item.items];
                            const filtered = newChildren.filter(c => c.id !== itemToInsert.id);
                            const insertIdx = filtered.findIndex(c => c.id === tId);
                            
                            if (p === "top") {
                                filtered.splice(insertIdx, 0, itemToInsert as CategoryInfo);
                            } else {
                                filtered.splice(insertIdx + 1, 0, itemToInsert as CategoryInfo);
                            }
                            
                            nextList.push({
                                ...item,
                                items: filtered
                            });
                        } else {
                            nextList.push(item);
                        }
                    } else {
                        nextList.push(item);
                    }
                }
                return nextList;
            };

            tempItems = insertNextTo(tempItems, targetId, listToMove, pos);
        }

        await saveAndSyncSidebarState(tempItems);
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

        let listToMove: SidebarItem | null = null;
        const extractItem = (list: SidebarItem[]): SidebarItem[] => {
            const nextList: SidebarItem[] = [];
            for (const item of list) {
                if (item.id === movedItemId) {
                    listToMove = item;
                } else if (item.type === "group") {
                    const childIdx = item.items.findIndex(c => c.id === movedItemId);
                    if (childIdx !== -1) {
                        listToMove = item.items[childIdx];
                        nextList.push({
                            ...item,
                            items: item.items.filter(c => c.id !== movedItemId)
                        });
                    } else {
                        nextList.push(item);
                    }
                } else {
                    nextList.push(item);
                }
            }
            return nextList;
        };

        let tempItems = extractItem(sidebarItems);
        if (!listToMove) return;

        // Append to the root list
        tempItems = [...tempItems, listToMove];

        await saveAndSyncSidebarState(tempItems);
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

    async function confirmAddList() {
        const name = newListName.trim();
        if (!name) {
            isAddingList = false;
            return;
        }
        try {
            const newCat = await dataService.createCategory(name);
            await loadSidebarItems();
            selectCategory(newCat);
        } catch (e) {
            console.error("[MStodo Sidebar] Failed to create list:", e);
        }
        isAddingList = false;
        newListName = "";
    }

    function handleNewListKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") confirmAddList();
        else if (e.key === "Escape") isAddingList = false;
    }

    function handleNewListBlur() {
        setTimeout(() => { if (isAddingList) confirmAddList(); }, BLUR_CONFIRM_DELAY_MS);
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

    async function confirmAddGroup() {
        const name = newGroupName.trim();
        if (!name) {
            isAddingGroup = false;
            return;
        }
        try {
            const newGroup = await dataService.createGroup(name);
            // Optimistic UI: Immediately inject the new group to prevent Obsidian cache race condition
            sidebarItems = [...sidebarItems, newGroup];
        } catch (e) {
            console.error("[MStodo Sidebar] Failed to create group:", e);
        }
        isAddingGroup = false;
        newGroupName = "";
    }

    function handleNewGroupKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") confirmAddGroup();
        else if (e.key === "Escape") isAddingGroup = false;
    }

    function handleNewGroupBlur() {
        setTimeout(() => { if (isAddingGroup) confirmAddGroup(); }, BLUR_CONFIRM_DELAY_MS);
    }

    // =============================================
    // Cross-Pane Drag Radar (Physics Collision)
    // =============================================
    function handleGlobalPointerMove(e: PointerEvent) {
        const ghost = document.getElementById('dnd-action-dragged-el') as HTMLElement;
        if (ghost) {
            const overModal = document.elementFromPoint(e.clientX, e.clientY)?.closest('.modal-container, .workspace-ribbon');
            ghost.style.opacity = overModal ? '0' : '1';
            if (overModal) {
                dragOverPath = "";
                return;
            }
        }

        const dragData = (window as any).__mstodo_drag_data;
        if (!dragData) {
            if (dragOverPath) dragOverPath = "";
            return;
        }

        const categoryEls = document.querySelectorAll(".category-item[data-filepath]");
        let found = false;
        categoryEls.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (
                e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom
            ) {
                dragOverPath = el.getAttribute("data-filepath") || "";
                found = true;
            }
        });
        if (!found) dragOverPath = "";
    }

    async function handleGlobalPointerUp(e: PointerEvent) {
        const dragData = (window as any).__mstodo_drag_data;
        if (!dragData) return;

        const targetPath = dragOverPath;
        dragOverPath = "";

        if (!targetPath) return;

        const { task, sourceFilepath } = dragData;
        if (sourceFilepath === targetPath) return;

        // Clear only for valid cross-category drops
        (window as any).__mstodo_drag_data = null;

        killDndGhostElement();
        injectDndGhostShield();

        try {
            await dataService.moveTask(task, sourceFilepath, targetPath);
            EventBus.emit(EventName.TASK_MOVED, {
                task, sourcePath: sourceFilepath, targetPath
            });
        } catch (err) {
            console.error("[MStodo Sidebar] Move failed:", err);
        }

        setTimeout(() => removeDndGhostShield(), DND_SHIELD_REMOVAL_DELAY_MS);
    }

    function handleRescuePointerUp(e: PointerEvent) {
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
</script>

<svelte:window 
    on:pointerup|capture={handleGlobalPointerUp} 
    on:pointerup|capture={handleRescuePointerUp} 
/>

<div class="sidebar-container">
    <div class="custom-lists" 
         data-root="true"
         role="list"
         class:drag-over-bottom={dragOverId === "root-bottom"}
         on:dragover={handleRootDragOver}
         on:drop={handleRootDrop}
    >
        {#each sidebarItems as item (item.id)}
            <div
                draggable="true"
                on:dragstart={(e) => handleDragStart(e, item)}
                on:dragover|stopPropagation={(e) => handleDragOver(e, item)}
                on:drop|stopPropagation={(e) => handleDrop(e, item)}
                on:dragend={handleDragEnd}
                class={item.type === 'category' ? 'category-item' : 'group-container'}
                class:active={item.type === 'category' && activeCategoryPath === item.filepath}
                class:drag-over={(dragOverId === item.id && dragPosition === 'inside') || (item.type === 'category' && dragOverPath === item.filepath)}
                class:drag-over-top={dragOverId === item.id && dragPosition === 'top'}
                class:drag-over-bottom={dragOverId === item.id && dragPosition === 'bottom'}
                data-filepath={item.type === 'category' ? item.filepath : undefined}
                on:click={item.type === 'category' ? () => selectCategory(item) : undefined}
                on:contextmenu={item.type === 'category' ? (e) => handleCategoryContextMenu(e, item) : undefined}
                on:keydown={item.type === 'category' ? (e) => e.key === "Enter" && selectCategory(item) : undefined}
                tabindex={item.type === 'category' ? "0" : undefined}
                role={item.type === 'category' ? "button" : undefined}
            >
                {#if item.type === "group"}
                    <div class="group-header" data-groupid={item.id} on:click|stopPropagation={() => toggleGroup(item)} role="button" tabindex="0" on:keydown={(e) => e.key === "Enter" && toggleGroup(item)}>
                        <span class="group-name">{item.name}</span>
                        <svg class="chevron {item.isExpanded ? 'expanded' : ''}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                    {#if item.isExpanded}
                        <div class="group-items"
                             data-groupid={item.id}
                             class:empty={item.items.length === 0}
                             class:drag-over={dragOverId === item.id && dragPosition === 'inside'}
                             on:dragover|stopPropagation={(e) => handleDragOver(e, item)}
                             on:drop|stopPropagation={(e) => handleDrop(e, item)}
                             role="list">
                            {#each item.items as cat (cat.id)}
                                <div
                                    draggable="true"
                                    on:dragstart|stopPropagation={(e) => handleDragStart(e, cat)}
                                    on:dragover|stopPropagation={(e) => handleDragOver(e, cat, item)}
                                    on:drop|stopPropagation={(e) => handleDrop(e, cat, item)}
                                    on:dragend|stopPropagation={handleDragEnd}
                                    class="category-item"
                                    class:active={activeCategoryPath === cat.filepath}
                                    class:drag-over={dragOverPath === cat.filepath}
                                    class:drag-over-top={dragOverId === cat.id && dragPosition === 'top'}
                                    class:drag-over-bottom={dragOverId === cat.id && dragPosition === 'bottom'}
                                    data-filepath={cat.filepath}
                                    on:click={() => selectCategory(cat)}
                                    on:contextmenu={(e) => handleCategoryContextMenu(e, cat)}
                                    on:keydown={(e) => e.key === "Enter" && selectCategory(cat)}
                                    tabindex="0"
                                    role="button"
                                >
                                    <span class="cat-icon">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                        </svg>
                                    </span>
                                    <span class="cat-name">{cat.name}</span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                {:else if item.type === "category"}
                    <span class="cat-icon drag-handle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                        </svg>
                    </span>
                    <span class="cat-name drag-handle">{item.name}</span>
                {/if}
            </div>
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
                 on:keydown={(e) => e.key === "Enter" && startAddingList()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span>New list</span>
            </div>
            
            <div class="add-group-btn" on:click={startAddingGroup} role="button" tabindex="0"
                 on:keydown={(e) => e.key === "Enter" && startAddingGroup()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="New group">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    <line x1="12" y1="11" x2="12" y2="17"/>
                    <line x1="9" y1="14" x2="15" y2="14"/>
                </svg>
            </div>
        {/if}
    </div>
</div>
