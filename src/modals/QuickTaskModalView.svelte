<script lang="ts">
    import { onMount, tick } from "svelte";
    import { dndzone } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { DataService } from "../DataService";
    import { EventBus } from "../EventBus";
    import { EventName, type CategoryInfo, type SidebarItem, type TaskItem } from "../types";
    import { portal } from "../utils/domUtils";
    import { INPUT_FOCUS_DELAY_MS, POPOVER_HIDE_DELAY_MS } from "../constants";
    import { Platform } from "obsidian";

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
    let isDndActive = false;

    let searchQuery: string = "";
    let isSearching: boolean = false;
    let searchResults: Array<{ task: TaskItem; category: CategoryInfo; matchField: string }> = [];

    // Focus & Navigation State
    let focusPane: "lists" | "tasks" = "lists";
    let focusedCategoryIndex: number = 0;
    let focusedTaskIndex: number = 0;

    // Inline Add Task State
    let isAddingTask: boolean = false;
    let newTaskTitle: string = "";

    // DOM Element Bindings
    let modalContainerEl: HTMLElement;
    let searchInputEl: HTMLInputElement;
    let addTaskInputEl: HTMLInputElement;

    // Popover State
    let popoverVisible: boolean = false;
    let popoverTask: TaskItem | null = null;
    let popoverType: 'why' | 'svg' | 'custom' | 'title' | 'steps' | null = null;
    let popoverSvgIndex: number = 0;
    let popoverX: number = 0;
    let popoverY: number = 0;
    let popoverPlacement: 'top' | 'bottom' = 'top';
    let popoverTimeout: any = null;

    // Drag-to-list hovering state
    let hoveredDropCategoryPath: string | null = null;

    // Computed Flat Lists for indexing
    $: flatCategories = getFlatCategories(sidebarItems);
    $: allDisplayedTasks = isSearching ? searchResults.map(r => r.task) : [...incompleteTasks, ...completedTasks];

    function getFlatCategories(items: SidebarItem[]): CategoryInfo[] {
        const result: CategoryInfo[] = [];
        for (const item of items) {
            if (item.type === "category") {
                result.push(item);
            } else if (item.type === "group" && Array.isArray(item.items)) {
                for (const child of item.items) {
                    result.push(child);
                }
            }
        }
        return result;
    }

    // =============================================
    // Lifecycle & Loading
    // =============================================
    onMount(async () => {
        await loadData();

        setTimeout(() => {
            if (searchInputEl) {
                searchInputEl.focus();
            } else if (modalContainerEl) {
                modalContainerEl.focus();
            }
        }, 50);
    });

    async function loadData() {
        sidebarItems = await dataService.getSidebarItems();
        categories = await dataService.getCategories();
        flatCategories = getFlatCategories(sidebarItems);

        // Load active uncompleted counts for all lists in parallel
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

        if (!selectedCategory && flatCategories.length > 0) {
            await selectCategory(flatCategories[0]);
        } else if (selectedCategory) {
            await loadTasksForCategory(selectedCategory);
        }
    }

    async function selectCategory(cat: CategoryInfo) {
        selectedCategory = cat;
        const idx = flatCategories.findIndex(c => c.filepath === cat.filepath);
        if (idx !== -1) focusedCategoryIndex = idx;
        await loadTasksForCategory(cat);
        focusedTaskIndex = 0;
    }

    async function loadTasksForCategory(cat: CategoryInfo) {
        const rawTasks = await dataService.getTasks(cat.filepath);
        incompleteTasks = rawTasks.filter(t => !t.completed);
        completedTasks = rawTasks.filter(t => t.completed);
    }

    // =============================================
    // Search Handler
    // =============================================
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
    }

    function clearSearch() {
        searchQuery = "";
        isSearching = false;
        searchResults = [];
        searchInputEl?.focus();
    }

    // =============================================
    // Popover Engine
    // =============================================
    function showPopover(e: MouseEvent | { currentTarget: HTMLElement }, task: TaskItem | null, type: 'why' | 'svg' | 'custom' | 'title' | 'steps', svgIndex: number = 0) {
        if (popoverTimeout) clearTimeout(popoverTimeout);
        const target = e.currentTarget as HTMLElement;
        if (!target) return;
        const rect = target.getBoundingClientRect();

        const estimatedHeight = type === 'svg' ? 320 : type === 'title' ? 240 : type === 'steps' ? 200 : type === 'custom' ? 180 : 140;
        const estimatedHalfWidth = type === 'svg' ? 150 : type === 'title' ? 170 : type === 'steps' ? 150 : 140;

        const fitsAbove = rect.top >= estimatedHeight + 24;
        popoverPlacement = fitsAbove ? 'top' : 'bottom';

        const centerX = rect.left + rect.width / 2;
        popoverX = Math.max(estimatedHalfWidth + 16, Math.min(window.innerWidth - estimatedHalfWidth - 16, centerX));
        popoverY = fitsAbove ? (rect.top - 8) : (rect.bottom + 8);

        popoverTask = task;
        popoverType = type;
        popoverSvgIndex = svgIndex;
        popoverVisible = true;
    }

    function scheduleHidePopover() {
        if (popoverTimeout) clearTimeout(popoverTimeout);
        popoverTimeout = setTimeout(() => {
            popoverVisible = false;
            popoverTask = null;
            popoverType = null;
        }, POPOVER_HIDE_DELAY_MS);
    }

    function cancelHidePopover() {
        if (popoverTimeout) clearTimeout(popoverTimeout);
    }

    function dismissPopover() {
        if (popoverTimeout) clearTimeout(popoverTimeout);
        popoverVisible = false;
        popoverTask = null;
        popoverType = null;
    }

    function handleNoteLinkHover(e: MouseEvent, noteLink?: string) {
        if (!noteLink || !plugin?.app) return;
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
        if (!noteLink || !plugin?.app) return;
        const cleanLink = noteLink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        if (!cleanLink) return;
        plugin.app.workspace.openLinkText(cleanLink, selectedCategory?.filepath || "", e.ctrlKey || e.metaKey);
        closeModal();
    }

    // =============================================
    // Drag & Drop Tasks
    // =============================================
    function handleDndConsider(e: CustomEvent, listType: 'incomplete' | 'completed') {
        isDndActive = true;
        if (listType === 'incomplete') incompleteTasks = e.detail.items;
        else completedTasks = e.detail.items;

        const draggedId = e.detail.info?.id;
        const task = (listType === 'incomplete' ? incompleteTasks : completedTasks).find(t => t.id === draggedId);
        if (task && selectedCategory) {
            (window as any).__mstodo_drag_data = {
                taskId: task.id,
                task,
                sourceFilepath: selectedCategory.filepath,
                movedToTarget: null,
            };
        }
    }

    async function handleDndFinalize(e: CustomEvent, listType: 'incomplete' | 'completed') {
        isDndActive = false;
        if (listType === 'incomplete') incompleteTasks = e.detail.items;
        else completedTasks = e.detail.items;

        if (!selectedCategory) return;
        const allTasks = [...incompleteTasks, ...completedTasks];
        await dataService.saveTasks(selectedCategory.filepath, allTasks);
        EventBus.emit(EventName.TASK_UPDATED, { categoryFilepath: selectedCategory.filepath });
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
        } catch (e) {
            console.error("[QuickTaskModal] Failed to move task to list:", e);
        }
    }

    // =============================================
    // Task Operations (Direct in Modal)
    // =============================================
    async function toggleTaskCompletion(task: TaskItem) {
        const catPath = isSearching 
            ? searchResults.find(r => r.task.id === task.id)?.category.filepath 
            : selectedCategory?.filepath;
        if (!catPath) return;

        task.completed = !task.completed;
        await dataService.updateTask(catPath, task);
        EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath: catPath });

        if (taskCounts[catPath] !== undefined) {
            taskCounts[catPath] = Math.max(0, taskCounts[catPath] + (task.completed ? -1 : 1));
            taskCounts = { ...taskCounts };
        }

        if (isSearching) {
            searchResults = [...searchResults];
        } else if (selectedCategory) {
            await loadTasksForCategory(selectedCategory);
        }
    }

    async function toggleTaskStar(task: TaskItem) {
        const catPath = isSearching 
            ? searchResults.find(r => r.task.id === task.id)?.category.filepath 
            : selectedCategory?.filepath;
        if (!catPath) return;

        task.starred = !task.starred;
        await dataService.updateTask(catPath, task);
        EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath: catPath });

        if (isSearching) searchResults = [...searchResults];
        else {
            incompleteTasks = [...incompleteTasks];
            completedTasks = [...completedTasks];
        }
    }

    async function deleteTaskSafely(task: TaskItem) {
        const catPath = isSearching 
            ? searchResults.find(r => r.task.id === task.id)?.category.filepath 
            : selectedCategory?.filepath;
        if (!catPath) return;

        await dataService.deleteTask(catPath, task);
        EventBus.emit(EventName.TASK_DELETED, { task, categoryFilepath: catPath });

        if (!task.completed && taskCounts[catPath] !== undefined) {
            taskCounts[catPath] = Math.max(0, taskCounts[catPath] - 1);
            taskCounts = { ...taskCounts };
        }

        if (isSearching) {
            searchResults = searchResults.filter(r => r.task.id !== task.id);
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
            addTaskInputEl?.focus();
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
    // Primary Action (Enter Key / Click)
    // =============================================
    async function handlePrimaryAction() {
        const action = plugin?.settings?.quickModalAction ?? "direct";

        if (action === "navigate") {
            // Workspace Navigation Mode
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
            // Direct In-Modal Management Mode
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
            searchInputEl?.focus();
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
        if (cat) void selectCategory(cat);
    }

    function handleTasksKeydown(key: string) {
        if (allDisplayedTasks.length === 0) return;
        if (key === "ArrowUp") {
            focusedTaskIndex = Math.max(0, focusedTaskIndex - 1);
        } else if (key === "ArrowDown") {
            focusedTaskIndex = Math.min(allDisplayedTasks.length - 1, focusedTaskIndex + 1);
        }
    }

    function scrollFocusedIntoView() {
        const selector = focusPane === "lists" ? ".quick-modal-pane-lists .is-focused" : ".quick-modal-pane-tasks .is-focused";
        const el = modalContainerEl?.querySelector(selector) as HTMLElement | null;
        if (el) {
            el.scrollIntoView({ block: "nearest", behavior: "auto" });
        }
    }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions a11y-no-noninteractive-tabindex a11y-click-events-have-key-events -->
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

    <!-- Search & Filter Header -->
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

    <!-- Dual Pane Body -->
    <div class="quick-modal-dual-pane">
        <!-- Left Pane: Lists & Groups -->
        <div class="quick-modal-pane-lists">
            <div class="quick-modal-pane-title">Lists</div>
            <div class="quick-modal-scrollable">
                {#each flatCategories as cat, index (cat.filepath)}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <div 
                        class="quick-modal-list-item"
                        class:is-selected={selectedCategory?.filepath === cat.filepath}
                        class:is-focused={focusPane === 'lists' && focusedCategoryIndex === index}
                        class:drop-hover={hoveredDropCategoryPath === cat.filepath}
                        role="button"
                        tabindex="0"
                        on:click={() => selectCategory(cat)}
                        on:dragover|preventDefault={() => { hoveredDropCategoryPath = cat.filepath; }}
                        on:dragleave={() => { if (hoveredDropCategoryPath === cat.filepath) hoveredDropCategoryPath = null; }}
                        on:drop|preventDefault={() => handleTaskDropOnCategory(cat)}
                    >
                        <span class="quick-modal-list-icon">📁</span>
                        <span class="quick-modal-list-name">{cat.name}</span>
                        {#if (taskCounts[cat.filepath] ?? 0) > 0}
                            <span class="quick-modal-badge">{taskCounts[cat.filepath]}</span>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>

        <!-- Right Pane: Tasks Checklist -->
        <div class="quick-modal-pane-tasks">
            <div class="quick-modal-pane-header">
                <span class="quick-modal-pane-title">
                    {isSearching ? `Search Results (${searchResults.length})` : (selectedCategory?.name ?? "Tasks")}
                </span>
                {#if !isSearching && selectedCategory}
                    <button class="quick-modal-add-btn" on:click={startInlineAddTask}>
                        + Add Task (Ctrl+N)
                    </button>
                {/if}
            </div>

            <div class="quick-modal-scrollable">
                {#if isAddingTask}
                    <div class="quick-modal-add-box">
                        <input 
                            type="text" 
                            class="quick-modal-add-input"
                            placeholder="Task title (Enter to save, Esc to cancel)..."
                            bind:value={newTaskTitle}
                            bind:this={addTaskInputEl}
                        />
                    </div>
                {/if}

                {#if isSearching}
                    {#if searchResults.length === 0}
                        <div class="quick-modal-empty">No matching tasks found.</div>
                    {:else}
                        <div class="quick-modal-tasks-dnd-zone">
                            {#each searchResults as result, index (result.task.id)}
                                {@const task = result.task}
                                <!-- svelte-ignore a11y-click-events-have-key-events -->
                                <div 
                                    class="quick-modal-task-item"
                                    class:is-completed={task.completed}
                                    class:is-focused={focusPane === 'tasks' && focusedTaskIndex === index}
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
                                    
                                    <span class="quick-modal-task-title" class:is-done={task.completed}>
                                        {task.title}
                                    </span>

                                    {#if task.steps && task.steps.length > 0}
                                        <span 
                                            class="quick-modal-steps-badge"
                                            on:mouseenter={(e) => showPopover(e, task, 'steps')}
                                            on:mouseleave={scheduleHidePopover}
                                            role="button" tabindex="0"
                                            title="Subtasks preview"
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
                                            title="Why rationale"
                                        >?</span>
                                    {/if}

                                    {#if task.note_link}
                                        <span 
                                            class="meta-badge note-badge"
                                            on:mouseenter={(e) => handleNoteLinkHover(e, task.note_link)}
                                            on:click|stopPropagation={(e) => handleNoteLinkClick(e, task.note_link)}
                                            role="button" tabindex="0"
                                            title={`Note link: ${task.note_link}`}
                                        >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                <polyline points="14 2 14 8 20 8"/>
                                            </svg>
                                        </span>
                                    {/if}

                                    <!-- svelte-ignore a11y-click-events-have-key-events -->
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
                {:else}
                    {#if incompleteTasks.length === 0 && completedTasks.length === 0}
                        <div class="quick-modal-empty">No tasks in this list. Press Ctrl+N to add one.</div>
                    {:else}
                        <!-- Incomplete Tasks (DnD Zone) -->
                        <div 
                            class="quick-modal-tasks-dnd-zone"
                            use:dndzone={{ items: incompleteTasks, flipDurationMs: 200, dropTargetStyle: {} }}
                            on:consider={(e) => handleDndConsider(e, 'incomplete')}
                            on:finalize={(e) => handleDndFinalize(e, 'incomplete')}
                        >
                            {#each incompleteTasks as task, index (task.id)}
                                <div 
                                    animate:flip={{ duration: 200 }}
                                    class="quick-modal-task-item"
                                    class:is-focused={focusPane === 'tasks' && focusedTaskIndex === index}
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
                                            title="Hover to preview subtasks"
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
                                            title="Why rationale"
                                        >?</span>
                                    {/if}

                                    {#if task.note_link}
                                        <span 
                                            class="meta-badge note-badge"
                                            on:mouseenter={(e) => handleNoteLinkHover(e, task.note_link)}
                                            on:click|stopPropagation={(e) => handleNoteLinkClick(e, task.note_link)}
                                            role="button" tabindex="0"
                                            title={`Note: ${task.note_link}`}
                                        >
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                <polyline points="14 2 14 8 20 8"/>
                                            </svg>
                                        </span>
                                    {/if}

                                    <!-- svelte-ignore a11y-click-events-have-key-events -->
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

                        <!-- Completed Tasks Section -->
                        {#if completedTasks.length > 0}
                            <div class="quick-modal-completed-divider">
                                Completed ({completedTasks.length})
                            </div>
                            <div 
                                class="quick-modal-tasks-dnd-zone"
                                use:dndzone={{ items: completedTasks, flipDurationMs: 200, dropTargetStyle: {} }}
                                on:consider={(e) => handleDndConsider(e, 'completed')}
                                on:finalize={(e) => handleDndFinalize(e, 'completed')}
                            >
                                {#each completedTasks as task, index (task.id)}
                                    {@const overallIndex = incompleteTasks.length + index}
                                    <div 
                                        animate:flip={{ duration: 200 }}
                                        class="quick-modal-task-item is-completed"
                                        class:is-focused={focusPane === 'tasks' && focusedTaskIndex === overallIndex}
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

                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
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

    <!-- Status Bar Footer -->
    <div class="quick-modal-status-bar">
        <span><b>↑↓</b> Move</span>
        <span><b>←→</b> Switch Pane</span>
        <span><b>Space</b> Toggle Check</span>
        <span><b>Ctrl+Enter</b> Star</span>
        <span><b>Ctrl+N</b> Add</span>
        <span><b>Enter</b> {plugin?.settings?.quickModalAction === 'navigate' ? 'Open in Workspace' : 'Select'}</span>
        <span><b>Esc</b> Close</span>
    </div>
</div>

<!-- Portaled Meta Popover Tooltip -->
{#if popoverVisible && popoverTask}
    <div use:portal
         class="meta-popover placement-{popoverPlacement}"
         style="left: {popoverX}px; top: {popoverY}px;"
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
