<script lang="ts">
    import { onMount, tick } from "svelte";
    import { DataService } from "../DataService";
    import { EventBus } from "../EventBus";
    import { EventName, type CategoryInfo, type SidebarItem, type TaskItem } from "../types";
    import { type App, Notice } from "obsidian";
    import { INPUT_FOCUS_DELAY_MS } from "../constants";

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
    let tasks: TaskItem[] = [];
    let taskCounts: Record<string, number> = {};

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

    // Computed Flat Lists for indexing
    $: flatCategories = getFlatCategories(sidebarItems);
    $: displayedTasks = isSearching ? searchResults.map(r => r.task) : tasks;

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
        tasks = await dataService.getTasks(cat.filepath);
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

        // Update local count
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
        else tasks = [...tasks];
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
        focusedTaskIndex = Math.max(0, Math.min(focusedTaskIndex, displayedTasks.length - 1));
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
            } else if (focusPane === "tasks" && displayedTasks.length > 0) {
                const currentTask = displayedTasks[focusedTaskIndex];
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
            } else if (focusPane === "tasks" && displayedTasks.length > 0) {
                const currentTask = displayedTasks[focusedTaskIndex];
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
        // 0. IME Composition Guard
        if (e.isComposing || e.keyCode === 229) return;

        // Quick Add Shortcut: Ctrl+N / Cmd+N
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
            e.preventDefault();
            e.stopPropagation();
            startInlineAddTask();
            return;
        }

        // Inline Add Task Input Active
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

        // Inside Search Input
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
                // Allow escape to close modal naturally
                return;
            }
            return; // Allow typing characters inside search box
        }

        // Inside Modal List Body
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
            // Space toggles task completion
            if (focusPane === "tasks" && displayedTasks.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const task = displayedTasks[focusedTaskIndex];
                if (task) void toggleTaskCompletion(task);
            }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            // Ctrl+Enter toggles star
            if (focusPane === "tasks" && displayedTasks.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const task = displayedTasks[focusedTaskIndex];
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
            if (focusPane === "tasks" && displayedTasks.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const task = displayedTasks[focusedTaskIndex];
                if (task) void deleteTaskSafely(task);
            }
            return;
        }

        if (e.key === "Escape") {
            closeModal();
            return;
        }

        // Type-to-Search: press any key to jump back to search input
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
        if (displayedTasks.length === 0) return;
        if (key === "ArrowUp") {
            focusedTaskIndex = Math.max(0, focusedTaskIndex - 1);
        } else if (key === "ArrowDown") {
            focusedTaskIndex = Math.min(displayedTasks.length - 1, focusedTaskIndex + 1);
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
                        role="button"
                        tabindex="0"
                        on:click={() => selectCategory(cat)}
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

                {#if displayedTasks.length === 0}
                    <div class="quick-modal-empty">
                        {isSearching ? "No matching tasks found." : "No tasks in this list. Press Ctrl+N to add one."}
                    </div>
                {:else}
                    {#each displayedTasks as task, index (task.id)}
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
                                <span class="quick-modal-steps-badge">
                                    {task.steps.filter(s => s.done).length}/{task.steps.length}
                                </span>
                            {/if}

                            {#if task.why}
                                <span class="quick-modal-why-badge" title={task.why}>?</span>
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
