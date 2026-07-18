<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { dndzone, TRIGGERS } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, type CategoryInfo, type TaskItem } from "./types";
    import { killDndGhostElement, removeDndGhostShield, injectDndGhostShield } from "./utils/dndUtils";
    import { DISK_SYNC_DELAY_MS, ANTI_FLICKER_DURATION_MS } from "./constants";
    import { Menu, type App } from "obsidian";

    // =============================================
    // Props
    // =============================================
    export let dataService: DataService;

    // =============================================
    // State
    // =============================================
    let currentCategory: CategoryInfo | null = null;
    let incompleteTasks: TaskItem[] = [];
    let completedTasks: TaskItem[] = [];
    let newTaskTitle: string = "";
    let showCompleted: boolean = true;
    let selectedTaskId: string = "";

    // DND requires items to have an `id` field — our TaskItem already has it
    const DND_FLIP_DURATION = 200;

    // =============================================
    // Lifecycle
    // =============================================
    onMount(() => {
        EventBus.on(EventName.CATEGORY_SELECTED, handleCategorySelected);
        EventBus.on(EventName.TASK_UPDATED, handleTaskUpdated);
        EventBus.on(EventName.TASK_MOVED, handleTaskMoved);
        EventBus.on(EventName.TASK_DELETED, handleTaskDeleted);
    });

    onDestroy(() => {
        EventBus.off(EventName.CATEGORY_SELECTED, handleCategorySelected);
        EventBus.off(EventName.TASK_UPDATED, handleTaskUpdated);
        EventBus.off(EventName.TASK_MOVED, handleTaskMoved);
        EventBus.off(EventName.TASK_DELETED, handleTaskDeleted);
    });

    // =============================================
    // Data Loading
    // =============================================
    async function loadTasks() {
        if (!currentCategory) return;
        const tasks = await dataService.getTasks(currentCategory.filepath);
        
        incompleteTasks = tasks.filter(t => !t.completed);
        completedTasks = tasks.filter(t => t.completed);
    }

    // Called from main.ts when the view is activated directly
    export async function loadCategory(cat: CategoryInfo) {
        currentCategory = cat;
        selectedTaskId = "";
        await loadTasks();
    }

    // =============================================
    // EventBus Handlers
    // =============================================
    async function handleCategorySelected(payload: any) {
        await loadCategory(payload.category);
    }

    async function handleTaskUpdated(payload: any) {
        if (payload.categoryFilepath === currentCategory?.filepath) {
            await loadTasks();
        }
    }

    async function handleTaskMoved(payload: any) {
        if (payload.targetPath === currentCategory?.filepath) {
            // Task moved TO this category. Add it optimistically.
            const existsInIncomplete = incompleteTasks.find(t => t.id === payload.task.id);
            const existsInComplete = completedTasks.find(t => t.id === payload.task.id);
            if (!existsInIncomplete && !existsInComplete) {
                if (payload.task.completed) {
                    completedTasks = [...completedTasks, payload.task];
                } else {
                    incompleteTasks = [...incompleteTasks, payload.task];
                }
            }
        } else if (payload.sourcePath === currentCategory?.filepath) {
            // Task moved FROM this category. Ensure it's removed optimistically.
            incompleteTasks = incompleteTasks.filter(t => t.id !== payload.task.id);
            completedTasks = completedTasks.filter(t => t.id !== payload.task.id);
        }

        // Sync with disk after Obsidian has time to flush its cache
        setTimeout(async () => {
            if (currentCategory) await loadTasks();
        }, DISK_SYNC_DELAY_MS);
    }

    async function handleTaskDeleted(payload: any) {
        if (payload.categoryFilepath === currentCategory?.filepath) {
            // Optimistically remove
            incompleteTasks = incompleteTasks.filter(t => t.id !== payload.task.id);
            completedTasks = completedTasks.filter(t => t.id !== payload.task.id);
            if (selectedTaskId === payload.task.id) {
                selectedTaskId = "";
            }
        }
    }

    // =============================================
    // Task Actions
    // =============================================
    async function addTask() {
        const title = newTaskTitle.trim();
        if (!title || !currentCategory) return;

        const newTask = await dataService.addTask(currentCategory.filepath, title);
        newTaskTitle = "";

        // Optimistic UI: insert into local state immediately.
        // We do NOT call loadTasks() here because Obsidian's async I/O might cause a race condition.
        incompleteTasks = [...incompleteTasks, newTask];
    }

    function handleAddTaskKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            addTask();
        }
    }

    async function toggleComplete(task: TaskItem) {
        if (!currentCategory) return;

        // Optimistic UI: move the task visually first
        task.completed = !task.completed;
        if (task.completed) {
            incompleteTasks = incompleteTasks.filter(t => t.id !== task.id);
            completedTasks = [task, ...completedTasks];
        } else {
            completedTasks = completedTasks.filter(t => t.id !== task.id);
            incompleteTasks = [...incompleteTasks, task];
        }

        // Persist to disk
        await dataService.updateTask(currentCategory.filepath, task);
        EventBus.emit(EventName.TASK_UPDATED, {
            task,
            categoryFilepath: currentCategory.filepath,
        });
    }

    async function toggleStar(task: TaskItem) {
        if (!currentCategory) return;
        task.starred = !task.starred;

        // Update local arrays to trigger reactivity
        incompleteTasks = [...incompleteTasks];
        completedTasks = [...completedTasks];

        await dataService.updateTask(currentCategory.filepath, task);
        EventBus.emit(EventName.TASK_UPDATED, {
            task,
            categoryFilepath: currentCategory.filepath,
        });
    }

    function selectTask(task: TaskItem) {
        selectedTaskId = task.id;
        EventBus.emit(EventName.TASK_SELECTED, {
            task,
            categoryFilepath: currentCategory?.filepath || "",
        });
    }

    function toggleCompletedSection() {
        showCompleted = !showCompleted;
    }

    // =============================================
    // Drag & Drop (In-list reordering & Cross-Pane)
    // =============================================
    function handleDndConsider(e: CustomEvent, listType: 'incomplete' | 'completed') {
        if (listType === 'incomplete') incompleteTasks = e.detail.items;
        else completedTasks = e.detail.items;

        // Broadcast drag data for cross-pane drops (sidebar radar)
        const draggedId = e.detail.info.id;
        const task = (listType === 'incomplete' ? incompleteTasks : completedTasks).find(t => t.id === draggedId);
        if (task && currentCategory) {
            (window as any).__mstodo_drag_data = {
                task,
                sourceFilepath: currentCategory.filepath,
            };
        }
    }

    async function handleDndFinalize(e: CustomEvent, listType: 'incomplete' | 'completed') {
        if (e.detail.info.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) {
            // Did the sidebar consume the drag data?
            if (!(window as any).__mstodo_drag_data) {
                // The sidebar successfully processed the drop!
                const draggedId = e.detail.info.id;

                // Belt-and-suspenders ghost kill (primary kill already done in capture phase).
                const domNode = document.getElementById('task-' + draggedId);
                if (domNode) domNode.style.display = 'none';

                killDndGhostElement();

                if (listType === 'incomplete') {
                    incompleteTasks = (e.detail.items as TaskItem[]).filter(t => t.id !== draggedId);
                } else {
                    completedTasks = (e.detail.items as TaskItem[]).filter(t => t.id !== draggedId);
                }
            } else {
                // Dropped in empty space. Restore DND items and clean up drag data.
                if (listType === 'incomplete') incompleteTasks = e.detail.items;
                else completedTasks = e.detail.items;
                (window as any).__mstodo_drag_data = null;
            }
            return;
        }

        // Normal drop (internal or cross-list)
        const updatedItems = e.detail.items as TaskItem[];
        
        // Force the 'completed' flag to match the destination list
        const isCompletedList = listType === 'completed';
        updatedItems.forEach(t => { t.completed = isCompletedList; });

        if (listType === 'incomplete') incompleteTasks = updatedItems;
        else completedTasks = updatedItems;

        // Clean up global drag state gracefully for valid internal drops
        (window as any).__mstodo_drag_data = null;

        if (!currentCategory) return;
        // Persist the new order
        const allTasks = [...incompleteTasks, ...completedTasks];
        await dataService.saveTasks(currentCategory.filepath, allTasks);
    }

    function handleTaskPointerDown(task: TaskItem) {
        if (currentCategory) {
            (window as any).__mstodo_drag_data = {
                task,
                sourceFilepath: currentCategory.filepath,
            };
        }
    }

    // =============================================
    // Context Menu (Right-click → Move to...)
    // =============================================
    async function handleContextMenu(e: MouseEvent, task: TaskItem) {
        e.preventDefault();
        if (!currentCategory) return;

        const menu = new Menu();
        const categories = await dataService.getCategories();

        // Build "Move to..." submenu
        for (const cat of categories) {
            if (cat.filepath === currentCategory.filepath) continue;
            menu.addItem((item: any) => {
                item.setTitle(`Move to "${cat.name}"`)
                    .setIcon("folder")
                    .onClick(async () => {
                        // Anti-flicker: kill all transitions for the duration of the move
                        injectDndGhostShield();

                        // Optimistic UI: remove from local list
                        incompleteTasks = incompleteTasks.filter(t => t.id !== task.id);
                        completedTasks = completedTasks.filter(t => t.id !== task.id);

                        await dataService.moveTask(task, currentCategory!.filepath, cat.filepath);
                        EventBus.emit(EventName.TASK_MOVED, {
                            task,
                            sourcePath: currentCategory!.filepath,
                            targetPath: cat.filepath,
                        });

                        setTimeout(() => removeDndGhostShield(), ANTI_FLICKER_DURATION_MS);
                    });
            });
        }

        menu.addSeparator();
        menu.addItem((item: any) => {
            item.setTitle("Delete task")
                .setIcon("trash")
                .onClick(async () => {
                    incompleteTasks = incompleteTasks.filter(t => t.id !== task.id);
                    completedTasks = completedTasks.filter(t => t.id !== task.id);
                    await dataService.deleteTask(currentCategory!.filepath, task);
                    EventBus.emit(EventName.TASK_DELETED, {
                        task,
                        categoryFilepath: currentCategory!.filepath,
                    });
                });
        });

        menu.showAtMouseEvent(e);
    }
</script>

<div class="main-container">
    {#if currentCategory}
        <!-- Header -->
        <div class="main-header">
            <h1 class="category-title">{currentCategory.name}</h1>
        </div>

        <!-- Add Task Input -->
        <div class="add-task-container">
            <span class="plus-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </span>
            <input
                class="add-task-input"
                type="text"
                placeholder="Add a task"
                bind:value={newTaskTitle}
                on:keydown={handleAddTaskKeydown}
            />
        </div>

        <!-- Incomplete Tasks (drag-sortable) -->
        <div class="task-list"
             use:dndzone={{ items: incompleteTasks, flipDurationMs: DND_FLIP_DURATION, dropAnimationDisabled: true, dropTargetStyle: {} }}
             on:consider={(e) => handleDndConsider(e, 'incomplete')}
             on:finalize={(e) => handleDndFinalize(e, 'incomplete')}
        >
            {#each incompleteTasks as task (task.id)}
                <div
                    id={'task-' + task.id}
                    animate:flip={{duration: DND_FLIP_DURATION}}
                    class="task-item"
                    class:selected={selectedTaskId === task.id}
                    on:pointerdown={() => handleTaskPointerDown(task)}
                    on:click={() => selectTask(task)}
                    on:contextmenu={(e) => handleContextMenu(e, task)}
                    on:keydown={(e) => e.key === "Enter" && selectTask(task)}
                    tabindex="0"
                    role="button"
                >
                    <!-- Checkbox circle -->
                    <span class="checkbox" on:click|stopPropagation={() => toggleComplete(task)}
                          role="checkbox" aria-checked="false" tabindex="0"
                          on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleComplete(task)}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                        </svg>
                    </span>

                    <div class="task-content">
                        <span class="task-title">{task.title}</span>
                        {#if task.steps.length > 0}
                            <span class="task-meta">
                                {task.steps.filter(s => s.done).length}/{task.steps.length} steps
                            </span>
                        {/if}
                    </div>

                    <!-- Star -->
                    <span class="star" class:active={task.starred}
                          on:click|stopPropagation={() => toggleStar(task)}
                          role="button" tabindex="0"
                          on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleStar(task)}>
                        <svg width="18" height="18" viewBox="0 0 24 24"
                             fill={task.starred ? "currentColor" : "none"}
                             stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                    </span>
                </div>
            {/each}
        </div>

        <!-- Completed Section -->
        {#if completedTasks.length > 0}
            <div class="completed-section">
                <div class="completed-header" on:click={toggleCompletedSection}
                     role="button" tabindex="0"
                     on:keydown={(e) => e.key === "Enter" && toggleCompletedSection()}>
                    <span class="chevron" class:open={showCompleted}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </span>
                    <span>Completed</span>
                    <span class="completed-count">{completedTasks.length}</span>
                </div>

                {#if showCompleted}
                    <div class="completed-list"
                         use:dndzone={{ items: completedTasks, flipDurationMs: DND_FLIP_DURATION, dropAnimationDisabled: true, dropTargetStyle: {} }}
                         on:consider={(e) => handleDndConsider(e, 'completed')}
                         on:finalize={(e) => handleDndFinalize(e, 'completed')}
                    >
                        {#each completedTasks as task (task.id)}
                            <div
                                id={'task-' + task.id}
                                animate:flip={{duration: DND_FLIP_DURATION}}
                                class="task-item completed"
                                class:selected={selectedTaskId === task.id}
                                on:pointerdown={() => handleTaskPointerDown(task)}
                                on:click={() => selectTask(task)}
                                on:contextmenu={(e) => handleContextMenu(e, task)}
                                on:keydown={(e) => e.key === "Enter" && selectTask(task)}
                                tabindex="0"
                                role="button"
                            >
                                <span class="checkbox" on:click|stopPropagation={() => toggleComplete(task)}
                                      role="checkbox" aria-checked="true" tabindex="0"
                                      on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleComplete(task)}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                                         stroke="var(--todo-accent)" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <polyline points="8 12 11 15 16 9"/>
                                    </svg>
                                </span>

                                <div class="task-content">
                                    <span class="task-title">{task.title}</span>
                                </div>

                                <span class="star" class:active={task.starred}
                                      on:click|stopPropagation={() => toggleStar(task)}
                                      role="button" tabindex="0"
                                      on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleStar(task)}>
                                    <svg width="18" height="18" viewBox="0 0 24 24"
                                         fill={task.starred ? "currentColor" : "none"}
                                         stroke="currentColor" stroke-width="2">
                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                    </svg>
                                </span>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    {:else}
        <div class="detail-empty">
            Select a list from the sidebar to view tasks.
        </div>
    {/if}
</div>
