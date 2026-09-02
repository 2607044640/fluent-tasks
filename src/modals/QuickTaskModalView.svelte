<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { DataService } from "../DataService";
    import { EventBus } from "../EventBus";
    import { EventName } from "../types";
    import type { CategoryInfo, SidebarItem, TaskItem, GroupInfo } from "../types";
    import { moveSidebarItem, toggleGroupExpandedState, getFlatCategories } from "../utils/sidebarTreeUtils";
    import { calculatePopoverPosition } from "../utils/popoverUtils";
    import { INPUT_FOCUS_DELAY_MS, POPOVER_HIDE_DELAY_MS } from "../constants";
    import { Menu, Notice } from "obsidian";

    // =============================================
    // Props
    // =============================================
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
    let selectedCategory: CategoryInfo | null = null;
    let incompleteTasks: TaskItem[] = [];
    let completedTasks: TaskItem[] = [];
    let taskCounts: Record<string, number> = {};

    // Search State
    let searchQuery: string = "";
    let isSearching: boolean = false;
    let searchResults: any[] = [];

    // Focus & Navigation State
    let focusPane: string = "lists";
    let focusedCategoryIndex: number = 0;
    let focusedCategoryPath: string = "";
    let focusedTaskIndex: number = 0;
    let focusedTaskId: string = "";

    // Inline Add Task State
    let isAddingTask: boolean = false;
    let newTaskTitle: string = "";

    // Inline Add List / Group State
    let isAddingList: boolean = false;
    let newListName: string = "";
    let isAddingGroup: boolean = false;
    let newGroupName: string = "";

    // Inline Rename State
    let editingItemId: string = "";
    let editingItemType: string = "category";
    let editingName: string = "";
    let renameInputEl: HTMLInputElement;

    // DOM Element Bindings
    let searchInputEl: HTMLInputElement;
    let modalContainerEl: HTMLElement;
    let addTaskInputEl: HTMLInputElement;
    let addListInputEl: HTMLInputElement;
    let addGroupInputEl: HTMLInputElement;

    // Popover State
    let popoverVisible: boolean = false;
    let popoverTask: TaskItem | null = null;
    let popoverType: string | null = null;
    let popoverX: number = 0;
    let popoverY: number = 0;
    let popoverPlacement: string = "top";
    let popoverTimeout: any = null;

    // Drag-to-list & reorder state
    let draggedListId: string = "";
    let dragOverListId: string = "";
    let dragListPosition: string | null = null;
    let hoveredDropCategoryPath: string | null = null;

    $: flatCategories = getFlatCategories(sidebarItems);

    onMount(async () => {
        await loadData();
        EventBus.on(EventName.CATEGORY_LIST_CHANGED, handleExternalListChanged);
        EventBus.on(EventName.TASK_UPDATED, handleExternalTaskUpdated);

        setTimeout(() => {
            if (searchInputEl) searchInputEl.focus();
        }, 50);
    });

    onDestroy(() => {
        EventBus.off(EventName.CATEGORY_LIST_CHANGED, handleExternalListChanged);
        EventBus.off(EventName.TASK_UPDATED, handleExternalTaskUpdated);
    });

    function handleExternalListChanged() {
        void loadData();
    }

    function handleExternalTaskUpdated(payload: any) {
        if (selectedCategory && payload && payload.categoryFilepath === selectedCategory.filepath) {
            void loadTasksForCategory(selectedCategory);
        }
        void refreshTaskCounts();
    }

    async function loadData() {
        sidebarItems = await dataService.getSidebarItems();
        categories = await dataService.getCategories();
        await refreshTaskCounts();

        if (!selectedCategory && flatCategories.length > 0) {
            await selectCategory(flatCategories[0]);
        } else if (selectedCategory) {
            await loadTasksForCategory(selectedCategory);
        }
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

    async function selectCategory(cat: CategoryInfo) {
        if (!cat) return;
        selectedCategory = cat;
        focusedCategoryPath = cat.filepath;
        const idx = flatCategories.findIndex(c => c.filepath === cat.filepath);
        if (idx !== -1) focusedCategoryIndex = idx;
        await loadTasksForCategory(cat);
        focusedTaskIndex = 0;
    }

    async function loadTasksForCategory(cat: CategoryInfo) {
        const rawTasks = await dataService.getTasks(cat.filepath);
        incompleteTasks = rawTasks.filter(t => !t.completed);
        completedTasks = rawTasks.filter(t => t.completed);
        const all = incompleteTasks.concat(completedTasks);
        if (all.length > 0) {
            if (focusedTaskIndex >= all.length) focusedTaskIndex = 0;
            focusedTaskId = all[focusedTaskIndex]?.id || "";
        } else {
            focusedTaskId = "";
        }
    }

    async function toggleGroup(group: GroupInfo) {
        sidebarItems = toggleGroupExpandedState(sidebarItems, group.id);
        await dataService.saveSidebarState(sidebarItems);
    }

    async function handleSearchInput() {
        const query = searchQuery.trim();
        if (!query) {
            isSearching = false;
            searchResults = [];
            if (selectedCategory) await loadTasksForCategory(selectedCategory);
            return;
        }

        isSearching = true;
        searchResults = await dataService.searchTasks(query);
        focusPane = "tasks";
        focusedTaskIndex = 0;
        focusedTaskId = searchResults[0]?.task?.id || "";
    }

    function clearSearch() {
        searchQuery = "";
        isSearching = false;
        searchResults = [];
        if (selectedCategory) void loadTasksForCategory(selectedCategory);
        if (searchInputEl) searchInputEl.focus();
    }

    // =============================================
    // Popover Engine
    // =============================================
    function showPopover(e: any, taskItem: TaskItem | null, type: any) {
        if (popoverTimeout) clearTimeout(popoverTimeout);
        const target = e?.currentTarget as HTMLElement;
        if (!target) return;

        const pos = calculatePopoverPosition(target, type);
        popoverPlacement = pos.placement;
        popoverX = pos.x;
        popoverY = pos.y;

        popoverTask = taskItem;
        popoverType = type;
        popoverVisible = true;
    }

    function scheduleHidePopover() {
        if (popoverTimeout) clearTimeout(popoverTimeout);
        popoverTimeout = setTimeout(() => {
            popoverVisible = false;
        }, POPOVER_HIDE_DELAY_MS);
    }

    function cancelHidePopover() {
        if (popoverTimeout) clearTimeout(popoverTimeout);
    }

    function dismissPopover() {
        if (popoverTimeout) clearTimeout(popoverTimeout);
        popoverVisible = false;
    }

    function handleNoteLinkHover(e: MouseEvent, noteLink?: string) {
        if (!noteLink || !plugin || !plugin.app) return;
        const cleanLink = noteLink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        if (!cleanLink) return;
        plugin.app.workspace.trigger("hover-link", {
            event: e,
            source: "fluent-tasks",
            hoverParent: modalContainerEl,
            targetEl: e.currentTarget,
            linktext: cleanLink,
            sourcePath: selectedCategory?.filepath || "",
        });
    }

    function handleNoteLinkClick(e: MouseEvent, noteLink?: string) {
        if (!noteLink || !plugin || !plugin.app) return;
        const cleanLink = noteLink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        if (!cleanLink) return;
        plugin.app.workspace.openLinkText(cleanLink, selectedCategory?.filepath || "", e.ctrlKey || e.metaKey);
        closeModal();
    }

    // =============================================
    // Drag & Drop Tasks
    // =============================================
    function handleTaskDragStart(e: DragEvent, taskItem: TaskItem) {
        if (!selectedCategory) return;
        (window as any).__mstodo_drag_data = {
            taskId: taskItem.id,
            task: taskItem,
            sourceFilepath: selectedCategory.filepath,
        };
        if (e.dataTransfer) {
            e.dataTransfer.setData("text/plain", taskItem.id);
            e.dataTransfer.effectAllowed = "move";
        }
    }

    async function handleTaskDropOnCategory(targetCat: CategoryInfo) {
        const dragData = (window as any).__mstodo_drag_data;
        if (!dragData || !dragData.task || !dragData.sourceFilepath) return;
        if (dragData.sourceFilepath === targetCat.filepath) return;

        hoveredDropCategoryPath = null;
        try {
            await dataService.moveTask(dragData.sourceFilepath, targetCat.filepath, dragData.task.id);
            EventBus.emit(EventName.TASK_UPDATED, { categoryFilepath: dragData.sourceFilepath });
            EventBus.emit(EventName.TASK_UPDATED, { categoryFilepath: targetCat.filepath });
            await loadData();
            new Notice(`Moved task to "${targetCat.name}"`);
        } catch (e) {
            console.error("[QuickTaskModal] Failed to move task:", e);
        }
    }

    // =============================================
    // Sidebar Drag & Drop (Tree Reordering)
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

        dragOverListId = target.id;
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
        const targetId = target.id;
        const pos = dragListPosition;

        draggedListId = "";
        dragOverListId = "";
        dragListPosition = null;

        if (movedId === targetId) return;

        sidebarItems = moveSidebarItem(sidebarItems, movedId, targetId, pos);
        await dataService.saveSidebarState(sidebarItems);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems });
    }

    function isTaskDragging(): boolean {
        return !!(window as any).__mstodo_drag_data;
    }

    function handleCategoryDragOver(e: DragEvent, cat: CategoryInfo) {
        if (isTaskDragging()) {
            hoveredDropCategoryPath = cat.filepath;
        } else {
            handleListDragOver(e, cat, false);
        }
    }

    function handleCategoryDragLeave(cat: CategoryInfo) {
        if (hoveredDropCategoryPath === cat.filepath) {
            hoveredDropCategoryPath = null;
        }
        handleListDragLeave();
    }

    function handleCategoryDrop(cat: CategoryInfo) {
        if (isTaskDragging()) {
            void handleTaskDropOnCategory(cat);
        } else {
            void handleListDrop(cat);
        }
    }

    // =============================================
    // Inline Rename & Context Menus
    // =============================================
    function startRenameItem(item: { id: string; name: string; type: string }) {
        editingItemId = item.id;
        editingItemType = item.type;
        editingName = item.name;
        setTimeout(() => {
            if (renameInputEl) {
                renameInputEl.focus();
                renameInputEl.select();
            }
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
            console.error("[QuickTaskModal] Rename failed:", e);
        }
        cancelRename();
    }

    function cancelRename() {
        editingItemId = "";
        editingName = "";
    }

    function showItemContextMenu(e: MouseEvent, item: { id: string; name: string; type: string; filepath?: string }) {
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
                 } else if (item.type === "group") {
                     await dataService.deleteGroup(item.id);
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
        setTimeout(() => {
            if (addListInputEl) addListInputEl.focus();
        }, INPUT_FOCUS_DELAY_MS);
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
            await selectCategory(newCat);
        } catch (e) {
            new Notice(`Failed to create list: ${e}`);
        }
        isAddingList = false;
        newListName = "";
    }

    function startAddGroup() {
        isAddingGroup = true;
        newGroupName = "";
        setTimeout(() => {
            if (addGroupInputEl) addGroupInputEl.focus();
        }, INPUT_FOCUS_DELAY_MS);
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
    // Task Operations
    // =============================================
    async function toggleTaskCompletion(taskItem: TaskItem) {
        const catPath = isSearching 
            ? searchResults.find(r => r.task.id === taskItem.id)?.category.filepath 
            : selectedCategory?.filepath;
        if (!catPath) return;

        taskItem.completed = !taskItem.completed;
        await dataService.updateTask(catPath, taskItem);
        EventBus.emit(EventName.TASK_UPDATED, { task: taskItem, categoryFilepath: catPath });

        if (taskCounts[catPath] !== undefined) {
            taskCounts[catPath] = Math.max(0, taskCounts[catPath] + (taskItem.completed ? -1 : 1));
            taskCounts = { ...taskCounts };
        }

        if (isSearching) {
            searchResults = [...searchResults];
        } else if (selectedCategory) {
            await loadTasksForCategory(selectedCategory);
        }
    }

    async function toggleTaskStar(taskItem: TaskItem) {
        const catPath = isSearching 
            ? searchResults.find(r => r.task.id === taskItem.id)?.category.filepath 
            : selectedCategory?.filepath;
        if (!catPath) return;

        taskItem.starred = !taskItem.starred;
        await dataService.updateTask(catPath, taskItem);
        EventBus.emit(EventName.TASK_UPDATED, { task: taskItem, categoryFilepath: catPath });

        if (isSearching) searchResults = [...searchResults];
        else {
            incompleteTasks = [...incompleteTasks];
            completedTasks = [...completedTasks];
        }
    }

    async function deleteTaskSafely(taskItem: TaskItem) {
        const catPath = isSearching 
            ? searchResults.find(r => r.task.id === taskItem.id)?.category.filepath 
            : selectedCategory?.filepath;
        if (!catPath) return;

        await dataService.deleteTask(catPath, taskItem);
        EventBus.emit(EventName.TASK_DELETED, { task: taskItem, categoryFilepath: catPath });

        if (!taskItem.completed && taskCounts[catPath] !== undefined) {
            taskCounts[catPath] = Math.max(0, taskCounts[catPath] - 1);
            taskCounts = { ...taskCounts };
        }

        if (isSearching) {
            searchResults = searchResults.filter(r => r.task.id !== taskItem.id);
        } else if (selectedCategory) {
            await loadTasksForCategory(selectedCategory);
        }
        focusedTaskIndex = Math.max(0, Math.min(focusedTaskIndex, allDisplayedTasks.length - 1));
    }

    // =============================================
    // Inline Add Task
    // =============================================
    function startInlineAddTask() {
        if (!selectedCategory) return;
        isAddingTask = true;
        newTaskTitle = "";
        setTimeout(() => {
            if (addTaskInputEl) addTaskInputEl.focus();
        }, INPUT_FOCUS_DELAY_MS);
    }

    async function commitAddTask() {
        const title = newTaskTitle.trim();
        if (!title || !selectedCategory) {
            isAddingTask = false;
            newTaskTitle = "";
            return;
        }

        try {
            const newTask = await dataService.addTask(selectedCategory.filepath, title);
            EventBus.emit(EventName.TASK_UPDATED, { task: newTask, categoryFilepath: selectedCategory.filepath });
            if (taskCounts[selectedCategory.filepath] !== undefined) {
                taskCounts[selectedCategory.filepath]++;
                taskCounts = { ...taskCounts };
            }
            await loadTasksForCategory(selectedCategory);
            focusedTaskIndex = 0;
            focusPane = "tasks";
        } catch (e) {
            console.error("[QuickTaskModal] Failed to add task:", e);
        }
        isAddingTask = false;
        newTaskTitle = "";
    }

    function cancelAddTask() {
        isAddingTask = false;
        newTaskTitle = "";
    }

    // =============================================
    // Primary Action
    // =============================================
    async function handlePrimaryAction() {
        const action = plugin?.settings?.quickModalAction ?? "direct";

        if (action === "navigate") {
            if (plugin && typeof plugin.collapseSidebars === "function") {
                plugin.collapseSidebars(1200);
            }
            if (focusPane === "lists" && selectedCategory) {
                EventBus.emit(EventName.CATEGORY_SELECTED, { category: selectedCategory });
                closeModal();
            } else if (focusPane === "tasks" && allDisplayedTasks.length > 0) {
                const currentTask = allDisplayedTasks[focusedTaskIndex];
                const catPath = isSearching 
                    ? searchResults[focusedTaskIndex]?.category.filepath 
                    : selectedCategory?.filepath;
                const cat = categories.find(c => c.filepath === catPath) || selectedCategory;

                if (cat && currentTask) {
                    EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat });
                    EventBus.emit(EventName.TASK_SELECTED, { task: currentTask, categoryFilepath: cat.filepath });
                    EventBus.emit(EventName.TASK_NAVIGATE, { taskId: currentTask.id, isCompleted: currentTask.completed });
                    closeModal();
                }
            }
        } else {
            if (focusPane === "lists") {
                focusPane = "tasks";
                focusedTaskIndex = 0;
            } else if (focusPane === "tasks" && allDisplayedTasks.length > 0) {
                const currentTask = allDisplayedTasks[focusedTaskIndex];
                if (currentTask) {
                    await toggleTaskCompletion(currentTask);
                }
            }
        }
    }

    // =============================================
    // Keyboard Physics Engine
    // =============================================
    function handleKeydown(e: KeyboardEvent) {
        if (e.isComposing || e.keyCode === 229) return;

        if (e.key === "F2") {
            e.preventDefault();
            e.stopPropagation();
            if (focusPane === "lists" && flatCategories[focusedCategoryIndex]) {
                const cat = flatCategories[focusedCategoryIndex];
                startRenameItem({ id: cat.id, name: cat.name, type: "category" });
            }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
            e.preventDefault();
            e.stopPropagation();
            startInlineAddTask();
            return;
        }

        if (isAddingTask) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void commitAddTask();
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelAddTask();
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

        if (document.activeElement === searchInputEl) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                focusPane = "tasks";
                handleTasksKeydown(e.key);
                setTimeout(scrollFocusedIntoView, 10);
                return;
            } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void handlePrimaryAction();
                return;
            } else if (e.key === "Escape") {
                if (searchQuery) {
                    e.preventDefault();
                    e.stopPropagation();
                    clearSearch();
                    return;
                }
                return;
            }
            return;
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            if (focusPane === "lists") handleListsKeydown(e.key);
            else handleTasksKeydown(e.key);
            setTimeout(scrollFocusedIntoView, 10);
            return;
        }

        if (e.key === "ArrowLeft") {
            e.preventDefault();
            e.stopPropagation();
            focusPane = "lists";
            setTimeout(scrollFocusedIntoView, 10);
            return;
        }

        if (e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            focusPane = "tasks";
            setTimeout(scrollFocusedIntoView, 10);
            return;
        }

        if (e.key === " ") {
            if (focusPane === "tasks" && allDisplayedTasks.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const task = allDisplayedTasks[focusedTaskIndex];
                if (task) void toggleTaskCompletion(task);
            }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            if (focusPane === "tasks" && allDisplayedTasks.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const task = allDisplayedTasks[focusedTaskIndex];
                if (task) void toggleTaskStar(task);
            }
            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            void handlePrimaryAction();
            return;
        }

        if (e.key === "Delete" || e.key === "Backspace") {
            if (focusPane === "tasks" && allDisplayedTasks.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const task = allDisplayedTasks[focusedTaskIndex];
                if (task) void deleteTaskSafely(task);
            }
            return;
        }

        if (e.key === "Escape") {
            closeModal();
            return;
        }

        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            if (searchInputEl) searchInputEl.focus();
        }
    }

    function handleListsKeydown(key: string) {
        if (flatCategories.length === 0) return;
        if (key === "ArrowUp") {
            focusedCategoryIndex = Math.max(0, focusedCategoryIndex - 1);
        } else if (key === "ArrowDown") {
            focusedCategoryIndex = Math.min(flatCategories.length - 1, focusedCategoryIndex + 1);
        }
        const cat = flatCategories[focusedCategoryIndex];
        if (cat) {
            focusedCategoryPath = cat.filepath;
            void selectCategory(cat);
        }
    }

    function handleTasksKeydown(key: string) {
        const all = isSearching ? searchResults.map(r => r.task) : incompleteTasks.concat(completedTasks);
        if (all.length === 0) return;
        if (key === "ArrowUp") {
            focusedTaskIndex = Math.max(0, focusedTaskIndex - 1);
        } else if (key === "ArrowDown") {
            focusedTaskIndex = Math.min(all.length - 1, focusedTaskIndex + 1);
        }
        focusedTaskId = all[focusedTaskIndex]?.id || "";
    }

    function scrollFocusedIntoView() {
        const selector = focusPane === "lists" ? ".quick-modal-pane-lists .is-focused" : ".quick-modal-pane-tasks .is-focused";
        const el = modalContainerEl?.querySelector(selector) as HTMLElement | null;
        if (el) {
            el.scrollIntoView({ block: "nearest", behavior: "auto" });
        }
    }
</script>

<div 
    class="quick-modal-container"
    bind:this={modalContainerEl}
    on:keydown={handleKeydown}
    tabindex="0"
    role="region"
>
    {#if showTip}
        <div class="quick-modal-tip-banner">
            💡 提示: 在 <b>设置 → 快捷键</b> 中为 <code>Fluent Tasks: Open Quick Task Modal</code> 设置快捷键即可秒级呼出 (剩余 {remainingTips} 次提醒)
        </div>
    {/if}

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
            placeholder={isSearching ? "Search all tasks..." : "Type to search, or Ctrl+N to add task..."}
            bind:value={searchQuery}
            bind:this={searchInputEl}
            on:input={handleSearchInput}
        />
        {#if searchQuery}
            <button class="quick-modal-filter-clear" on:click={clearSearch}>✕</button>
        {/if}
    </div>

    <div class="quick-modal-dual-pane">
        <div class="quick-modal-pane-lists">
            <div class="quick-modal-pane-title">Lists & Groups</div>
            <div class="quick-modal-scrollable">
                {#each sidebarItems as item (item.id)}
                    {#if item.type === "group"}
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
                            {#if item.isExpanded && item.items}
                                <div class="quick-modal-group-children">
                                    {#each item.items as child (child.id)}
                                        <div 
                                            class="quick-modal-list-item is-nested"
                                            class:is-selected={selectedCategory?.filepath === child.filepath}
                                            class:is-focused={focusPane === 'lists' && flatCategories[focusedCategoryIndex]?.filepath === child.filepath}
                                            class:drop-hover={hoveredDropCategoryPath === child.filepath}
                                            class:drag-over-top={dragOverListId === child.id && dragListPosition === "top"}
                                            class:drag-over-bottom={dragOverListId === child.id && dragListPosition === "bottom"}
                                            role="button"
                                            tabindex="0"
                                            draggable="true"
                                            on:dragstart={(e) => handleListDragStart(e, child)}
                                            on:dragover={(e) => handleCategoryDragOver(e, child)}
                                            on:dragleave={() => handleCategoryDragLeave(child)}
                                            on:drop|preventDefault={() => handleCategoryDrop(child)}
                                            on:click={() => selectCategory(child)}
                                            on:contextmenu={(e) => showItemContextMenu(e, { id: child.id, name: child.name, type: "category", filepath: child.filepath })}
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
                        <div 
                            class="quick-modal-list-item"
                            class:is-selected={selectedCategory?.filepath === item.filepath}
                            class:is-focused={focusPane === 'lists' && flatCategories[focusedCategoryIndex]?.filepath === item.filepath}
                            class:drop-hover={hoveredDropCategoryPath === item.filepath}
                            class:drag-over-top={dragOverListId === item.id && dragListPosition === "top"}
                            class:drag-over-bottom={dragOverListId === item.id && dragListPosition === "bottom"}
                            role="button"
                            tabindex="0"
                            draggable="true"
                            on:dragstart={(e) => handleListDragStart(e, item)}
                            on:dragover={(e) => handleCategoryDragOver(e, item)}
                            on:dragleave={() => handleCategoryDragLeave(item)}
                            on:drop|preventDefault={() => handleCategoryDrop(item)}
                            on:click={() => selectCategory(item)}
                            on:contextmenu={(e) => showItemContextMenu(e, { id: item.id, name: item.name, type: "category", filepath: item.filepath })}
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
            </div>

            <div class="quick-modal-list-pane-footer">
                {#if isAddingList}
                    <div class="quick-modal-inline-add-row">
                        <input 
                            type="text" 
                            class="quick-modal-inline-add-input" 
                            placeholder="List name..."
                            bind:value={newListName}
                            bind:this={addListInputEl}
                            on:blur={commitAddList}
                        />
                    </div>
                {:else if isAddingGroup}
                    <div class="quick-modal-inline-add-row">
                        <input 
                            type="text" 
                            class="quick-modal-inline-add-input" 
                            placeholder="Group name..."
                            bind:value={newGroupName}
                            bind:this={addGroupInputEl}
                            on:blur={commitAddGroup}
                        />
                    </div>
                {:else}
                    <div class="quick-modal-footer-btn-row">
                        <div class="quick-modal-bottom-btn" on:click={startAddList} role="button" tabindex="0">
                            <span>+</span> New list
                        </div>
                        <div class="quick-modal-bottom-btn" on:click={startAddGroup} role="button" tabindex="0">
                            <span>📁+</span> New group
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <div class="quick-modal-pane-tasks">
            <div class="quick-modal-pane-title">
                {#if isSearching}
                    Search Results ({searchResults.length})
                {:else if selectedCategory}
                    {selectedCategory.name} ({incompleteTasks.length})
                {:else}
                    Tasks
                {/if}
            </div>

            <div class="quick-modal-scrollable">
                {#if isAddingTask}
                    <div class="quick-modal-add-row">
                        <input 
                            type="text" 
                            class="quick-modal-add-input" 
                            placeholder="What needs to be done? (Enter to add, Esc to cancel)"
                            bind:value={newTaskTitle}
                            bind:this={addTaskInputEl}
                            on:blur={commitAddTask}
                        />
                    </div>
                {/if}

                {#if isSearching}
                    {#if searchResults.length === 0}
                        <div class="quick-modal-empty">No matching tasks found.</div>
                    {:else}
                        <div class="quick-modal-tasks-list">
                            {#each searchResults as result (result.task.id)}
                                <div 
                                    class="quick-modal-task-item"
                                    class:is-focused={focusPane === 'tasks' && focusedTaskId === result.task.id}
                                    class:is-completed={result.task.completed}
                                    role="button"
                                    tabindex="0"
                                    on:click={() => toggleTaskCompletion(result.task)}
                                >
                                    <input 
                                        type="checkbox" 
                                        class="quick-modal-checkbox"
                                        checked={result.task.completed}
                                        on:click|stopPropagation={() => toggleTaskCompletion(result.task)}
                                    />
                                    <span class="quick-modal-task-title" class:is-done={result.task.completed}>
                                        {result.task.title}
                                    </span>
                                    <span class="quick-modal-search-category-badge">
                                        {result.category.name}
                                    </span>
                                    <span 
                                        class="quick-modal-star-btn"
                                        class:is-starred={result.task.starred}
                                        role="button"
                                        tabindex="-1"
                                        on:click|stopPropagation={() => toggleTaskStar(result.task)}
                                    >
                                        {result.task.starred ? "★" : "☆"}
                                    </span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                {:else}
                    {#if incompleteTasks.length === 0 && completedTasks.length === 0}
                        <div class="quick-modal-empty">No tasks in this list. Press Ctrl+N to add one.</div>
                    {:else}
                        <div class="quick-modal-tasks-list">
                            {#each incompleteTasks as task (task.id)}
                                <div 
                                    id={'task-' + task.id}
                                    draggable="true"
                                    on:dragstart={(e) => handleTaskDragStart(e, task)}
                                    class="quick-modal-task-item"
                                    class:is-focused={focusPane === 'tasks' && focusedTaskId === task.id}
                                    role="button"
                                    tabindex="0"
                                    on:click={() => toggleTaskCompletion(task)}
                                >
                                    <input 
                                        type="checkbox" 
                                        class="quick-modal-checkbox"
                                        checked={task.completed}
                                        on:click|stopPropagation={() => toggleTaskCompletion(task)}
                                    />
                                    <span class="quick-modal-task-title">
                                        {task.title}
                                    </span>
                                    {#if task.steps && task.steps.length > 0}
                                        <span 
                                            class="quick-modal-steps-badge"
                                            on:mouseenter={(e) => showPopover(e, task, 'steps')}
                                            on:mouseleave={scheduleHidePopover}
                                            role="button" tabindex="0"
                                        >
                                            {task.steps.filter(s => s.done).length}/{task.steps.length}
                                        </span>
                                    {/if}
                                    {#if task.why}
                                        <span 
                                            class="quick-modal-why-badge"
                                            on:mouseenter={(e) => showPopover(e, task, 'why')}
                                            on:mouseleave={scheduleHidePopover}
                                            role="button" tabindex="0"
                                        >?</span>
                                    {/if}
                                    {#if task.note_link}
                                        <span 
                                            class="meta-badge note-badge"
                                            on:mouseenter={(e) => handleNoteLinkHover(e, task.note_link)}
                                            on:click|stopPropagation={(e) => handleNoteLinkClick(e, task.note_link)}
                                            role="button" tabindex="0"
                                        >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                <polyline points="14 2 14 8 20 8"/>
                                            </svg>
                                        </span>
                                    {/if}
                                    <span 
                                        class="quick-modal-star-btn"
                                        class:is-starred={task.starred}
                                        role="button"
                                        tabindex="-1"
                                        on:click|stopPropagation={() => toggleTaskStar(task)}
                                    >
                                        {task.starred ? "★" : "☆"}
                                    </span>
                                </div>
                            {/each}
                        </div>
                        {#if completedTasks.length > 0}
                            <div class="quick-modal-completed-divider">
                                Completed ({completedTasks.length})
                            </div>
                            <div class="quick-modal-tasks-list">
                                {#each completedTasks as task (task.id)}
                                    <div 
                                        id={'task-' + task.id}
                                        draggable="true"
                                        on:dragstart={(e) => handleTaskDragStart(e, task)}
                                        class="quick-modal-task-item is-completed"
                                        class:is-focused={focusPane === 'tasks' && focusedTaskId === task.id}
                                        role="button"
                                        tabindex="0"
                                        on:click={() => toggleTaskCompletion(task)}
                                    >
                                        <input 
                                            type="checkbox" 
                                            class="quick-modal-checkbox"
                                            checked={task.completed}
                                            on:click|stopPropagation={() => toggleTaskCompletion(task)}
                                        />
                                        <span class="quick-modal-task-title is-done">
                                            {task.title}
                                        </span>
                                        {#if task.steps && task.steps.length > 0}
                                            <span 
                                                class="quick-modal-steps-badge"
                                                on:mouseenter={(e) => showPopover(e, task, 'steps')}
                                                on:mouseleave={scheduleHidePopover}
                                                role="button" tabindex="0"
                                            >
                                                {task.steps.filter(s => s.done).length}/{task.steps.length}
                                            </span>
                                        {/if}
                                        {#if task.why}
                                            <span 
                                                class="quick-modal-why-badge"
                                                on:mouseenter={(e) => showPopover(e, task, 'why')}
                                                on:mouseleave={scheduleHidePopover}
                                                role="button" tabindex="0"
                                            >?</span>
                                        {/if}
                                        <span 
                                            class="quick-modal-star-btn"
                                            class:is-starred={task.starred}
                                            role="button"
                                            tabindex="-1"
                                            on:click|stopPropagation={() => toggleTaskStar(task)}
                                        >
                                            {task.starred ? "★" : "☆"}
                                        </span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    {/if}
                {/if}
            </div>
        </div>
    </div>

    <div class="quick-modal-status-bar">
        <span><b>↑↓</b> Move</span>
        <span><b>←→</b> Switch Pane</span>
        <span><b>Space</b> Toggle Check</span>
        <span><b>F2</b> Rename</span>
        <span><b>Ctrl+N</b> Add Task</span>
        <span><b>Ctrl+Enter</b> Star</span>
        <span><b>Enter</b> {plugin && plugin.settings && plugin.settings.quickModalAction === 'navigate' ? 'Open in Workspace' : 'Select'}</span>
        <span><b>Esc</b> Close</span>
    </div>
</div>

{#if popoverVisible && popoverTask}
    <div class="meta-popover placement-{popoverPlacement}"
         style="position: fixed; left: {popoverX}px; top: {popoverY}px; z-index: 10000;"
         on:mouseenter={cancelHidePopover}
         on:mouseleave={scheduleHidePopover}
         on:contextmenu|preventDefault={dismissPopover}
         role="tooltip">
        {#if popoverType === 'why' && popoverTask.why}
            <div class="meta-popover-header">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <span>Why</span>
                </div>
            </div>
            <div class="meta-popover-body">{popoverTask.why}</div>
        {:else if popoverType === 'steps' && popoverTask.steps && popoverTask.steps.length > 0}
            <div class="meta-popover-steps-card">
                <div class="meta-popover-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 11 12 14 22 4"/>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                        </svg>
                        <span style="font-weight: 600;">Subtasks Checklist</span>
                    </div>
                    <span class="meta-popover-hint">{popoverTask.steps.filter(s => s.done).length}/{popoverTask.steps.length} done</span>
                </div>
                <div class="popover-steps-list" style="margin-top: 6px;">
                    {#each popoverTask.steps as step}
                        <div class="popover-step-item" class:done={step.done}>
                            <span class="step-bullet">{step.done ? "✓" : "○"}</span>
                            <span class="step-text">{step.text}</span>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
{/if}
