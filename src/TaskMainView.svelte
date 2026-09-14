<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { dndzone, TRIGGERS } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, type CategoryInfo, type TaskItem } from "./types";
    import { killDndGhostElement, removeDndGhostShield, injectDndGhostShield } from "./utils/dndUtils";
    import { portal } from "./utils/domUtils";
    import { calculatePopoverPosition, type PopoverContentType } from "./utils/popoverUtils";
    import { getRelativeTime, getRecurrenceLabel } from "./utils/timeUtils";
    import { DISK_SYNC_DELAY_MS, ANTI_FLICKER_DURATION_MS, POPOVER_HIDE_DELAY_MS } from "./constants";
    import { Menu, setIcon, Platform, Notice, type App } from "obsidian";
    import { TaskSearchModal } from "./TaskSearchModal";
    import { RecurrenceService } from "./services/RecurrenceService";
    import { LinkedNoteService } from "./services/LinkedNoteService";
    import { promptDeleteTaskWithLinkedNote } from "./modals/ConfirmDeleteLinkedNoteModal";
    import { TaskStepsModal } from "./modals/TaskStepsModal";
    import { BackupModal } from "./modals/BackupModal";

    // =============================================
    // Props
    // =============================================
    export let dataService: DataService;
    export let plugin: any;

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
    let wrapTaskTitles: boolean = plugin?.settings?.wrapTaskTitles ?? true;

    // Multi-Select Mode State
    let isMultiSelectMode: boolean = false;
    let selectedTaskIds: Set<string> = new Set();

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
    let popoverType: 'why' | 'svg' | 'custom' | 'title' | 'guide' | 'steps' | null = null;
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
            let processed = trimmed;
            // Auto-inject viewBox if missing so inline SVGs automatically scale to maximum viewport size
            if (!processed.includes("viewBox") && !processed.includes("viewbox")) {
                const widthMatch = processed.match(/width=["']?(\d+(?:\.\d+)?)px?["']?/i);
                const heightMatch = processed.match(/height=["']?(\d+(?:\.\d+)?)px?["']?/i);
                if (widthMatch && heightMatch) {
                    const w = widthMatch[1];
                    const h = heightMatch[1];
                    processed = processed.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
                }
            }
            const res = { isInline: true, content: processed, srcUrl: "", cleanPath: "" };
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

    function showPopover(e: MouseEvent | { currentTarget: HTMLElement }, task: TaskItem | null, type: PopoverContentType, svgIndex: number = 0) {
        if (popoverTimeout) clearTimeout(popoverTimeout);
        const target = e.currentTarget as HTMLElement;
        if (!target) return;

        const pos = calculatePopoverPosition(target, type);
        popoverPlacement = pos.placement;
        popoverX = pos.x;
        popoverY = pos.y;

        popoverTask = task;
        popoverType = type;
        popoverSvgIndex = svgIndex;
        popoverVisible = true;
    }

    function openStepsModal(task: TaskItem | null) {
        if (!task) return;
        dismissPopover();
        if (!currentCategory || !plugin?.app) return;
        new TaskStepsModal(plugin.app, plugin, dataService, task, currentCategory.filepath).open();
    }

    // Dedicated keyboard state tracking to ensure Quick Peek activates ONLY on standalone Ctrl
    let isCtrlPressed = false;
    let hasComboModifierOrKey = false;
    let hoveredTitleTarget: { element: HTMLElement; task: TaskItem } | null = null;

    function isControlKey(e: KeyboardEvent): boolean {
        return Platform.isMacOS ? (e.key === "Meta" || e.key === "Control") : (e.key === "Control");
    }

    function isQuickPeekModifierPressed(e: MouseEvent): boolean {
        // Reject if any combo key (like C in Ctrl+C, Shift, Alt, etc.) is active
        if (hasComboModifierOrKey || e.shiftKey || e.altKey) {
            return false;
        }
        if (Platform.isMacOS) {
            return (e.metaKey || e.ctrlKey);
        }
        // On Windows and Linux: e.metaKey is the Windows (Super) key!
        // Never allow Win key combinations (Win+4, Win+Tab, Win+D, etc.) to falsely trigger Ctrl-hover Quick Peek.
        return e.ctrlKey && !e.metaKey;
    }

    function handleGlobalKeyDown(e: KeyboardEvent) {
        if (isControlKey(e)) {
            isCtrlPressed = true;
            // If standalone Ctrl was pressed while cursor is currently hovering over a task title
            if (!hasComboModifierOrKey && !e.shiftKey && !e.altKey && !e.repeat && hoveredTitleTarget) {
                showPopover({ currentTarget: hoveredTitleTarget.element }, hoveredTitleTarget.task, 'title');
            }
        } else {
            // Any other key pressed (e.g. C, V, X, A, Shift, Alt, etc.)
            hasComboModifierOrKey = true;
            // Immediately dismiss Quick Peek popover to prevent shortcut interference
            if (popoverType === 'title') {
                dismissPopover();
            }
        }
    }

    function handleGlobalKeyUp(e: KeyboardEvent) {
        if (isControlKey(e)) {
            isCtrlPressed = false;
            hasComboModifierOrKey = false;
        } else {
            if (!e.ctrlKey && !e.metaKey) {
                hasComboModifierOrKey = false;
            }
        }
    }

    function handleWindowBlur() {
        isCtrlPressed = false;
        hasComboModifierOrKey = false;
        hoveredTitleTarget = null;
    }

    function handleTitleHover(e: MouseEvent, task: TaskItem) {
        hoveredTitleTarget = { element: e.currentTarget as HTMLElement, task };
        if (isQuickPeekModifierPressed(e)) {
            showPopover(e, task, 'title');
        }
    }

    function handleTitleMouseMove(e: MouseEvent, task: TaskItem) {
        hoveredTitleTarget = { element: e.currentTarget as HTMLElement, task };
        if (isQuickPeekModifierPressed(e)) {
            if (!popoverVisible || popoverTask?.id !== task.id || popoverType !== 'title') {
                showPopover(e, task, 'title');
            }
        }
        // Sticky Task Quick Peek: do NOT dismiss when Ctrl is released.
        // The popover remains floating until the user right-clicks anywhere or Ctrl-hovers another task.
    }

    function handleTitleMouseLeave() {
        hoveredTitleTarget = null;
        scheduleHidePopover();
    }

    function scheduleHidePopover() {
        // Sticky Task Quick Peek: do not auto-hide on mouseleave when popoverType is 'title'
        if (popoverType === 'title') return;

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

    async function handleNoteLinkClick(e: MouseEvent | KeyboardEvent, noteLink?: string) {
        e.stopPropagation();
        if (!noteLink || !plugin?.app) return;
        const file = LinkedNoteService.resolveLinkedNoteFile(plugin.app, noteLink, currentCategory?.filepath);
        if (file) {
            await LinkedNoteService.openLinkedNoteFile(plugin.app, file);
        } else {
            const cleanLink = noteLink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
            if (cleanLink) {
                plugin.app.workspace.openLinkText(
                    cleanLink,
                    currentCategory?.filepath || "",
                    "tab"
                );
            }
        }
    }

    function handleSettingsChanged() {
        wrapTaskTitles = plugin?.settings?.wrapTaskTitles ?? true;
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
        EventBus.on(EventName.SETTINGS_CHANGED, handleSettingsChanged);
        window.addEventListener('pointermove', handleDragPointerMove);
        window.addEventListener('keydown', handleGlobalKeyDown, true);
        window.addEventListener('keyup', handleGlobalKeyUp, true);
        window.addEventListener('blur', handleWindowBlur);
    });

    onDestroy(() => {
        stopAutoScroll();
        if (popoverTimeout) clearTimeout(popoverTimeout);
        window.removeEventListener('pointermove', handleDragPointerMove);
        window.removeEventListener('keydown', handleGlobalKeyDown, true);
        window.removeEventListener('keyup', handleGlobalKeyUp, true);
        window.removeEventListener('blur', handleWindowBlur);
        EventBus.off(EventName.CATEGORY_SELECTED, handleCategorySelected);
        EventBus.off(EventName.TASK_UPDATED, handleTaskUpdated);
        EventBus.off(EventName.TASK_MOVED, handleTaskMoved);
        EventBus.off(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.off(EventName.TASK_NAVIGATE, handleTaskNavigate);
        EventBus.off(EventName.SETTINGS_CHANGED, handleSettingsChanged);
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
        if (!payload.categoryFilepath || payload.categoryFilepath === currentCategory?.filepath) {
            await loadTasks();
            if (payload.isExternal && selectedTaskId && currentCategory) {
                const freshTask = incompleteTasks.find(t => t.id === selectedTaskId) || completedTasks.find(t => t.id === selectedTaskId);
                if (freshTask) {
                    EventBus.emit(EventName.TASK_SELECTED, {
                        task: freshTask,
                        categoryFilepath: currentCategory.filepath,
                    });
                }
            }
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

        task.completed = !task.completed;
        if (task.completed) {
            task.completedAt = new Date().toISOString();
            incompleteTasks = incompleteTasks.filter(t => t.id !== task.id);
            completedTasks = [task, ...completedTasks];
        } else {
            delete task.completedAt;
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
                taskId: task.id,
                task,
                sourceFilepath: currentCategory.filepath,
                movedToTarget: null,
            };
        }
    }

    async function handleDndFinalize(e: CustomEvent, listType: 'incomplete' | 'completed') {
        isDndActive = false;
        stopAutoScroll();

        const dragData = (window as any).__mstodo_drag_data;
        const draggedId = e.detail.info.id;

        // If the task was moved cross-pane to another category by sidebar radar
        if (dragData && dragData.movedToTarget && dragData.movedToTarget !== currentCategory?.filepath) {
            // Task was successfully moved cross-pane!
            // CRITICAL: Filter out from local state and DO NOT call saveTasks() on currentCategory
            // because moveTask has already removed it from disk.
            if (listType === 'incomplete') {
                incompleteTasks = incompleteTasks.filter(t => t.id !== draggedId && t.id !== dragData.task?.id);
            } else {
                completedTasks = completedTasks.filter(t => t.id !== draggedId && t.id !== dragData.task?.id);
            }

            const domNode = document.getElementById('task-' + draggedId);
            if (domNode) domNode.style.display = 'none';
            killDndGhostElement();
            (window as any).__mstodo_drag_data = null;
            return;
        }

        (window as any).__mstodo_drag_data = null;

        if (e.detail.info.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) {
            // Dropped in empty space (cancelled drag)
            if (listType === 'incomplete') incompleteTasks = e.detail.items;
            else completedTasks = e.detail.items;
            return;
        }

        // Normal drop (internal reordering within same list)
        const updatedItems = e.detail.items as TaskItem[];
        const isCompletedList = listType === 'completed';
        updatedItems.forEach(t => { t.completed = isCompletedList; });

        if (listType === 'incomplete') incompleteTasks = updatedItems;
        else completedTasks = updatedItems;

        if (!currentCategory) return;
        // Persist the new order
        const allTasks = [...incompleteTasks, ...completedTasks];
        await dataService.saveTasks(currentCategory.filepath, allTasks);
    }

    function handleTaskPointerDown(task: TaskItem) {
        if (currentCategory) {
            (window as any).__mstodo_drag_data = {
                taskId: task.id,
                task,
                sourceFilepath: currentCategory.filepath,
                movedToTarget: null,
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
                    await promptDeleteTaskWithLinkedNote(
                        plugin.app,
                        task,
                        currentCategory!.filepath,
                        dataService,
                        () => {
                            incompleteTasks = incompleteTasks.filter(t => t.id !== task.id);
                            completedTasks = completedTasks.filter(t => t.id !== task.id);
                        }
                    );
                });
        });

        menu.showAtMouseEvent(e);
    }

    export function openHintsModal() {
        showHintsModal = true;
    }

    export function showGuidePopover(e: MouseEvent) {
        showPopover(e, null, 'guide');
    }

    export function toggleMultiSelect() {
        isMultiSelectMode = !isMultiSelectMode;
        if (!isMultiSelectMode) {
            selectedTaskIds.clear();
            selectedTaskIds = selectedTaskIds;
        } else {
            new Notice("☑️ 多选模式已开启：可勾选任务进行批量操作");
        }
    }

    export function openBackupModal() {
        new BackupModal(plugin.app, plugin, dataService).open();
    }

    function toggleTaskSelection(id: string) {
        if (selectedTaskIds.has(id)) {
            selectedTaskIds.delete(id);
        } else {
            selectedTaskIds.add(id);
        }
        selectedTaskIds = selectedTaskIds;
    }

    function selectAllTasks() {
        const all = [...incompleteTasks, ...completedTasks];
        if (selectedTaskIds.size === all.length && all.length > 0) {
            selectedTaskIds.clear();
        } else {
            for (const t of all) {
                selectedTaskIds.add(t.id);
            }
        }
        selectedTaskIds = selectedTaskIds;
    }

    async function handleBatchStar() {
        if (!currentCategory || selectedTaskIds.size === 0) return;
        const all = [...incompleteTasks, ...completedTasks];
        const selected = all.filter(t => selectedTaskIds.has(t.id));
        if (selected.length === 0) return;
        const shouldStar = !selected.every(t => t.starred);
        for (const t of selected) {
            t.starred = shouldStar;
        }
        incompleteTasks = [...incompleteTasks];
        completedTasks = [...completedTasks];
        await dataService.saveTasks(currentCategory.filepath, [...incompleteTasks, ...completedTasks]);
        new Notice(shouldStar ? `⭐ 已收藏选中的 ${selected.length} 项任务` : `已取消收藏选中的 ${selected.length} 项任务`);
    }

    async function handleBatchDelete() {
        if (!currentCategory || selectedTaskIds.size === 0) return;
        const count = selectedTaskIds.size;
        if (!confirm(`确认批量删除选中的 ${count} 项任务？此操作不可逆。`)) return;

        incompleteTasks = incompleteTasks.filter(t => !selectedTaskIds.has(t.id));
        completedTasks = completedTasks.filter(t => !selectedTaskIds.has(t.id));
        await dataService.saveTasks(currentCategory.filepath, [...incompleteTasks, ...completedTasks]);
        selectedTaskIds.clear();
        selectedTaskIds = selectedTaskIds;
        isMultiSelectMode = false;
        new Notice(`🗑️ 已批量删除 ${count} 项任务`);
    }

    export { scheduleHidePopover };
</script>

<svelte:window 
    on:contextmenu={() => { if (popoverVisible) dismissPopover(); }} 
    on:keydown={(e) => {
        if (isMultiSelectMode && e.key === "Escape") {
            isMultiSelectMode = false;
            selectedTaskIds.clear();
            selectedTaskIds = selectedTaskIds;
        }
    }}
/>

<div class="main-container" class:wrap-titles={wrapTaskTitles} role="application">
    {#if currentCategory}
        <!-- Header -->
        <div class="main-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <h1 class="category-title">{currentCategory.name}</h1>
                <div class="main-header-actions">
                    <span class="icon-btn" on:click|stopPropagation={() => new TaskSearchModal(plugin.app, plugin, dataService, currentCategory?.filepath).open()}
                          role="button" tabindex="0" aria-label="Search this list" title="Search this list"
                          on:keydown|stopPropagation={(e) => e.key === "Enter" && new TaskSearchModal(plugin.app, plugin, dataService, currentCategory?.filepath).open()}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                    </span>

                    <!-- Multi-Select Toggle Button in Header -->
                    <span class="icon-btn" class:is-active={isMultiSelectMode}
                          on:click|stopPropagation={toggleMultiSelect}
                          role="button" tabindex="0" aria-label="多选任务 (批量删除/收藏)" title="多选任务 (批量删除/收藏)"
                          on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleMultiSelect()}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 11 12 14 22 4"></polyline>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                        </svg>
                    </span>

                    <!-- Backup Manager Button in Header -->
                    <span class="icon-btn"
                          on:click|stopPropagation={openBackupModal}
                          role="button" tabindex="0" aria-label="数据备份器" title="数据备份器"
                          on:keydown|stopPropagation={(e) => e.key === "Enter" && openBackupModal()}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="21 8 21 21 3 21 3 8"></polyline>
                            <rect x="1" y="3" width="22" height="5"></rect>
                            <line x1="10" y1="12" x2="14" y2="12"></line>
                        </svg>
                    </span>
                </div>
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
                    class:is-multi-selected={isMultiSelectMode && selectedTaskIds.has(task.id)}
                    on:pointerdown={() => handleTaskPointerDown(task)}
                    on:click={() => selectTask(task)}
                    on:contextmenu={(e) => handleContextMenu(e, task)}
                    on:keydown={(e) => e.key === "Enter" && selectTask(task)}
                    tabindex="0"
                    role="button"
                >
                    {#if isMultiSelectMode}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <span class="multi-select-checkbox-wrap" on:click|stopPropagation={() => toggleTaskSelection(task.id)}>
                            <span class="multi-select-checkbox" class:is-checked={selectedTaskIds.has(task.id)}>
                                {#if selectedTaskIds.has(task.id)}
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                {/if}
                            </span>
                        </span>
                    {/if}

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
                              on:mouseleave={handleTitleMouseLeave}>
                            {task.title}
                        </span>
                        <div class="task-meta-row">
                            {#if task.steps.length > 0}
                                <!-- svelte-ignore a11y-no-static-element-interactions -->
                                <span class="task-meta steps-badge"
                                      on:click|stopPropagation={() => openStepsModal(task)}
                                      on:keydown|stopPropagation={(e) => (e.key === "Enter" || e.key === " ") && openStepsModal(task)}
                                      on:mouseenter={(e) => showPopover(e, task, 'steps')}
                                      on:mouseleave={scheduleHidePopover}
                                      role="button"
                                      tabindex="0"
                                      title="Click to view & edit subtasks, hover to preview">
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
                              class:hard-bound={LinkedNoteService.isHardBoundNote(task.note_link)}
                              on:mouseenter={(e) => handleNoteLinkHover(e, task.note_link)}
                              on:click={(e) => handleNoteLinkClick(e, task.note_link)}
                              on:keydown={(e) => e.key === "Enter" && handleNoteLinkClick(e, task.note_link)}
                              role="button" tabindex="0"
                              title={LinkedNoteService.isHardBoundNote(task.note_link)
                                  ? `专属链接笔记: ${task.note_link} (点击跳转，悬停预览)`
                                  : `Linked note: ${task.note_link} (Click to open, hover to preview)`}>
                            {#if LinkedNoteService.isHardBoundNote(task.note_link)}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                                </svg>
                            {:else}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14 2 14 8 20 8"/>
                                    <line x1="16" y1="13" x2="8" y2="13"/>
                                    <line x1="16" y1="17" x2="8" y2="17"/>
                                    <polyline points="10 9 9 9 8 9"/>
                                </svg>
                            {/if}
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
            <div class="completed-section" class:is-collapsed={!showCompleted}>
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
                                class:is-multi-selected={isMultiSelectMode && selectedTaskIds.has(task.id)}
                                on:pointerdown={() => handleTaskPointerDown(task)}
                                on:click={() => selectTask(task)}
                                on:contextmenu={(e) => handleContextMenu(e, task)}
                                on:keydown={(e) => e.key === "Enter" && selectTask(task)}
                                tabindex="0"
                                role="button"
                            >
                                {#if isMultiSelectMode}
                                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                                    <span class="multi-select-checkbox-wrap" on:click|stopPropagation={() => toggleTaskSelection(task.id)}>
                                        <span class="multi-select-checkbox" class:is-checked={selectedTaskIds.has(task.id)}>
                                            {#if selectedTaskIds.has(task.id)}
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                                    <polyline points="20 6 9 17 4 12"></polyline>
                                                </svg>
                                            {/if}
                                        </span>
                                    </span>
                                {/if}

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
                                          on:mouseleave={handleTitleMouseLeave}>
                                        {task.title}
                                    </span>
                                    {#if (task.steps && task.steps.length > 0) || task.dueDate || task.recurrence}
                                        <div class="task-meta-row">
                                            {#if task.steps && task.steps.length > 0}
                                                <!-- svelte-ignore a11y-no-static-element-interactions -->
                                                <span class="task-meta steps-badge"
                                                      on:click|stopPropagation={() => openStepsModal(task)}
                                                      on:keydown|stopPropagation={(e) => (e.key === "Enter" || e.key === " ") && openStepsModal(task)}
                                                      on:mouseenter={(e) => showPopover(e, task, 'steps')}
                                                      on:mouseleave={scheduleHidePopover}
                                                      role="button"
                                                      tabindex="0"
                                                      title="Click to view & edit subtasks, hover to preview">
                                                    {task.steps.filter(s => s.done).length}/{task.steps.length} steps
                                                </span>
                                            {/if}
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
                                          class:hard-bound={LinkedNoteService.isHardBoundNote(task.note_link)}
                                          on:mouseenter={(e) => handleNoteLinkHover(e, task.note_link)}
                                          on:click={(e) => handleNoteLinkClick(e, task.note_link)}
                                          on:keydown={(e) => e.key === "Enter" && handleNoteLinkClick(e, task.note_link)}
                                          role="button" tabindex="0"
                                          title={LinkedNoteService.isHardBoundNote(task.note_link)
                                              ? `专属链接笔记: ${task.note_link} (点击跳转，悬停预览)`
                                              : `Linked note: ${task.note_link} (Click to open, hover to preview)`}>
                                        {#if LinkedNoteService.isHardBoundNote(task.note_link)}
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                                            </svg>
                                        {:else}
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                <polyline points="14 2 14 8 20 8"/>
                                                <line x1="16" y1="13" x2="8" y2="13"/>
                                                <line x1="16" y1="17" x2="8" y2="17"/>
                                                <polyline points="10 9 9 9 8 9"/>
                                            </svg>
                                        {/if}
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
             class:guide-popover={popoverType === 'guide'}
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
            {:else if popoverType === 'steps' && popoverTask && popoverTask.steps && popoverTask.steps.length > 0}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="meta-popover-steps-card"
                     on:click|stopPropagation={() => openStepsModal(popoverTask)}
                     on:keydown|stopPropagation={(e) => e.key === "Enter" && openStepsModal(popoverTask)}
                     role="button"
                     tabindex="0"
                     title="Click to open big subtasks editor">
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
                    <div class="meta-popover-expand-hint">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="15 3 21 3 21 9"/>
                            <polyline points="9 21 3 21 3 15"/>
                            <line x1="21" y1="3" x2="14" y2="10"/>
                            <line x1="3" y1="21" x2="10" y2="14"/>
                        </svg>
                        <span>Click to expand & edit</span>
                    </div>
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
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div class="meta-popover-detail-section"
                             style="cursor: pointer;"
                             title="Click to open big subtasks editor"
                             role="button"
                             tabindex="0"
                             on:click|stopPropagation={() => openStepsModal(popoverTask)}>
                            <div class="popover-detail-label" style="display: flex; justify-content: space-between; align-items: center;">
                                <span>Steps ({popoverTask.steps.filter(s => s.done).length}/{popoverTask.steps.length})</span>
                                <span style="font-size: 10px; color: var(--todo-accent); text-transform: none; font-weight: normal;">Expand ↗</span>
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
                            <span class="guide-key">Quick List Modal</span>
                            <span class="guide-desc">Full-screen board navigator, horizontal slider & 2D arrow keys</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Floating Detail Modal</span>
                            <span class="guide-desc">Sidebar-free centered popup for editing task details</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Quick Task Modal</span>
                            <span class="guide-desc">Maximized popup for rapid keyboard task management</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Ctrl + Hover Title</span>
                            <span class="guide-desc">Quick peek full title, subtasks & notes</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Drag & Drop Tasks</span>
                            <span class="guide-desc">Reorder in-list or drag across panes to sidebar lists</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Direct Hover Badges</span>
                            <span class="guide-desc">Preview Why (?), SVG (🖼️), Note (📄), Custom (🏷️)</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Click Steps Badge</span>
                            <span class="guide-desc">Open large scrollable subtasks editor (edit, add, check & IME shield)</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Dedicated Link Note</span>
                            <span class="guide-desc">Header button creates note, syncs titles bidirectionally & prompts on delete</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Click Note / SVG</span>
                            <span class="guide-desc">Jump directly to note or open full SVG Lightbox</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Recurring & Due Dates</span>
                            <span class="guide-desc">Daily/weekly repeats with automatic next rollover</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Right Click</span>
                            <span class="guide-desc">Dismiss popovers / context actions (Move & Delete)</span>
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
                    <!-- 1. Shortcuts -->
                    <div class="guide-section">
                        <div class="guide-section-title">⚡ Interaction Shortcuts</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Quick List Modal</span> Full-Screen Board Navigation</div>
                                <div class="guide-card-body">Press hotkey (or Command Palette) to summon the 100% full-screen dashboard board. Features auto-wrapping vertical columns, horizontal mouse-wheel panning, dynamic gap expansion & centering, and intuitive 2D arrow navigation (← ↑ → ↓ / Enter / F2).</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Detail View Mode</span> Floating Detail Modal</div>
                                <div class="guide-card-body">Toggle in Settings to inspect and edit task details in an elegant centered floating modal instead of expanding the right sidebar panel. Supports stacked two-tier metadata modals and Esc dismissal without disturbing your workspace.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Quick Task Modal</span> Dual-Pane Popup Manager</div>
                                <div class="guide-card-body">Summon the 92vw × 86vh floating task popup for lightning-fast task management with full keyboard navigation (↑↓←→, Space, Ctrl+N, Ctrl+Enter) and inline checklist triage.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Ctrl + Hover</span> Task Title Quick Peek</div>
                                <div class="guide-card-body">Hover over any task title while pressing <kbd>Ctrl</kbd> (or <kbd>Cmd</kbd> on macOS) to instantly pop up full title, subtasks checklist, notes, and due dates without opening the detail view.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Direct Hover</span> Meta Badges</div>
                                <div class="guide-card-body">Hovering over <span class="why-badge">?</span>, <span class="note-badge">📄</span>, <span class="svg-badge">🖼️</span>, or <span class="custom-badge">🏷️</span> instantly previews rationale, notes, SVGs, or custom properties with zero modifier keys.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Click Steps</span> Big Subtasks Floating Editor</div>
                                <div class="guide-card-body">Click any subtask badge (or the hover preview card) to open the spacious floating editor with large typography. Easily check off, edit multiline text, delete, or add steps with instant auto-save without opening the right task detail panel.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Right Click</span> Instant Dismiss & Context Actions</div>
                                <div class="guide-card-body">Right-click anywhere to immediately dismiss any open hover popover or full-screen SVG Lightbox. Right-click tasks to open move/delete context menus.</div>
                            </div>
                        </div>
                    </div>

                    <!-- 2. Drag & Drop -->
                    <div class="guide-section">
                        <div class="guide-section-title">🎯 Physics Drag & Drop System</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header">↕️ In-List Task Reordering</div>
                                <div class="guide-card-body">Grab and drag tasks up and down to reorder priorities with physics animations and uniform auto-scrolling when approaching the top or bottom edges.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">🔀 Cross-Pane Drag to Sidebar Lists</div>
                                <div class="guide-card-body">Drag any task from the center task list directly across onto any list or group in the left sidebar to transfer it instantly to that category.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">📁 Sidebar List & Group Hierarchy</div>
                                <div class="guide-card-body">Drag lists into groups to nest them, reorder groups in the sidebar, or pull nested lists back out to the root level.</div>
                            </div>
                        </div>
                    </div>

                    <!-- 3. Organization & Metadata -->
                    <div class="guide-section">
                        <div class="guide-section-title">📂 Organization & Metadata System</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header">❓ Why / Causal Methodology</div>
                                <div class="guide-card-body">Attach development instructions, rationales, or agent methodologies to tasks. Displayed as a clean <span class="why-badge">?</span> badge with rich hover popover.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">🔗 Dedicated Linked Notes & Title Hot-Sync</div>
                                <div class="guide-card-body">Click the dedicated Link Note button in the detail panel header to auto-create and open a dedicated note under <code>TodoData/&lt;ListName&gt;/</code>. Hard-bound notes feature a distinctive chain badge and bidirectional title hot-sync (renaming either task or note automatically updates the other with collision protection). Deleting prompts a confirmation modal to safely trash the note or retain it.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">🖼️ Visual Memory SVGs & Lightbox</div>
                                <div class="guide-card-body">Attach vault SVG diagrams or inline icons. Hover for 280px preview, click for full-screen zoom lightbox with one-click "Open in Tab" navigation.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">➕ Custom Metadata Manager</div>
                                <div class="guide-card-body">Click the <code>+</code> button next to Time at the bottom of the right detail view to add/manage custom properties, Why rationale, and linked notes.</div>
                            </div>
                        </div>
                    </div>

                    <!-- 4. Scheduling & Recurrence -->
                    <div class="guide-section">
                        <div class="guide-section-title">🔁 Recurring Tasks & Smart Due Dates</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header">🔁 Repeating Task Rules</div>
                                <div class="guide-card-body">Set tasks to repeat Daily, Weekdays (Mon–Fri), Weekly on chosen days, or Custom day/week intervals. Checking off a recurring task automatically advances to the next occurrence.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">📅 Due Dates & Overdue Badges</div>
                                <div class="guide-card-body">Set due dates with smart color-coded badges (<code>Due Today</code>, <code>Overdue</code>, <code>Repeats</code>) displayed directly in task rows and quick peeks.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">⭐ Priority Starring & Completed Toggle</div>
                                <div class="guide-card-body">Star priority tasks to keep them prominent. Collapse or expand completed tasks with a clean accordion toggle.</div>
                            </div>
                        </div>
                    </div>

                    <!-- 5. Search & Data Privacy -->
                    <div class="guide-section">
                        <div class="guide-section-title">🔍 Search & 100% Local Markdown Ownership</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header">🔍 Instant Global Search</div>
                                <div class="guide-card-body">Click <code>🔍</code> in the category header or trigger Search Modal anytime to search through tasks across all lists in milliseconds.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">🔒 100% Local Open Markdown Data</div>
                                <div class="guide-card-body">All tasks are saved directly in your vault under <code>TodoData/*.md</code> as standard checklists with discrete JSON comments. Zero proprietary lock-in.</div>
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

    <!-- Multi-Select Floating Action Toolbar -->
    {#if isMultiSelectMode}
        <div class="multi-select-floating-toolbar">
            <div class="multi-select-count">
                已选 <b>{selectedTaskIds.size}</b> 项
            </div>
            <button class="multi-select-btn" on:click={selectAllTasks}>
                {selectedTaskIds.size === (incompleteTasks.length + completedTasks.length) && (incompleteTasks.length + completedTasks.length) > 0 ? "取消全选" : "全选"}
            </button>
            <button class="multi-select-btn" on:click={handleBatchStar} disabled={selectedTaskIds.size === 0}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                <span>批量收藏</span>
            </button>
            <button class="multi-select-btn is-delete" on:click={handleBatchDelete} disabled={selectedTaskIds.size === 0}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>批量删除</span>
            </button>
            <button class="multi-select-btn is-exit" on:click={() => { isMultiSelectMode = false; selectedTaskIds.clear(); selectedTaskIds = selectedTaskIds; }}>
                <span>✕ 退出</span>
            </button>
        </div>
    {/if}
</div>
