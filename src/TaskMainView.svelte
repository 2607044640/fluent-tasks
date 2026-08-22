<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { dndzone, TRIGGERS } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, VIEW_TYPE_SIDEBAR, type CategoryInfo, type TaskItem } from "./types";
    import { killDndGhostElement, removeDndGhostShield, injectDndGhostShield } from "./utils/dndUtils";
    import { portal } from "./utils/domUtils";
    import { getRelativeTime, getRecurrenceLabel } from "./utils/timeUtils";
    import { DISK_SYNC_DELAY_MS, ANTI_FLICKER_DURATION_MS, POPOVER_HIDE_DELAY_MS } from "./constants";
    import { Menu, setIcon, type App } from "obsidian";
    import { TaskSearchModal } from "./TaskSearchModal";
    import { RecurrenceService } from "./services/RecurrenceService";

    // =============================================
    // Props
    // =============================================
    export let dataService: DataService;
    export let plugin: any;

    /**
     * Expand sidebar and reveal Fluent Tasks list tab (manual button).
     */
    function expandSidebar() {
        const leftSplit = plugin.app.workspace.leftSplit as any;
        if (leftSplit.collapsed) {
            leftSplit.expand();
        }
        const sidebarLeaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);
        if (sidebarLeaves.length > 0) {
            plugin.app.workspace.revealLeaf(sidebarLeaves[0]);
        }
    }

    // =============================================
    // State
    // =============================================
    let currentCategory: CategoryInfo | null = null;
    let incompleteTasks: TaskItem[] = [];
    let completedTasks: TaskItem[] = [];
    let newTaskTitle: string = "";
    let showCompleted: boolean = false;
    let selectedTaskId: string = "";
    let addTaskInputEl: HTMLInputElement;

    // DND requires items to have an `id` field — our TaskItem already has it
    const DND_FLIP_DURATION = 200;

    // Custom auto-scroll state (replaces laggy built-in svelte-dnd-action scroller)
    let scrollAnimId: number | null = null;
    let scrollSpeed = 0;
    let scrollContainerEl: HTMLElement | null = null;
    let isDndActive = false;
    const AUTO_SCROLL_EDGE_ZONE = 60;
    const AUTO_SCROLL_MAX_SPEED = 12;
    const AUTO_SCROLL_MIN_SPEED = 2;

    // =============================================
    // Meta Badge Hover Popover
    // =============================================
    let popoverTask: TaskItem | null = null;
    let popoverType: 'why' | 'svg' | 'custom' | 'title' | 'guide' | null = null;
    let popoverSvgIndex: number = 0;
    let popoverX: number = 0;
    let popoverY: number = 0;
    let popoverVisible: boolean = false;
    let popoverTimeout: any = null;
    let showHintsModal: boolean = false;

    // Lightbox modal state for full-screen / zoom SVG view
    let lightboxData: { isInline: boolean; content: string; srcUrl: string; title: string; cleanPath: string } | null = null;
    const svgResolveCache = new Map<string, { isInline: boolean; content: string; srcUrl: string; cleanPath: string }>();

    function resolveSvgItem(svgStr: string): { isInline: boolean; content: string; srcUrl: string; cleanPath: string } {
        if (!svgStr) return { isInline: false, content: "", srcUrl: "", cleanPath: "" };
        const cached = svgResolveCache.get(svgStr);
        if (cached) return cached;

        const trimmed = svgStr.trim();
        if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml") || trimmed.includes("</svg>")) {
            const res = { isInline: true, content: trimmed, srcUrl: "", cleanPath: "" };
            svgResolveCache.set(svgStr, res);
            return res;
        }
        // It's a vault file path or wikilink (e.g. OneNote/.../assets/eye_of_knowledge_sea_circular.svg)
        const cleanPath = trimmed.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        let file: any = null;
        if (plugin?.app?.metadataCache) {
            file = plugin.app.metadataCache.getFirstLinkpathDest(cleanPath, currentCategory?.filepath || "");
        }
        if (!file && plugin?.app?.vault) {
            file = plugin.app.vault.getAbstractFileByPath(cleanPath);
        }
        const srcUrl = file && plugin?.app?.vault?.adapter ? plugin.app.vault.adapter.getResourcePath(file.path) : cleanPath;
        const res = {
            isInline: false,
            content: trimmed,
            srcUrl: srcUrl || cleanPath,
            cleanPath: file?.path || cleanPath,
        };
        svgResolveCache.set(svgStr, res);
        return res;
    }

    function openSvgLightbox(e: MouseEvent | KeyboardEvent, svgStr: string, title: string = "Visual Memory Aid") {
        e.stopPropagation();
        if (popoverTimeout) clearTimeout(popoverTimeout);
        popoverVisible = false;
        const res = resolveSvgItem(svgStr);
        lightboxData = {
            isInline: res.isInline,
            content: res.content,
            srcUrl: res.srcUrl,
            title,
            cleanPath: res.cleanPath,
        };
    }

    function closeSvgLightbox() {
        lightboxData = null;
    }

    function handleLightboxClick(e: MouseEvent) {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('.svg-lightbox-action-btn')) {
            closeSvgLightbox();
        }
    }

    function openSvgInVault(cleanPath: string) {
        if (!cleanPath || !plugin?.app) return;
        plugin.app.workspace.openLinkText(cleanPath, currentCategory?.filepath || "", false);
        closeSvgLightbox();
    }

    let popoverPlacement: 'top' | 'bottom' = 'top';

    function dismissPopover(e?: MouseEvent) {
        if (e) e.preventDefault();
        if (popoverTimeout) clearTimeout(popoverTimeout);
        popoverVisible = false;
        popoverTask = null;
        popoverType = null;
    }

    function showPopover(e: MouseEvent, task: TaskItem | null, type: 'why' | 'svg' | 'custom' | 'title' | 'guide', svgIndex: number = 0) {
        if (popoverTimeout) clearTimeout(popoverTimeout);
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();

        // Dynamic height & width calculation based on popover content
        const estimatedHeight = type === 'svg' ? 320 : type === 'guide' ? 280 : type === 'title' ? 240 : type === 'custom' ? 180 : 140;
        const estimatedHalfWidth = type === 'svg' ? 150 : type === 'guide' ? 170 : type === 'title' ? 170 : 140;

        // Smart Auto-Flip: if element is near the top of screen (< 24px margin), flip to bottom
        const fitsAbove = rect.top >= estimatedHeight + 24;
        popoverPlacement = fitsAbove ? 'top' : 'bottom';

        // Clamp X within viewport so it never overflows left or right window borders
        const centerX = rect.left + rect.width / 2;
        popoverX = Math.max(estimatedHalfWidth + 16, Math.min(window.innerWidth - estimatedHalfWidth - 16, centerX));
        popoverY = fitsAbove ? (rect.top - 8) : (rect.bottom + 8);

        popoverTask = task;
        popoverType = type;
        popoverSvgIndex = svgIndex;
        popoverVisible = true;
    }

    function handleTitleHover(e: MouseEvent, task: TaskItem) {
        if (e.ctrlKey || e.metaKey) {
            showPopover(e, task, 'title');
        }
    }

    function handleTitleMouseMove(e: MouseEvent, task: TaskItem) {
        if ((e.ctrlKey || e.metaKey) && (!popoverVisible || popoverTask?.id !== task.id || popoverType !== 'title')) {
            showPopover(e, task, 'title');
        } else if (!e.ctrlKey && !e.metaKey && popoverType === 'title' && popoverVisible) {
            dismissPopover();
        }
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

    function handleNoteLinkHover(e: MouseEvent, noteLink?: string) {
        if (!noteLink || !plugin?.app) return;
        // Strip wikilink brackets and aliases (e.g. [[Note#^block|alias]] -> Note#^block)
        const cleanLink = noteLink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        if (!cleanLink) return;

        // Create a proxied MouseEvent where ctrlKey / metaKey always returns true
        // This guarantees Obsidian's Page Preview triggers directly on hover in all view modes (Reading & Live Preview)
        const proxiedEvent = new Proxy(e, {
            get(target, prop) {
                if (prop === "ctrlKey" || prop === "metaKey") return true;
                const val = (target as any)[prop];
                return typeof val === "function" ? val.bind(target) : val;
            }
        });

        plugin.app.workspace.trigger("hover-link", {
            event: proxiedEvent,
            source: "fluent-tasks",
            hoverParent: e.currentTarget as HTMLElement,
            targetEl: e.currentTarget as HTMLElement,
            linktext: cleanLink,
            sourcePath: currentCategory?.filepath || "",
        });
    }

    function handleNoteLinkClick(e: MouseEvent | KeyboardEvent, noteLink?: string) {
        e.stopPropagation();
        if (!noteLink || !plugin?.app) return;
        const cleanLink = noteLink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        if (!cleanLink) return;

        plugin.app.workspace.openLinkText(
            cleanLink,
            currentCategory?.filepath || "",
            false
        );
    }

    // =============================================
    // Lifecycle
    // =============================================
    onMount(() => {
        EventBus.on(EventName.CATEGORY_SELECTED, handleCategorySelected);
        EventBus.on(EventName.TASK_UPDATED, handleTaskUpdated);
        EventBus.on(EventName.TASK_MOVED, handleTaskMoved);
        EventBus.on(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.on(EventName.TASK_NAVIGATE, handleTaskNavigate);
        window.addEventListener('pointermove', handleDragPointerMove);
    });

    onDestroy(() => {
        stopAutoScroll();
        if (popoverTimeout) clearTimeout(popoverTimeout);
        window.removeEventListener('pointermove', handleDragPointerMove);
        EventBus.off(EventName.CATEGORY_SELECTED, handleCategorySelected);
        EventBus.off(EventName.TASK_UPDATED, handleTaskUpdated);
        EventBus.off(EventName.TASK_MOVED, handleTaskMoved);
        EventBus.off(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.off(EventName.TASK_NAVIGATE, handleTaskNavigate);
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
        showCompleted = false;
        await loadTasks();
    }

    export function getCurrentCategory() {
        return currentCategory;
    }

    // =============================================
    // EventBus Handlers
    // =============================================
    async function handleCategorySelected(payload: any) {
        await loadCategory(payload.category);
        // Auto-focus the "Add a task" input when triggered by a jump command
        if (payload.focusInput) {
            await tick();
            addTaskInputEl?.focus();
        }
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
        incompleteTasks = [newTask, ...incompleteTasks];
    }

    function handleAddTaskKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            addTask();
        }
    }

    async function toggleComplete(task: TaskItem) {
        if (!currentCategory) return;

        // Optimistic UI: move the task visually first
        const isBecomingCompleted = !task.completed;

        // Recurring task: advance to next occurrence instead of completing
        if (isBecomingCompleted && task.recurrence) {
            const advanced = RecurrenceService.handleRecurringCompletion(task);
            Object.assign(task, advanced);
            // Task stays in incompleteTasks — just trigger reactivity
            incompleteTasks = [...incompleteTasks];

            await dataService.updateTask(currentCategory.filepath, task);
            EventBus.emit(EventName.TASK_UPDATED, {
                task,
                categoryFilepath: currentCategory.filepath,
            });
            return;
        }

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

    /** Navigate to a specific task: expand completed section if needed, scroll into view, highlight */
    async function handleTaskNavigate(payload: any) {
        const { taskId, isCompleted } = payload;
        // If the task is completed and the section is collapsed, expand it
        if (isCompleted && !showCompleted) {
            showCompleted = true;
        }
        selectedTaskId = taskId;
        // Wait for Svelte to render the DOM after state changes
        await tick();
        const el = document.getElementById('task-' + taskId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Brief highlight flash
            el.classList.add('navigate-highlight');
            setTimeout(() => el.classList.remove('navigate-highlight'), 1500);
        }
    }

    // =============================================
    // Custom Auto-Scroll Engine for DnD
    // =============================================
    function startAutoScroll() {
        if (scrollAnimId !== null) return;
        const step = () => {
            if (!scrollContainerEl || scrollSpeed === 0) {
                scrollAnimId = null;
                return;
            }
            scrollContainerEl.scrollTop += scrollSpeed;
            scrollAnimId = requestAnimationFrame(step);
        };
        scrollAnimId = requestAnimationFrame(step);
    }

    function stopAutoScroll() {
        if (scrollAnimId !== null) {
            cancelAnimationFrame(scrollAnimId);
            scrollAnimId = null;
        }
        scrollSpeed = 0;
    }

    function updateAutoScroll(clientY: number) {
        if (!scrollContainerEl) {
            scrollContainerEl = document.querySelector('.task-list') as HTMLElement;
        }
        if (!scrollContainerEl) return;

        const rect = scrollContainerEl.getBoundingClientRect();

        if (clientY < rect.top + AUTO_SCROLL_EDGE_ZONE && scrollContainerEl.scrollTop > 0) {
            // Linear speed: closer to edge = faster, clamped to max
            const proximity = 1 - ((clientY - rect.top) / AUTO_SCROLL_EDGE_ZONE);
            scrollSpeed = -Math.max(AUTO_SCROLL_MIN_SPEED, Math.round(proximity * AUTO_SCROLL_MAX_SPEED));
            startAutoScroll();
        } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_ZONE) {
            const proximity = 1 - ((rect.bottom - clientY) / AUTO_SCROLL_EDGE_ZONE);
            scrollSpeed = Math.max(AUTO_SCROLL_MIN_SPEED, Math.round(proximity * AUTO_SCROLL_MAX_SPEED));
            startAutoScroll();
        } else {
            stopAutoScroll();
        }
    }

    function handleDragPointerMove(e: PointerEvent) {
        if (!isDndActive) return;
        updateAutoScroll(e.clientY);
    }

    // =============================================
    // Drag & Drop (In-list reordering & Cross-Pane)
    // =============================================
    function handleDndConsider(e: CustomEvent, listType: 'incomplete' | 'completed') {
        isDndActive = true;
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
        isDndActive = false;
        stopAutoScroll();

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

<svelte:window on:contextmenu={() => { if (popoverVisible) dismissPopover(); }} />

<div class="main-container" role="application">
    {#if currentCategory}
        <!-- Header -->
        <div class="main-header">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="icon-btn" on:click|stopPropagation={expandSidebar}
                      role="button" tabindex="0" aria-label="Show sidebar list" title="Show sidebar list"
                      on:keydown|stopPropagation={(e) => e.key === "Enter" && expandSidebar()}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="9" y1="3" x2="9" y2="21"/>
                    </svg>
                </span>
                <h1 class="category-title">{currentCategory.name}</h1>
                <span class="icon-btn hint-btn"
                      on:mouseenter={(e) => showPopover(e, null, 'guide')}
                      on:mouseleave={scheduleHidePopover}
                      on:click|stopPropagation={() => showHintsModal = true}
                      on:keydown|stopPropagation={(e) => e.key === "Enter" && (showHintsModal = true)}
                      role="button" tabindex="0" aria-label="Features & Shortcuts Guide" title="Features & Shortcuts Guide">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                </span>
                <span class="icon-btn" on:click|stopPropagation={() => new TaskSearchModal(plugin.app, plugin, dataService, currentCategory?.filepath).open()}
                      role="button" tabindex="0" aria-label="Search this list" title="Search this list"
                      on:keydown|stopPropagation={(e) => e.key === "Enter" && new TaskSearchModal(plugin.app, plugin, dataService, currentCategory?.filepath).open()}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                </span>
            </div>
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
                bind:this={addTaskInputEl}
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
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span class="task-title"
                              on:mouseenter={(e) => handleTitleHover(e, task)}
                              on:mousemove={(e) => handleTitleMouseMove(e, task)}
                              on:mouseleave={scheduleHidePopover}>
                            {task.title}
                        </span>
                        <div class="task-meta-row">
                            {#if task.steps.length > 0}
                                <span class="task-meta">
                                    {task.steps.filter(s => s.done).length}/{task.steps.length} steps
                                </span>
                            {/if}
                            {#if task.dueDate}
                                <span class="task-meta due-date">
                                    {task.dueDate}
                                </span>
                            {/if}
                            {#if task.recurrence}
                                <span class="task-meta recurrence" title="Recurring task">
                                    <svg class="recurrence-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
                                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="17 1 21 5 17 9"/>
                                        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                                        <polyline points="7 23 3 19 7 15"/>
                                        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                                    </svg>
                                </span>
                            {/if}
                        </div>
                    </div>

                    <!-- Meta Badges -->
                    {#if task.why}
                        <span class="meta-badge why-badge"
                              on:mouseenter={(e) => showPopover(e, task, 'why')}
                              on:mouseleave={scheduleHidePopover}
                              role="button" tabindex="0"
                              title="Why: view rationale">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                <line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                        </span>
                    {/if}
                    {#if task.svgs && task.svgs.length > 0}
                        {#each task.svgs as svgContent, i}
                            {#if svgContent}
                                {@const resolved = resolveSvgItem(svgContent)}
                                <span class="meta-badge svg-badge"
                                      on:mouseenter={(e) => showPopover(e, task, 'svg', i)}
                                      on:mouseleave={scheduleHidePopover}
                                      on:click={(e) => openSvgLightbox(e, svgContent, task.title)}
                                      on:keydown={(e) => e.key === "Enter" && openSvgLightbox(e, svgContent, task.title)}
                                      role="button" tabindex="0"
                                      title="Visual memory SVG: click to enlarge, hover to preview">
                                    {#if resolved.isInline}
                                        {@html resolved.content}
                                    {:else}
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                            <circle cx="8.5" cy="8.5" r="1.5"/>
                                            <polyline points="21 15 16 10 5 21"/>
                                        </svg>
                                    {/if}
                                </span>
                            {/if}
                        {/each}
                    {/if}
                    {#if task.note_link}
                        <span class="meta-badge note-badge"
                              on:mouseenter={(e) => handleNoteLinkHover(e, task.note_link)}
                              on:click={(e) => handleNoteLinkClick(e, task.note_link)}
                              on:keydown={(e) => e.key === "Enter" && handleNoteLinkClick(e, task.note_link)}
                              role="button" tabindex="0"
                              title={`Linked note: ${task.note_link} (Click to open, hover to preview)`}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                                <polyline points="10 9 9 9 8 9"/>
                            </svg>
                        </span>
                    {/if}
                    {#if task.customMeta && Object.keys(task.customMeta).length > 0}
                        <span class="meta-badge custom-badge"
                              on:mouseenter={(e) => showPopover(e, task, 'custom')}
                              on:mouseleave={scheduleHidePopover}
                              role="button" tabindex="0"
                              title="Custom properties">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                                <line x1="7" y1="7" x2="7.01" y2="7"/>
                            </svg>
                        </span>
                    {/if}

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
                                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                                    <span class="task-title"
                                          on:mouseenter={(e) => handleTitleHover(e, task)}
                                          on:mousemove={(e) => handleTitleMouseMove(e, task)}
                                          on:mouseleave={scheduleHidePopover}>
                                        {task.title}
                                    </span>
                                    {#if task.dueDate || task.recurrence}
                                        <div class="task-meta-row">
                                            {#if task.dueDate}
                                                <span class="task-meta due-date">{task.dueDate}</span>
                                            {/if}
                                            {#if task.recurrence}
                                                <span class="task-meta recurrence">
                                                    <svg class="recurrence-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
                                                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <polyline points="17 1 21 5 17 9"/>
                                                        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                                                        <polyline points="7 23 3 19 7 15"/>
                                                        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                                                    </svg>
                                                </span>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>

                                <!-- Meta Badges -->
                                {#if task.why}
                                    <span class="meta-badge why-badge"
                                          on:mouseenter={(e) => showPopover(e, task, 'why')}
                                          on:mouseleave={scheduleHidePopover}
                                          role="button" tabindex="0"
                                          title="Why: view rationale">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <circle cx="12" cy="12" r="10"/>
                                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                                        </svg>
                                    </span>
                                {/if}
                                {#if task.svgs && task.svgs.length > 0}
                                    {#each task.svgs as svgContent, i}
                                        {#if svgContent}
                                            {@const resolved = resolveSvgItem(svgContent)}
                                            <span class="meta-badge svg-badge"
                                                  on:mouseenter={(e) => showPopover(e, task, 'svg', i)}
                                                  on:mouseleave={scheduleHidePopover}
                                                  on:click={(e) => openSvgLightbox(e, svgContent, task.title)}
                                                  on:keydown={(e) => e.key === "Enter" && openSvgLightbox(e, svgContent, task.title)}
                                                  role="button" tabindex="0"
                                                  title="Visual memory SVG: click to enlarge, hover to preview">
                                                {#if resolved.isInline}
                                                    {@html resolved.content}
                                                {:else}
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                                        <polyline points="21 15 16 10 5 21"/>
                                                    </svg>
                                                {/if}
                                            </span>
                                        {/if}
                                    {/each}
                                {/if}
                                {#if task.note_link}
                                    <span class="meta-badge note-badge"
                                          on:mouseenter={(e) => handleNoteLinkHover(e, task.note_link)}
                                          on:click={(e) => handleNoteLinkClick(e, task.note_link)}
                                          on:keydown={(e) => e.key === "Enter" && handleNoteLinkClick(e, task.note_link)}
                                          role="button" tabindex="0"
                                          title={`Linked note: ${task.note_link} (Click to open, hover to preview)`}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                            <polyline points="14 2 14 8 20 8"/>
                                            <line x1="16" y1="13" x2="8" y2="13"/>
                                            <line x1="16" y1="17" x2="8" y2="17"/>
                                            <polyline points="10 9 9 9 8 9"/>
                                        </svg>
                                    </span>
                                {/if}
                                {#if task.customMeta && Object.keys(task.customMeta).length > 0}
                                    <span class="meta-badge custom-badge"
                                          on:mouseenter={(e) => showPopover(e, task, 'custom')}
                                          on:mouseleave={scheduleHidePopover}
                                          role="button" tabindex="0"
                                          title="Custom properties">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                                            <line x1="7" y1="7" x2="7.01" y2="7"/>
                                        </svg>
                                    </span>
                                {/if}

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

    <!-- Global Meta Badge Popover (Portaled to document.body to prevent sidebar clipping) -->
    {#if popoverVisible && (popoverTask || popoverType === 'guide')}
        <div use:portal
             class="meta-popover placement-{popoverPlacement}"
             style="left: {popoverX}px; top: {popoverY}px;"
             on:mouseenter={cancelHidePopover}
             on:mouseleave={scheduleHidePopover}
             on:contextmenu|preventDefault={dismissPopover}
             role="tooltip">
            {#if popoverType === 'why' && popoverTask && popoverTask.why}
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
            {:else if popoverType === 'svg' && popoverTask && popoverTask.svgs && popoverTask.svgs[popoverSvgIndex]}
                {@const resolved = resolveSvgItem(popoverTask.svgs[popoverSvgIndex])}
                <div class="meta-popover-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        <span>Visual Memory Aid</span>
                    </div>
                    <span class="meta-popover-hint">Click to enlarge</span>
                </div>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div class="meta-popover-svg-preview"
                     on:click={(e) => popoverTask && popoverTask.svgs && openSvgLightbox(e, popoverTask.svgs[popoverSvgIndex], popoverTask.title)}
                     role="button" tabindex="0"
                     title="Click to view full size">
                    {#if resolved.isInline}
                        {@html resolved.content}
                    {:else}
                        <img src={resolved.srcUrl} alt="Visual memory" class="meta-popover-img" />
                    {/if}
                </div>
            {:else if popoverType === 'custom' && popoverTask && popoverTask.customMeta}
                <div class="meta-popover-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                            <line x1="7" y1="7" x2="7.01" y2="7"/>
                        </svg>
                        <span>Custom Properties</span>
                    </div>
                </div>
                <div class="meta-popover-custom-grid">
                    {#each Object.entries(popoverTask.customMeta) as [k, v]}
                        <div class="meta-popover-custom-row">
                            <span class="custom-row-key">{k}:</span>
                            <span class="custom-row-val">{v}</span>
                        </div>
                    {/each}
                </div>
            {:else if popoverType === 'title' && popoverTask}
                <div class="meta-popover-title-card">
                    <div class="meta-popover-header">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <span>Task Quick Peek</span>
                        </div>
                        {#if popoverTask.createdAt}
                            <span class="meta-popover-hint">{getRelativeTime(popoverTask.createdAt)}</span>
                        {/if}
                    </div>

                    <!-- Full Unclipped Title -->
                    <div class="meta-popover-full-title">{popoverTask.title}</div>

                    <!-- Mini Details Section -->
                    {#if popoverTask.steps && popoverTask.steps.length > 0}
                        <div class="meta-popover-detail-section">
                            <div class="popover-detail-label">
                                Steps ({popoverTask.steps.filter(s => s.done).length}/{popoverTask.steps.length})
                            </div>
                            <div class="popover-steps-list">
                                {#each popoverTask.steps as step}
                                    <div class="popover-step-item" class:done={step.done}>
                                        <span class="step-bullet">{step.done ? "✓" : "○"}</span>
                                        <span class="step-text">{step.text}</span>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    {#if popoverTask.note}
                        <div class="meta-popover-detail-section">
                            <div class="popover-detail-label">Note</div>
                            <div class="popover-note-box">{popoverTask.note}</div>
                        </div>
                    {/if}

                    {#if popoverTask.why}
                        <div class="meta-popover-detail-section">
                            <div class="popover-detail-label">Why / Rationale</div>
                            <div class="popover-why-box">{popoverTask.why}</div>
                        </div>
                    {/if}

                    {#if popoverTask.dueDate || popoverTask.recurrence}
                        <div class="meta-popover-footer-tags">
                            {#if popoverTask.dueDate}
                                <span class="popover-tag due-tag">📅 {popoverTask.dueDate}</span>
                            {/if}
                            {#if popoverTask.recurrence}
                                <span class="popover-tag repeat-tag">🔁 {getRecurrenceLabel(popoverTask.recurrence)}</span>
                            {/if}
                        </div>
                    {/if}
                </div>
            {:else if popoverType === 'guide'}
                <div class="meta-popover-guide-card">
                    <div class="meta-popover-header">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                <line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                            <span style="font-weight: 600;">Fluent Tasks Guide</span>
                        </div>
                        <span class="meta-popover-hint">Click for full guide</span>
                    </div>
                    <div class="meta-guide-items">
                        <div class="meta-guide-item">
                            <span class="guide-key">Ctrl + Hover Title</span>
                            <span class="guide-desc">Quick peek full title, subtasks & notes</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Direct Hover Badges</span>
                            <span class="guide-desc">Preview Why (?), SVG (🖼️), Note (📄), Custom (🏷️)</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Click Note Badge</span>
                            <span class="guide-desc">Jump directly to linked note (supports block links)</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">+ Meta Button</span>
                            <span class="guide-desc">Manage all metadata at bottom of detail panel</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Right Click</span>
                            <span class="guide-desc">Dismiss popover / close Lightbox instantly</span>
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Global SVG Visual Memory Lightbox Modal (Portaled to document.body) -->
    {#if lightboxData}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div use:portal
             class="svg-lightbox-backdrop"
             on:click={handleLightboxClick}
             on:contextmenu|preventDefault={closeSvgLightbox}
             role="presentation">
            <div class="svg-lightbox-modal" role="dialog" aria-modal="true" tabindex="-1">
                <div class="svg-lightbox-header">
                    <div class="svg-lightbox-title-row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        <span class="svg-lightbox-title">{lightboxData.title || "Visual Memory Aid"}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        {#if lightboxData.cleanPath}
                            <button type="button" class="svg-lightbox-action-btn" on:click|stopPropagation={() => lightboxData && openSvgInVault(lightboxData.cleanPath)} title="Open note/file in Obsidian">
                                Open in Tab
                            </button>
                        {/if}
                        <span class="svg-lightbox-close" on:click={closeSvgLightbox}
                              on:keydown={(e) => e.key === "Enter" && closeSvgLightbox()}
                              role="button" tabindex="0">✕</span>
                    </div>
                </div>
                <div class="svg-lightbox-body">
                    {#if lightboxData.isInline}
                        <div class="svg-lightbox-content">
                            {@html lightboxData.content}
                        </div>
                    {:else}
                        <img src={lightboxData.srcUrl} alt="Visual memory" class="svg-lightbox-img" />
                    {/if}
                </div>
            </div>
        </div>
    {/if}

    <!-- Features & Shortcuts Guide Modal (Portaled to document.body) -->
    {#if showHintsModal}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div use:portal
             class="meta-modal-backdrop" on:click={(e) => e.target === e.currentTarget && (showHintsModal = false)} role="presentation">
            <div class="meta-modal-dialog guide-modal-dialog" role="dialog" aria-modal="true" tabindex="-1">
                <div class="meta-modal-header">
                    <div class="meta-modal-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <span>Fluent Tasks Features & Shortcut Guide</span>
                    </div>
                    <span class="meta-modal-close" on:click={() => showHintsModal = false}
                          role="button" tabindex="0">✕</span>
                </div>
                <div class="meta-modal-body guide-modal-body">
                    <div class="guide-section">
                        <div class="guide-section-title">⚡ Interaction Shortcuts</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Ctrl + Hover</span> Task Title</div>
                                <div class="guide-card-body">Hover over any task title while pressing <kbd>Ctrl</kbd> to quick-peek full title, subtasks checklist, notes, and due dates without opening the detail view.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Direct Hover</span> Meta Badges</div>
                                <div class="guide-card-body">Hovering over <span class="why-badge">?</span>, <span class="note-badge">📄</span>, <span class="svg-badge">🖼️</span>, or <span class="custom-badge">🏷️</span> instantly previews rationale, notes, SVGs, or custom properties.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Right Click</span> Instant Dismiss</div>
                                <div class="guide-card-body">Right-click anywhere to immediately dismiss any open hover popover or full-screen SVG Lightbox.</div>
                            </div>
                        </div>
                    </div>

                    <div class="guide-section">
                        <div class="guide-section-title">📂 Organization & Metadata System</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header">📄 Linked Notes & Block References</div>
                                <div class="guide-card-body">Link Obsidian/OneNote notes (e.g. <code>[[Note#^blockid]]</code>). Hover for instant preview (no Ctrl needed), click badge to jump directly.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">🖼️ Visual Memory SVGs & Lightbox</div>
                                <div class="guide-card-body">Attach vault SVG diagrams. Hover for 280px preview, click to open full-screen zoom lightbox with one-click "Open in Tab".</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">➕ Custom Metadata Manager</div>
                                <div class="guide-card-body">Click the <code>+</code> button next to Time at the bottom of the right detail view to add/manage custom properties, Why, and linked notes.</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="meta-modal-footer">
                    <button type="button" class="meta-btn-primary" on:click={() => showHintsModal = false}>Got it!</button>
                </div>
            </div>
        </div>
    {/if}
</div>
