<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { dndzone } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, STARRED_CATEGORY_PATH, type TaskItem, type TaskStep, type RecurrenceRule, type TrashedImageBackup } from "./types";
    import { SAVE_DEBOUNCE_MS } from "./constants";
    import { portal, autosize, longPress } from "./utils/domUtils";
    import { ensureStepIds, persistableSteps, reconcileDndSteps } from "./utils/stepIds";
    import { isTaskEmpty, isStepEmpty } from "./utils/taskUtils";
    import { DAY_LABELS, formatExactTime, getRelativeTime, getRecurrenceLabel } from "./utils/timeUtils";
    import { LinkedNoteService } from "./services/LinkedNoteService";
    import { promptDeleteTaskWithLinkedNote } from "./modals/ConfirmDeleteLinkedNoteModal";
    import { Menu, Notice, TFile } from "obsidian";
    import { t, isChinese } from "./lang/helpers";
    import { Logger } from "./Logger";
    import TaskImageThumbnail from "./components/TaskImageThumbnail.svelte";
    import TaskImageStrip from "./components/TaskImageStrip.svelte";
    import {
        saveImageAttachment,
        copyImageToClipboard,
        extractImageRefs,
        removeImageRefFromText,
        getImagesFromClipboard,
        isSameImageRef,
        getTitleImages,
        getNoteImages,
        getStepImages,
        getAllImagesInTask,
        removeImageFromTaskTitle,
        removeImageFromTaskNote,
        removeImageFromStepItem,
        cleanupOrphanImageAttachment,
        cleanupOrphanImages,
    } from "./utils/imageAttachmentUtils";

    const DND_FLIP_DURATION = 150;

    // =============================================
    // Props
    // =============================================
    export let dataService: DataService;
    export let plugin: any = undefined;
    export let isModal: boolean = false;
    export let isFullscreen: boolean = plugin?.settings?.fullscreenDetailModal ?? true;
    export let centerAlignTasks: boolean = plugin?.settings?.centerAlignTasks ?? true;
    export let onCloseModal: (() => void) | undefined = undefined;
    export let onToggleFullscreen: ((fullscreen: boolean) => void) | undefined = undefined;

    function toggleFullscreen() {
        isFullscreen = !isFullscreen;
        if (plugin?.settings) {
            plugin.settings.fullscreenDetailModal = isFullscreen;
            void plugin.saveSettings();
        }
        if (onToggleFullscreen) {
            onToggleFullscreen(isFullscreen);
        }
    }

    // =============================================
    // State
    // =============================================
    $: actualApp = dataService?.app || plugin?.app || (window as any).app;
    let task: TaskItem | null = null;
    let categoryFilepath: string = "";
    let newStepText: string = "";
    let newStepImages: string[] = [];
    let focusedTarget: { type: 'step'; stepId: string } | { type: 'newStep' } | { type: 'note' } | { type: 'title' } | null = null;
    let hoveredImageRef: { imageRef: string; stepId?: string; isNewDraft?: boolean; isNote?: boolean; isTitle?: boolean } | null = null;
    let showScheduleSection: boolean = false;
    let showRepeatPicker: boolean = false;
    let detailBodyEl: HTMLElement | null = null;
    let isDraggingSteps: boolean = false;
    let preDndSteps: TaskStep[] = [];

    function handleContainerWheel(e: WheelEvent) {
        if (detailBodyEl && e.target && !detailBodyEl.contains(e.target as Node)) {
            detailBodyEl.scrollTop += e.deltaY;
        }
    }

    function toggleScheduleSection() {
        showScheduleSection = !showScheduleSection;
        if (!showScheduleSection) {
            showRepeatPicker = false;
        }
    }

    function getScheduleBadge(t: TaskItem | null): {
        letter?: string;
        isOverdue: boolean;
        isActive: boolean;
        tooltip: string;
    } {
        if (!t) return { isOverdue: false, isActive: false, tooltip: "Due date & repeat" };
        const todayStr = new Date().toISOString().slice(0, 10);
        const isOverdue = !!(t.dueDate && t.dueDate < todayStr && !t.completed);
        const isDueToday = !!(t.dueDate && t.dueDate === todayStr);
        const hasRecurrence = !!t.recurrence;
        const isActive = isOverdue || isDueToday || hasRecurrence || !!t.dueDate;

        let letter: string | undefined = undefined;
        let tooltip = "Due date & repeat";

        if (t.recurrence) {
            const r = t.recurrence;
            if (r.type === 'daily' && (r.interval === 1 || !r.interval)) {
                letter = 'D';
                tooltip = isOverdue ? `Overdue (Daily, due ${t.dueDate})` : "Repeats daily";
            } else if (r.type === 'weekdays') {
                letter = 'W';
                tooltip = isOverdue ? `Overdue (Weekdays, due ${t.dueDate})` : "Repeats weekdays (Mon–Fri)";
            } else if (r.type === 'weekly' && r.daysOfWeek && r.daysOfWeek.length === 1) {
                const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
                letter = dayLetters[r.daysOfWeek[0]];
                tooltip = isOverdue ? `Overdue (${DAY_LABELS[r.daysOfWeek[0]]}, due ${t.dueDate})` : `Repeats weekly on ${DAY_LABELS[r.daysOfWeek[0]]}`;
            } else {
                tooltip = isOverdue ? `Overdue (${t.dueDate})` : getRecurrenceLabel(r);
            }
        } else if (t.dueDate) {
            tooltip = isOverdue ? `Overdue (${t.dueDate})` : (isDueToday ? "Due today" : `Due ${t.dueDate}`);
        }

        return { letter, isOverdue, isActive, tooltip };
    }

    $: scheduleBadge = getScheduleBadge(task);

    function getRecurrenceLabel(rule: RecurrenceRule | undefined): string {
        if (!rule) return "Does not repeat";
        switch (rule.type) {
            case 'daily': return rule.interval === 1 ? "Every day" : `Every ${rule.interval} days`;
            case 'weekdays': return "Weekdays (Mon–Fri)";
            case 'weekly': {
                const days = (rule.daysOfWeek || []).map(d => DAY_LABELS[d]).join(', ');
                const prefix = rule.interval === 1 ? "Every week" : `Every ${rule.interval} weeks`;
                return days ? `${prefix} on ${days}` : prefix;
            }
            case 'custom': {
                if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
                    const days = rule.daysOfWeek.map(d => DAY_LABELS[d]).join(', ');
                    return `Every ${rule.interval} week(s) on ${days}`;
                }
                return `Every ${rule.interval} day(s)`;
            }
            default: return "Does not repeat";
        }
    }

    function setRecurrencePreset(type: RecurrenceRule['type']) {
        if (!task) return;
        // Ensure dueDate exists
        if (!task.dueDate) {
            task.dueDate = new Date().toISOString().slice(0, 10);
        }
        switch (type) {
            case 'daily':
                task.recurrence = { type: 'daily', interval: 1 };
                break;
            case 'weekdays':
                task.recurrence = { type: 'weekdays', interval: 1 };
                break;
            case 'weekly':
                task.recurrence = { type: 'weekly', interval: 1, daysOfWeek: [new Date().getDay()] };
                break;
            case 'custom':
                task.recurrence = { type: 'daily', interval: 1 };
                showRepeatPicker = true;
                break;
        }
        task = task;
        immediateSave();
    }

    function clearRecurrence() {
        if (!task) return;
        task.recurrence = undefined;
        task = task;
        showRepeatPicker = false;
        immediateSave();
    }

    function setDueDatePreset(preset: 'today' | 'tomorrow' | 'next-week') {
        if (!task) return;
        const d = new Date();
        if (preset === 'tomorrow') {
            d.setDate(d.getDate() + 1);
        } else if (preset === 'next-week') {
            // Next Monday
            const day = d.getDay();
            const diff = day === 0 ? 1 : 8 - day;
            d.setDate(d.getDate() + diff);
        }
        task.dueDate = d.toISOString().slice(0, 10);
        task = task;
        immediateSave();
    }

    function clearDueDate() {
        if (!task) return;
        task.dueDate = undefined;
        task.recurrence = undefined;
        task = task;
        showRepeatPicker = false;
        immediateSave();
    }

    function toggleWeekday(day: number) {
        if (!task || !task.recurrence) return;
        let days = task.recurrence.daysOfWeek || [];
        if (days.includes(day)) {
            days = days.filter(d => d !== day);
        } else {
            days = [...days, day].sort((a, b) => a - b);
        }
        task.recurrence = { ...task.recurrence, daysOfWeek: days };
        scheduleSave();
    }

    function handleWeekdayClick(day: number) {
        if (!task) return;
        if (!task.recurrence) {
            task.recurrence = { type: 'weekly', interval: 1, daysOfWeek: [day] };
        } else {
            toggleWeekday(day);
        }
        if (!task.dueDate) {
            task.dueDate = new Date().toISOString().slice(0, 10);
        }
        scheduleSave();
    }

    function setCustomInterval(val: number) {
        if (!task) return;
        if (!task.dueDate) {
            task.dueDate = new Date().toISOString().slice(0, 10);
        }
        task.recurrence = { type: 'custom', interval: Math.max(1, val) };
        scheduleSave();
    }

    // Debounce timer for auto-saving on input changes
    let saveTimeout: any = null;

    // =============================================
    // Lifecycle
    // =============================================
    function handleMetaModalKeydown(e: KeyboardEvent) {
        if (showMetaSaveConfirmModal) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                void saveAndCloseMetaModal();
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                cancelMetaSavePrompt();
                return;
            }
            return;
        }

        if (e.key === "Escape") {
            if (showAddMetaModal) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                requestCloseAddMetaModal();
                return;
            }
            if (showRepeatPicker) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                showRepeatPicker = false;
                return;
            }
        }
    }

    function hasActiveTextSelection(): boolean {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
            if (typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
                if (active.selectionStart !== active.selectionEnd) return true;
            }
        }
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
            return true;
        }
        return false;
    }

    const handleImageKeydown = (e: KeyboardEvent) => {
        if (document.querySelector(".task-img-preview-modal-shell")) {
            return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
            if (hasActiveTextSelection()) return;

            if ((e.key === "c" || e.key === "C") && hoveredImageRef) {
                e.preventDefault();
                e.stopPropagation();
                void handleCopyHoveredImage();
                return;
            }
            if ((e.key === "x" || e.key === "X") && hoveredImageRef) {
                e.preventDefault();
                e.stopPropagation();
                void handleCutHoveredImage();
                return;
            }
        }
    };

    function handleSettingsChanged(payload?: any) {
        centerAlignTasks = payload?.settings?.centerAlignTasks ?? plugin?.settings?.centerAlignTasks ?? true;
        isFullscreen = payload?.settings?.fullscreenDetailModal ?? plugin?.settings?.fullscreenDetailModal ?? true;
    }

    onMount(() => {
        EventBus.on(EventName.TASK_SELECTED, handleTaskSelected);
        EventBus.on(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.on(EventName.TASK_UPDATED, handleExternalTaskUpdate);
        EventBus.on(EventName.SETTINGS_CHANGED, handleSettingsChanged);
        window.addEventListener("keydown", handleMetaModalKeydown, true);
        window.addEventListener("keydown", handleImageKeydown, true);
    });

    onDestroy(() => {
        if (newStepImages.length > 0 && actualApp && dataService) {
            const draftImages = [...newStepImages];
            newStepImages = [];
            void cleanupOrphanImages(draftImages, actualApp, dataService);
        }
        EventBus.off(EventName.TASK_SELECTED, handleTaskSelected);
        EventBus.off(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.off(EventName.TASK_UPDATED, handleExternalTaskUpdate);
        EventBus.off(EventName.SETTINGS_CHANGED, handleSettingsChanged);
        window.removeEventListener("keydown", handleMetaModalKeydown, true);
        window.removeEventListener("keydown", handleImageKeydown, true);
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
            void immediateSave();
        }
    });

    // Called from main.ts when the view is opened directly
    export function loadTask(t: TaskItem, filepath: string) {
        task = { ...t, steps: ensureStepIds(t.id, t.steps ? t.steps.map(s => ({ ...s })) : []) };
        categoryFilepath = filepath;
        showScheduleSection = false;
        showRepeatPicker = false;
        showAddMetaModal = false;
        showMetaSaveConfirmModal = false;
        initialMetaSnapshot = "";

        // Auto-heal task_note if pointing to broken/stale path or standard note exists
        if (task && (task.task_note || task.id) && plugin?.app) {
            const effectiveCategory = (categoryFilepath === STARRED_CATEGORY_PATH && task.sourceFilepath)
                ? task.sourceFilepath
                : categoryFilepath;
            const resolved = LinkedNoteService.resolveTaskNoteFile(plugin.app, task, effectiveCategory);
            if (resolved && !LinkedNoteService.isCategoryListFile(resolved)) {
                const currentClean = resolved.path.replace(/\.md$/, "");
                const expected = `[[${currentClean}]]`;
                if (task.task_note !== expected) {
                    task.task_note = expected;
                    void dataService.updateTask(categoryFilepath, task);
                }
            } else if (task.task_note && (LinkedNoteService.isCategoryListFile(task.task_note) || !LinkedNoteService.isHardBoundNote(task.task_note))) {
                delete task.task_note;
                void dataService.updateTask(categoryFilepath, task);
            }
        }
    }

    // =============================================
    // EventBus Handlers
    // =============================================
    function handleTaskSelected(payload: any) {
        loadTask(payload.task, payload.categoryFilepath);
    }

    async function checkAndDeleteEmptyTask(): Promise<boolean> {
        if (!task || !categoryFilepath || !isTaskEmpty(task)) {
            return false;
        }
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
        const toDelete = task;
        const path = categoryFilepath;
        task = null;
        categoryFilepath = "";
        showScheduleSection = false;
        showRepeatPicker = false;
        showAddMetaModal = false;
        showMetaSaveConfirmModal = false;
        initialMetaSnapshot = "";
        EventBus.emit(EventName.DETAIL_CLOSE, {});
        try {
            const trashedImages = await dataService.deleteTask(path, toDelete);
            EventBus.emit(EventName.TASK_DELETED, { task: toDelete, categoryFilepath: path, trashedImages });
        } catch (err) {
            console.error("Failed to delete empty task:", err);
        }
        if (isModal && onCloseModal) {
            onCloseModal();
        }
        return true;
    }

    function handleClose() {
        if (newStepImages.length > 0 && actualApp && dataService) {
            const draftImages = [...newStepImages];
            newStepImages = [];
            void cleanupOrphanImages(draftImages, actualApp, dataService);
        }
        if (task && isTaskEmpty(task)) {
            void checkAndDeleteEmptyTask();
            return;
        }
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
            void immediateSave();
        }
        task = null;
        categoryFilepath = "";
        showScheduleSection = false;
        showRepeatPicker = false;
        showAddMetaModal = false;
        showMetaSaveConfirmModal = false;
        initialMetaSnapshot = "";
        if (isModal && onCloseModal) {
            onCloseModal();
        }
    }

    function handleTaskDeleted(payload: any) {
        if (!task) return;
        if (payload.task && payload.task.id === task.id) {
            handleClose();
        } else if (payload.tasks && Array.isArray(payload.tasks) && payload.tasks.some((t: any) => t.id === task?.id)) {
            handleClose();
        }
    }

    async function handleExternalTaskUpdate(payload: any) {
        if (!task || !categoryFilepath || isDraggingSteps) return;
        if (!payload.categoryFilepath || payload.categoryFilepath === categoryFilepath) {
            if (payload.task && payload.task.id === task.id) {
                task = { ...payload.task, steps: ensureStepIds(payload.task.id, payload.task.steps ? payload.task.steps.map((s: any) => ({ ...s })) : []) };
                return;
            }
            if (payload.isExternal) {
                // External file write (AI, sync, external editor, or rollover) — reload task from disk
                const tasks = await dataService.getTasks(categoryFilepath);
                const fresh = tasks.find(t => t.id === task?.id);
                if (fresh) {
                    task = { ...fresh, steps: ensureStepIds(fresh.id, fresh.steps ? fresh.steps.map((s: any) => ({ ...s })) : []) };
                }
            }
        }
    }

    // =============================================
    // Auto-Save (Debounced)
    // =============================================
    function scheduleSave() {
        if (isDraggingSteps) {
            void Logger.log(`[DND Detail] scheduleSave suppressed during active drag`);
            return;
        }
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            if (!task || !categoryFilepath || isDraggingSteps) return;
            if (isTaskEmpty(task)) {
                if (focusedTarget?.type === 'title') {
                    return;
                }
                await checkAndDeleteEmptyTask();
                return;
            }
            task.steps = persistableSteps(task.steps);
            if (task.task_note && plugin?.app) {
                const syncRes = await LinkedNoteService.syncTaskTitleToNote(plugin.app, task, categoryFilepath, dataService);
                if (syncRes.noteRenamed && syncRes.newTaskNote) {
                    task.task_note = syncRes.newTaskNote;
                }
            }
            await dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, {
                task,
                categoryFilepath,
            });
        }, SAVE_DEBOUNCE_MS);
    }

    // =============================================
    // Task Actions
    // =============================================
    let isComposingTitle = false;

    function handleTitleCompositionStart() {
        isComposingTitle = true;
    }

    function handleTitleCompositionEnd() {
        isComposingTitle = false;
        scheduleSave();
    }

    function handleTitleInput() {
        if (isComposingTitle) return;
        scheduleSave();
    }

    function handleTitleBlur() {
        if (isComposingTitle) {
            isComposingTitle = false;
        }
        if (task && isTaskEmpty(task)) {
            void checkAndDeleteEmptyTask();
            return;
        }
        void immediateSave();
    }

    function handleTitleKeydown(e: KeyboardEvent) {
        if (e.isComposing || isComposingTitle || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (task && isTaskEmpty(task)) {
                void checkAndDeleteEmptyTask();
                return;
            }
            (e.currentTarget as HTMLElement).blur();
        }
    }

    async function toggleComplete() {
        if (!task) return;
        task.completed = !task.completed;
        if (task.completed) {
            task.completedAt = new Date().toISOString();
        } else {
            delete task.completedAt;
        }
        task = task; // trigger reactivity
        await immediateSave();
    }

    async function toggleStar() {
        if (!task) return;
        task.starred = !task.starred;
        task = task;
        await immediateSave();
    }

    async function immediateSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        if (!task || !categoryFilepath || isDraggingSteps) return;
        if (isTaskEmpty(task)) {
            await checkAndDeleteEmptyTask();
            return;
        }
        task.steps = persistableSteps(task.steps);
        if (task.task_note && plugin?.app) {
            const syncRes = await LinkedNoteService.syncTaskTitleToNote(plugin.app, task, categoryFilepath, dataService);
            if (syncRes.noteRenamed && syncRes.newTaskNote) {
                task.task_note = syncRes.newTaskNote;
            }
        }
        await dataService.updateTask(categoryFilepath, task);
        EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath });
    }

    // =============================================
    // Task Note Actions (Dedicated Note for this Task)
    // =============================================
    $: hasTaskNote = !!(task && ((task.task_note && LinkedNoteService.isHardBoundNote(task.task_note)) || (task.note_link && LinkedNoteService.isHardBoundNote(task.note_link))));
    $: taskNoteTooltip = hasTaskNote
        ? t("task_note_tooltip_exists", task?.task_note || task?.note_link || "")
        : t("task_note_tooltip_create");

    function getTaskNoteLinks(t: TaskItem | null): string[] {
        if (!t) return [];
        if (t.note_links && Array.isArray(t.note_links) && t.note_links.length > 0) {
            return t.note_links.filter(nl => !LinkedNoteService.isCategoryListFile(nl));
        }
        if (t.note_link && typeof t.note_link === "string" && t.note_link.trim()) {
            if (!LinkedNoteService.isHardBoundNote(t.note_link) && !LinkedNoteService.isCategoryListFile(t.note_link)) {
                return [t.note_link.trim()];
            }
        }
        return [];
    }

    function handleTaskNoteHover(e: MouseEvent) {
        if (!hasTaskNote || !task || !plugin?.app) return;
        const file = LinkedNoteService.resolveTaskNoteFile(plugin.app, task, categoryFilepath);
        const targetLink = task.task_note || (task.note_link && LinkedNoteService.isHardBoundNote(task.note_link) ? task.note_link : "");
        const cleanLink = file ? file.path.replace(/\.md$/, "") : (targetLink ? LinkedNoteService.sanitizeLinkpath(targetLink) : "");
        if (!cleanLink || cleanLink.includes(":")) return;

        const proxiedEvent = new Proxy(e, {
            get(target, prop) {
                if (prop === "ctrlKey" || prop === "metaKey") return true;
                const val = (target as any)[prop];
                return typeof val === "function" ? val.bind(target) : val;
            }
        });

        const effectiveCategory = (categoryFilepath === STARRED_CATEGORY_PATH && task?.sourceFilepath)
            ? task.sourceFilepath
            : categoryFilepath;

        plugin.app.workspace.trigger("hover-link", {
            event: proxiedEvent,
            source: "fluent-tasks",
            hoverParent: e.currentTarget as HTMLElement,
            targetEl: e.currentTarget as HTMLElement,
            linktext: cleanLink,
            sourcePath: effectiveCategory || "",
        });
    }

    function handleNoteChipHover(e: MouseEvent, noteItem: string) {
        if (!noteItem || !plugin?.app) return;
        const effectiveCategory = (categoryFilepath === STARRED_CATEGORY_PATH && task?.sourceFilepath)
            ? task.sourceFilepath
            : categoryFilepath;
        const resolved = LinkedNoteService.resolveLinkedNoteFile(plugin.app, noteItem, effectiveCategory);
        const cleanLink = resolved ? resolved.path.replace(/\.md$/, "") : LinkedNoteService.sanitizeLinkpath(noteItem);
        if (!cleanLink || cleanLink.includes(":")) return;

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
            sourcePath: effectiveCategory || "",
        });
    }

    async function handleTaskNoteClick(e: MouseEvent | KeyboardEvent) {
        e.stopPropagation();
        if (!task || !categoryFilepath || !plugin?.app) return;

        if (hasTaskNote) {
            let file = LinkedNoteService.resolveTaskNoteFile(plugin.app, task, categoryFilepath);
            if (!file && task.id) {
                file = await LinkedNoteService.findFileByTaskIdAsync(plugin.app, task.id, categoryFilepath);
            }
            if (file) {
                const clean = file.path.replace(/\.md$/, "");
                const expected = `[[${clean}]]`;
                if (task.task_note !== expected) {
                    task.task_note = expected;
                    task = task;
                    await immediateSave();
                }
                await LinkedNoteService.openLinkedNoteFile(plugin.app, file);
                if (isModal) {
                    closePanel();
                }
            } else {
                // Re-create dedicated note if file was removed
                const res = await LinkedNoteService.createOrGetTaskNote(plugin.app, task, categoryFilepath, dataService);
                task.task_note = res.noteLink;
                task = task;
                await immediateSave();
                await LinkedNoteService.openLinkedNoteFile(plugin.app, res.file);
                new Notice(t("task_note_recreated", res.file.basename));
                if (isModal) {
                    closePanel();
                }
            }
        } else {
            // Create brand new dedicated task note and jump to it
            const res = await LinkedNoteService.createOrGetTaskNote(plugin.app, task, categoryFilepath, dataService);
            task.task_note = res.noteLink;
            task = task;
            await immediateSave();
            await LinkedNoteService.openLinkedNoteFile(plugin.app, res.file);
            new Notice(t("task_note_created", res.file.basename));
            if (isModal) {
                closePanel();
            }
        }
    }

    function handleTaskNoteContextMenu(e: MouseEvent) {
        if (!hasTaskNote || !plugin?.app || !task) return;
        e.preventDefault();
        e.stopPropagation();
        const menu = new Menu();
        menu.addItem((item: any) => {
            item.setTitle(t("open_task_note"))
                .setIcon("file-text")
                .onClick(() => {
                    void handleTaskNoteClick(e);
                });
        });
        menu.addItem((item: any) => {
            item.setTitle(t("unlink_task_note"))
                .setIcon("unlink")
                .onClick(async () => {
                    if (!task) return;
                    delete task.task_note;
                    if (task.note_link && LinkedNoteService.isHardBoundNote(task.note_link)) {
                        delete task.note_link;
                    }
                    task = task;
                    await immediateSave();
                    new Notice(t("unlink_task_note_success"));
                });
        });
        menu.showAtMouseEvent(e);
    }

    // =============================================
    // Image Attachment Helpers
    // =============================================
    function removeImageFromTitle(imageRef: string) {
        if (!task) return;
        removeImageFromTaskTitle(task, imageRef);
        task = task;
        if (isTaskEmpty(task)) {
            void checkAndDeleteEmptyTask();
            return;
        }
        immediateSave();
        if (actualApp && dataService) {
            void cleanupOrphanImageAttachment(imageRef, actualApp, dataService);
        }
    }

    function removeImageFromStep(stepId: string | undefined, imageRef: string) {
        if (!task || !task.steps || !stepId) return;
        const step = task.steps.find(s => s.id === stepId);
        if (!step) return;
        removeImageFromStepItem(step, imageRef);
        if (isStepEmpty(step)) {
            void deleteStep(stepId);
            return;
        }
        task = task;
        immediateSave();
        if (actualApp && dataService) {
            void cleanupOrphanImageAttachment(imageRef, actualApp, dataService);
        }
    }

    function handleStepBlur(stepId: string | undefined) {
        if (stepId && task?.steps) {
            const step = task.steps.find(s => s.id === stepId);
            if (step && isStepEmpty(step)) {
                void deleteStep(stepId);
                return;
            }
        }
        scheduleSave();
    }

    function removeNewStepImage(imageRef: string) {
        newStepImages = newStepImages.filter(img => !isSameImageRef(img, imageRef));
        if (actualApp && dataService) {
            void cleanupOrphanImageAttachment(imageRef, actualApp, dataService);
        }
    }

    function removeImageFromNote(imageRef: string) {
        if (!task) return;
        removeImageFromTaskNote(task, imageRef);
        task = task;
        immediateSave();
        if (actualApp && dataService) {
            void cleanupOrphanImageAttachment(imageRef, actualApp, dataService);
        }
    }

    async function handleCutHoveredImage() {
        if (!hoveredImageRef || !actualApp) return;
        const { imageRef, stepId, isNewDraft, isNote, isTitle } = hoveredImageRef;
        await copyImageToClipboard(imageRef, actualApp, t("image_cut") || "Image cut to clipboard / 图片已剪切至剪贴板");
        if (isNewDraft) {
            removeNewStepImage(imageRef);
        } else if (stepId) {
            removeImageFromStep(stepId, imageRef);
        } else if (isTitle) {
            removeImageFromTitle(imageRef);
        } else if (isNote) {
            removeImageFromNote(imageRef);
        }
        hoveredImageRef = null;
    }

    async function handleCopyHoveredImage() {
        if (!hoveredImageRef || !actualApp) return;
        await copyImageToClipboard(hoveredImageRef.imageRef, actualApp, t("image_copied") || "Image copied to clipboard / 图片已复制到剪贴板");
    }

    function handlePaste(e: ClipboardEvent) {
        if (!actualApp || !task) return;
        const files = getImagesFromClipboard(e);
        if (!files || files.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const ft = focusedTarget;
        void (async () => {
            for (const file of files) {
                const savedPath = await saveImageAttachment(file, actualApp, categoryFilepath);
                if (!savedPath) continue;

                if (ft && ft.type === "title") {
                    if (task) {
                        task.titleImages = [...(task.titleImages || []), savedPath];
                        task = task;
                        immediateSave();
                        continue;
                    }
                } else if (ft && ft.type === "step") {
                    const targetStep = task?.steps?.find(s => s.id === ft.stepId);
                    if (targetStep) {
                        targetStep.images = [...(targetStep.images || []), savedPath];
                        task = task;
                        immediateSave();
                        continue;
                    }
                } else if (ft && ft.type === "newStep") {
                    newStepImages = [...newStepImages, savedPath];
                    continue;
                }

                if (task) {
                    task.images = [...(task.images || []), savedPath];
                    task = task;
                    immediateSave();
                }
            }
        })();
    }

    async function handleDrop(e: DragEvent) {
        if (!actualApp || !task) return;
        const dataTransfer = e.dataTransfer;
        if (!dataTransfer || !dataTransfer.files || dataTransfer.files.length === 0) return;
        const imgFiles: File[] = [];
        for (let i = 0; i < dataTransfer.files.length; i++) {
            if (dataTransfer.files[i].type.startsWith("image/")) {
                imgFiles.push(dataTransfer.files[i]);
            }
        }
        if (imgFiles.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        const ft = focusedTarget;
        for (const file of imgFiles) {
            const savedPath = await saveImageAttachment(file, actualApp, categoryFilepath);
            if (!savedPath) continue;

            if (ft && ft.type === "title") {
                task.titleImages = [...(task.titleImages || []), savedPath];
                task = task;
                immediateSave();
                continue;
            } else if (ft && ft.type === "step") {
                const targetStep = task.steps?.find(s => s.id === ft.stepId);
                if (targetStep) {
                    targetStep.images = [...(targetStep.images || []), savedPath];
                    task = task;
                    immediateSave();
                    continue;
                }
            } else if (ft && ft.type === "newStep") {
                newStepImages = [...newStepImages, savedPath];
                continue;
            }

            task.images = [...(task.images || []), savedPath];
            task = task;
            immediateSave();
        }
    }

    // =============================================
    // Step Actions
    // =============================================
    function addStep() {
        const text = newStepText.trim();
        if ((!text && newStepImages.length === 0) || !task) return;
        const newStep: TaskStep = {
            id: `${task.id}-step-${Date.now()}-${task.steps.length}`,
            text,
            done: false,
            ...(newStepImages.length > 0 ? { images: [...newStepImages] } : {})
        };
        task.steps = [...task.steps, newStep];
        newStepText = "";
        newStepImages = [];
        task = task;
        void Logger.log(`[DND Detail] Added step: taskId=${task.id}, stepId=${newStep.id}, text="${newStep.text}", images=${newStep.images?.length || 0}, totalSteps=${task.steps.length}`);
        console.log(`[FluentTasks] Added step: taskId=${task.id}, stepId=${newStep.id}, total=${task.steps.length}`);
        scheduleSave();
    }

    function handleStepKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            addStep();
        }
    }

    function toggleStepDone(stepId?: string) {
        if (!task || !stepId) return;
        const step = task.steps.find(s => s.id === stepId);
        if (step) {
            step.done = !step.done;
            task.steps = [...task.steps]; // trigger reactivity
            task = task;
            void Logger.log(`[DND Detail] Toggled step done: taskId=${task.id}, stepId=${stepId}, done=${step.done}`);
            console.log(`[FluentTasks] Toggled step: taskId=${task.id}, stepId=${stepId}, done=${step.done}`);
            scheduleSave();
        }
    }

    function updateStepText(stepId: string | undefined, newText: string) {
        if (!task || !stepId) return;
        const step = task.steps.find(s => s.id === stepId);
        if (step) {
            step.text = newText;
            scheduleSave();
        }
    }

    async function deleteStep(stepId?: string) {
        if (!task || !stepId) return;
        const index = task.steps.findIndex(s => s.id === stepId);
        if (index === -1) return;
        const deletedStep = { ...task.steps[index] };
        const stepImages = getStepImages(deletedStep);
        task.steps = task.steps.filter(s => s.id !== stepId);
        task = task;
        void Logger.log(`[DND Detail] Deleted step: taskId=${task.id}, stepId=${stepId}, text="${deletedStep.text}", remaining=${task.steps.length}`);
        console.log(`[FluentTasks] Deleted step: taskId=${task.id}, stepId=${stepId}, remaining=${task.steps.length}`);
        await immediateSave();
        let trashedImages: TrashedImageBackup[] = [];
        if (stepImages.length > 0 && actualApp && dataService) {
            trashedImages = await cleanupOrphanImages(stepImages, actualApp, dataService);
        }
        EventBus.emit(EventName.STEP_DELETED, {
            taskId: task.id,
            categoryFilepath,
            step: deletedStep,
            index,
            trashedImages,
        });
    }

    function handleDndConsider(e: CustomEvent<{ items: TaskStep[]; info: any }>) {
        if (!task) return;
        const trigger = e.detail.info?.trigger || "unknown";
        const incoming = e.detail.items || [];

        if (!isDraggingSteps) {
            isDraggingSteps = true;
            preDndSteps = task.steps ? task.steps.map(s => ({ ...s })) : [];
            if (saveTimeout) {
                clearTimeout(saveTimeout);
                saveTimeout = null;
            }
            void Logger.log(`[DND Detail] Drag started: taskId="${task.id}", preCount=${preDndSteps.length}, trigger=${trigger}`, {
                stepIds: preDndSteps.map(s => s.id)
            });
            console.log(`[FluentTasks DND] Drag started: taskId=${task.id}, count=${preDndSteps.length}, trigger=${trigger}`);
        }

        void Logger.log(`[DND Detail] Consider: trigger=${trigger}, incomingCount=${incoming.length}`);
        task.steps = incoming;
        task = task;
    }

    function handleDndFinalize(e: CustomEvent<{ items: TaskStep[]; info: any }>) {
        if (!task) return;
        const trigger = e.detail.info?.trigger || "unknown";
        const incoming = e.detail.items || [];

        void Logger.log(`[DND Detail] Finalize initiated: trigger=${trigger}, incomingCount=${incoming.length}, preCount=${preDndSteps.length}`);
        console.log(`[FluentTasks DND] Finalize: trigger=${trigger}, incoming=${incoming.length}, preCount=${preDndSteps.length}`);

        const safeSteps = reconcileDndSteps(preDndSteps, incoming, trigger);
        task.steps = safeSteps;
        task = task;
        isDraggingSteps = false;
        preDndSteps = [];

        void Logger.log(`[DND Detail] Finalize completed: finalCount=${safeSteps.length}, stepIds=${safeSteps.map(s => s.id).join(",")}`);
        scheduleSave();
    }

    // =============================================
    // Note
    // =============================================
    function handleNoteInput() {
        scheduleSave();
    }

    // =============================================
    // Footer Actions
    // =============================================
    function closePanel() {
        if (task && isTaskEmpty(task)) {
            void checkAndDeleteEmptyTask();
            return;
        }
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
            void immediateSave();
        }
        task = null;
        categoryFilepath = "";
        showScheduleSection = false;
        showRepeatPicker = false;
        showAddMetaModal = false;
        showMetaSaveConfirmModal = false;
        initialMetaSnapshot = "";
        EventBus.emit(EventName.DETAIL_CLOSE, {});
        if (isModal && onCloseModal) {
            onCloseModal();
        }
    }

    async function deleteTask() {
        if (!task || !categoryFilepath || !plugin?.app) return;
        const toDelete = task;
        const path = categoryFilepath;
        await promptDeleteTaskWithLinkedNote(
            plugin.app,
            toDelete,
            path,
            dataService,
            () => {
                task = null;
                categoryFilepath = "";
            }
        );
    }

    let showAddMetaModal: boolean = false;
    let showMetaSaveConfirmModal: boolean = false;
    let initialMetaSnapshot: string = "";
    let metaFormType: "why" | "note_link" | "svg" | "custom" = "why";
    let metaWhyList: string[] = [];
    let selectedWhyIndex: number = 0;
    let metaSvgList: string[] = [];
    let selectedSvgIndex: number = 0;
    let metaNoteLinks: string[] = [];
    let selectedNoteLinkIndex: number = 0;
    let metaCustomEntries: Array<{ key: string; value: string }> = [];
    let selectedCustomIndex: number = 0;

    function getMetaSnapshot(): string {
        return JSON.stringify({
            whys: metaWhyList,
            noteLinks: metaNoteLinks,
            svgs: metaSvgList,
            custom: metaCustomEntries
        });
    }

    function isMetaDirty(): boolean {
        if (!showAddMetaModal) return false;
        return getMetaSnapshot() !== initialMetaSnapshot;
    }

    function requestCloseAddMetaModal() {
        if (isMetaDirty()) {
            showMetaSaveConfirmModal = true;
            return;
        }
        forceCloseAddMetaModal();
    }

    function forceCloseAddMetaModal() {
        showMetaSaveConfirmModal = false;
        showAddMetaModal = false;
        initialMetaSnapshot = "";
    }

    async function saveAndCloseMetaModal() {
        showMetaSaveConfirmModal = false;
        await saveMetadata();
    }

    function discardAndCloseMetaModal() {
        showMetaSaveConfirmModal = false;
        forceCloseAddMetaModal();
    }

    function cancelMetaSavePrompt() {
        showMetaSaveConfirmModal = false;
    }

    function getTaskWhys(t: TaskItem): string[] {
        if (t.whys && Array.isArray(t.whys) && t.whys.length > 0) {
            return [...t.whys];
        }
        if (t.why && typeof t.why === "string" && t.why.trim()) {
            return [t.why.trim()];
        }
        return [];
    }

    async function focusMetaEditorInput() {
        await tick();
        const editor = document.querySelector(".meta-item-editor input, .meta-item-editor textarea") as HTMLElement | null;
        if (editor) {
            editor.focus();
        }
    }

    function openAddMetaModal(type: "why" | "note_link" | "svg" | "custom" = "why", targetIndexOrKey?: number | string) {
        if (!task) return;
        metaFormType = type;

        // 1. Whys
        metaWhyList = getTaskWhys(task);
        if (typeof targetIndexOrKey === "number" && type === "why") {
            selectedWhyIndex = Math.min(Math.max(0, targetIndexOrKey), metaWhyList.length - 1);
        } else {
            selectedWhyIndex = metaWhyList.length > 0 ? 0 : -1;
        }

        // 2. SVGs
        metaSvgList = Array.isArray(task.svgs) ? [...task.svgs] : [];
        if (typeof targetIndexOrKey === "number" && type === "svg") {
            selectedSvgIndex = Math.min(Math.max(0, targetIndexOrKey), metaSvgList.length - 1);
        } else {
            selectedSvgIndex = metaSvgList.length > 0 ? 0 : -1;
        }

        // 3. Note Links
        metaNoteLinks = getTaskNoteLinks(task);
        if (typeof targetIndexOrKey === "number" && type === "note_link") {
            selectedNoteLinkIndex = Math.min(Math.max(0, targetIndexOrKey), metaNoteLinks.length - 1);
        } else {
            selectedNoteLinkIndex = metaNoteLinks.length > 0 ? 0 : -1;
        }

        // 4. Custom Meta
        metaCustomEntries = task.customMeta
            ? Object.entries(task.customMeta).map(([k, v]) => ({ key: k, value: String(v) }))
            : [];
        if (typeof targetIndexOrKey === "string" && type === "custom") {
            const foundIdx = metaCustomEntries.findIndex(e => e.key === targetIndexOrKey);
            selectedCustomIndex = foundIdx >= 0 ? foundIdx : (metaCustomEntries.length > 0 ? 0 : -1);
        } else {
            selectedCustomIndex = metaCustomEntries.length > 0 ? 0 : -1;
        }

        showAddMetaModal = true;
        showMetaSaveConfirmModal = false;
        initialMetaSnapshot = getMetaSnapshot();
        void focusMetaEditorInput();
    }

    function closeAddMetaModal() {
        requestCloseAddMetaModal();
    }

    function addNewSvgItem() {
        metaSvgList = [...metaSvgList, ""];
        selectedSvgIndex = metaSvgList.length - 1;
        void focusMetaEditorInput();
    }

    function removeSvgItem(idx: number) {
        metaSvgList = metaSvgList.filter((_, i) => i !== idx);
        if (selectedSvgIndex >= metaSvgList.length) {
            selectedSvgIndex = metaSvgList.length - 1;
        }
    }

    function addNewWhyItem() {
        metaWhyList = [...metaWhyList, ""];
        selectedWhyIndex = metaWhyList.length - 1;
        void focusMetaEditorInput();
    }

    function removeWhyItem(idx: number) {
        metaWhyList = metaWhyList.filter((_, i) => i !== idx);
        if (selectedWhyIndex >= metaWhyList.length) {
            selectedWhyIndex = metaWhyList.length - 1;
        }
    }

    function addNewNoteLinkItem() {
        metaNoteLinks = [...metaNoteLinks, ""];
        selectedNoteLinkIndex = metaNoteLinks.length - 1;
        void focusMetaEditorInput();
    }

    function removeNoteLinkItem(idx: number) {
        metaNoteLinks = metaNoteLinks.filter((_, i) => i !== idx);
        if (selectedNoteLinkIndex >= metaNoteLinks.length) {
            selectedNoteLinkIndex = metaNoteLinks.length - 1;
        }
    }

    async function deleteNoteLinkEntry(idx: number) {
        if (!task) return;
        const currentLinks = getTaskNoteLinks(task);
        currentLinks.splice(idx, 1);
        if (currentLinks.length > 0) {
            task.note_links = currentLinks;
            task.note_link = currentLinks[0];
        } else {
            delete task.note_links;
            delete task.note_link;
        }
        task = { ...task };
        if (categoryFilepath) {
            await dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath });
        }
    }

    function addNewCustomEntry() {
        metaCustomEntries = [...metaCustomEntries, { key: "", value: "" }];
        selectedCustomIndex = metaCustomEntries.length - 1;
        void focusMetaEditorInput();
    }

    function removeCustomEntry(idx: number) {
        metaCustomEntries = metaCustomEntries.filter((_, i) => i !== idx);
        if (selectedCustomIndex >= metaCustomEntries.length) {
            selectedCustomIndex = metaCustomEntries.length - 1;
        }
    }

    async function handleTestOpenNote(val: string) {
        if (!val || !plugin?.app) return;
        const file = LinkedNoteService.resolveLinkedNoteFile(plugin.app, val, categoryFilepath);
        if (file) {
            await LinkedNoteService.openLinkedNoteFile(plugin.app, file);
            new Notice(`Opened note: ${file.basename}`);
        } else {
            const clean = LinkedNoteService.sanitizeLinkpath(val);
            if (clean && !clean.includes(":")) {
                try {
                    plugin.app.workspace.openLinkText(clean, categoryFilepath, false);
                    return;
                } catch (e) {
                    void Logger.log("[TaskDetail] openLinkText failed:", e);
                }
            }
            new Notice(`Cannot find note in vault matching "${val.trim()}"`);
        }
    }

    async function saveMetadata() {
        if (!task) return;

        // 1. Save Whys
        const cleanWhys = metaWhyList.map(w => w.trim()).filter(Boolean);
        if (cleanWhys.length > 0) {
            task.whys = cleanWhys;
            task.why = cleanWhys[0];
        } else {
            delete task.whys;
            delete task.why;
        }

        // 2. Save Note Links
        const cleanNoteLinks = metaNoteLinks
            .map(l => l.trim())
            .filter(Boolean)
            .filter(raw => !LinkedNoteService.isCategoryListFile(raw))
            .map(raw => {
                const unbracketed = raw.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
                const parts = unbracketed.split("|");
                const target = parts[0].trim();
                const alias = parts.length > 1 ? parts.slice(1).join("|").trim() : "";

                const resolvedFile = LinkedNoteService.resolveLinkedNoteFile(plugin.app, target, categoryFilepath);
                if (resolvedFile && !LinkedNoteService.isCategoryListFile(resolvedFile)) {
                    const cleanPath = resolvedFile.path.replace(/\.md$/, "");
                    return alias ? `[[${cleanPath}|${alias}]]` : `[[${cleanPath}]]`;
                }
                return LinkedNoteService.normalizeNoteLinkInput(raw);
            });
        if (cleanNoteLinks.length > 0) {
            task.note_links = cleanNoteLinks;
            task.note_link = cleanNoteLinks[0];
        } else {
            delete task.note_links;
            delete task.note_link;
        }

        // 3. Save SVGs
        const cleanSvgs = metaSvgList.map(s => s.trim()).filter(Boolean);
        if (cleanSvgs.length > 0) {
            task.svgs = cleanSvgs;
        } else {
            delete task.svgs;
        }

        // 4. Save Custom Meta
        const cleanCustom: Record<string, unknown> = {};
        for (const entry of metaCustomEntries) {
            const k = entry.key.trim();
            const v = entry.value.trim();
            if (k) cleanCustom[k] = v;
        }
        if (Object.keys(cleanCustom).length > 0) {
            task.customMeta = cleanCustom;
        } else {
            delete task.customMeta;
        }

        task = { ...task };
        if (categoryFilepath) {
            await dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, {
                task,
                categoryFilepath,
            });
        }
        forceCloseAddMetaModal();
    }

    async function deleteCustomKey(key: string) {
        if (!task || !task.customMeta) return;
        delete task.customMeta[key];
        if (Object.keys(task.customMeta).length === 0) {
            delete task.customMeta;
        }
        task = { ...task };
        if (categoryFilepath) {
            await dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, {
                task,
                categoryFilepath,
            });
        }
    }

    async function deleteWhyEntry(idx: number) {
        if (!task) return;
        const currentWhys = getTaskWhys(task);
        currentWhys.splice(idx, 1);
        if (currentWhys.length > 0) {
            task.whys = currentWhys;
            task.why = currentWhys[0];
        } else {
            delete task.whys;
            delete task.why;
        }
        task = { ...task };
        if (categoryFilepath) {
            await dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath });
        }
    }

    async function deleteSvgEntry(idx: number) {
        if (!task || !task.svgs) return;
        task.svgs.splice(idx, 1);
        if (task.svgs.length === 0) {
            delete task.svgs;
        }
        task = { ...task };
        if (categoryFilepath) {
            await dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath });
        }
    }

    async function deleteMetaProp(prop: 'why' | 'note_link' | 'svg') {
        if (!task) return;
        if (prop === 'why') {
            delete task.whys;
            delete task.why;
        } else if (prop === 'note_link') {
            delete task.note_links;
            delete task.note_link;
        } else if (prop === 'svg') {
            delete task.svgs;
        }
        task = { ...task };
        if (categoryFilepath) {
            await dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, {
                task,
                categoryFilepath,
            });
        }
    }

    // =============================================
    // SVG Resolution & Long-Press Source File Trashing
    // =============================================
    const svgResolveCache = new Map<string, { isInline: boolean; content: string; srcUrl: string; cleanPath: string }>();

    function resolveSvgItem(svgStr: string): { isInline: boolean; content: string; srcUrl: string; cleanPath: string } {
        if (!svgStr) return { isInline: false, content: "", srcUrl: "", cleanPath: "" };
        const cached = svgResolveCache.get(svgStr);
        if (cached) return cached;

        const trimmed = svgStr.trim();
        if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml") || trimmed.includes("</svg>")) {
            let processed = trimmed;
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

        const cleanPath = trimmed.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        let file: any = null;
        if (plugin?.app?.metadataCache) {
            file = plugin.app.metadataCache.getFirstLinkpathDest(cleanPath, categoryFilepath || "");
        }
        if (!file && plugin?.app?.vault) {
            file = plugin.app.vault.getAbstractFileByPath(cleanPath);
        }
        const rawSrc = file && plugin?.app?.vault?.adapter ? plugin.app.vault.adapter.getResourcePath(file.path) : cleanPath;
        const srcUrl = rawSrc ? (rawSrc.includes("?") ? `${rawSrc}&t=${Date.now()}` : `${rawSrc}?t=${Date.now()}`) : "";
        const res = {
            isInline: false,
            content: trimmed,
            srcUrl: srcUrl || cleanPath,
            cleanPath: file?.path || cleanPath,
        };
        svgResolveCache.set(svgStr, res);
        return res;
    }

    function resolveSourceFileFromSvg(svgStr: string): TFile | null {
        if (!svgStr || !plugin?.app) return null;
        const trimmed = svgStr.trim();
        if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml") || trimmed.includes("</svg>")) {
            return null;
        }
        const cleanPath = trimmed.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        let file: any = null;
        if (plugin.app.metadataCache) {
            file = plugin.app.metadataCache.getFirstLinkpathDest(cleanPath, categoryFilepath || "");
        }
        if (!file && plugin.app.vault) {
            file = plugin.app.vault.getAbstractFileByPath(cleanPath);
        }
        return (file instanceof TFile) ? file : null;
    }

    async function trashSourceFile(file: TFile | null) {
        if (!file) {
            new Notice("内联 SVG 无物理源文件，仅从任务元数据中移除");
            return;
        }
        if (!plugin?.app?.fileManager) return;
        try {
            await plugin.app.fileManager.trashFile(file);
            new Notice(`已将源文件移至废纸篓: ${file.name}`);
        } catch (err: any) {
            console.error("Failed to trash file:", err);
            new Notice(`移至废纸篓失败: ${err?.message || err}`);
        }
    }

    async function deleteSvgWithSourceFile(idx: number) {
        if (idx < 0 || idx >= metaSvgList.length) return;
        const svgStr = metaSvgList[idx];
        const file = resolveSourceFileFromSvg(svgStr);
        await trashSourceFile(file);
        removeSvgItem(idx);
    }

    async function deleteSvgChipWithSourceFile(idx: number) {
        if (!task || !task.svgs || idx < 0 || idx >= task.svgs.length) return;
        const svgStr = task.svgs[idx];
        const file = resolveSourceFileFromSvg(svgStr);
        await trashSourceFile(file);
        await deleteSvgEntry(idx);
    }

    async function deleteTaskWithLongPress() {
        if (!task || !categoryFilepath || !plugin?.app) return;
        const toDelete = task;
        const path = categoryFilepath;
        const effectiveCategory = (path === STARRED_CATEGORY_PATH && toDelete.sourceFilepath)
            ? toDelete.sourceFilepath
            : path;
        const taskNoteFile = LinkedNoteService.resolveTaskNoteFile(plugin.app, toDelete, effectiveCategory);
        let trashedTaskNote: { path: string; name: string; content?: string } | undefined = undefined;
        if (taskNoteFile && !LinkedNoteService.isCategoryListFile(taskNoteFile)) {
            let content: string | undefined = undefined;
            try {
                content = await plugin.app.vault.read(taskNoteFile);
            } catch { /* ignore */ }
            trashedTaskNote = { path: taskNoteFile.path, name: taskNoteFile.name, content };
            await trashSourceFile(taskNoteFile);
        }
        if (toDelete.svgs) {
            for (const s of toDelete.svgs) {
                const svgFile = resolveSourceFileFromSvg(s);
                if (svgFile) {
                    await trashSourceFile(svgFile);
                }
            }
        }
        const trashedImages = await dataService.deleteTask(path, toDelete);
        EventBus.emit(EventName.TASK_DELETED, { 
            task: toDelete, 
            categoryFilepath: path,
            trashedTaskNote,
            trashedImages
        });
        task = null;
        categoryFilepath = "";
        new Notice("已直接删除任务及源文件至废纸篓");
    }

    function handleOpenSvgFile(resolved: { isInline: boolean; cleanPath: string }) {
        if (!resolved.isInline && resolved.cleanPath && plugin?.app) {
            plugin.app.workspace.openLinkText(resolved.cleanPath, categoryFilepath || "", false);
            if (isModal) {
                closePanel();
            }
        }
    }
</script>

<div class="detail-container" class:is-center-aligned={centerAlignTasks} on:wheel={handleContainerWheel} on:paste={handlePaste} on:dragover|preventDefault on:drop={handleDrop}>
    {#if task}
        <!-- Scrollable Content Body -->
        <div class="detail-body" bind:this={detailBodyEl}>
            <!-- Header: Checkbox + Title + Star -->
            <div class="detail-header" class:is-center-aligned={centerAlignTasks}>
            <div class="title-row" class:is-center-aligned={centerAlignTasks}>
                <!-- Completion circle -->
                <span class="checkbox" on:click={toggleComplete}
                      role="checkbox" aria-checked={task.completed} tabindex="0"
                      on:keydown={(e) => e.key === "Enter" && toggleComplete()}>
                    {#if task.completed}
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                             stroke="var(--todo-accent)" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="8 12 11 15 16 9"/>
                        </svg>
                    {:else}
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                        </svg>
                    {/if}
                </span>

                <!-- Title content column (Thumbnails + Divider + Title textarea) -->
                <div class="title-content-col" class:is-center-aligned={centerAlignTasks}>
                    {#if getTitleImages(task).length > 0}
                        <TaskImageStrip
                            images={getTitleImages(task)}
                            app={actualApp}
                            size={44}
                            isCenterAligned={centerAlignTasks}
                            onDelete={(imgRef) => removeImageFromTitle(imgRef)}
                            onCut={(imgRef) => removeImageFromTitle(imgRef)}
                            onHover={(imgRef, isHovered) => {
                                if (isHovered) {
                                    hoveredImageRef = { imageRef: imgRef, isTitle: true };
                                } else if (hoveredImageRef?.imageRef === imgRef) {
                                    hoveredImageRef = null;
                                }
                            }}
                        />
                    {/if}
                    <textarea
                        use:autosize={task.title}
                        class="detail-title-input"
                        class:is-center-aligned={centerAlignTasks}
                        rows="1"
                        bind:value={task.title}
                        on:focus={() => { focusedTarget = { type: 'title' }; }}
                        on:input={handleTitleInput}
                        on:compositionstart={handleTitleCompositionStart}
                        on:compositionend={handleTitleCompositionEnd}
                        on:blur={handleTitleBlur}
                        on:keydown={handleTitleKeydown}
                        placeholder="Task title"
                    />
                </div>

                <!-- Right Actions (Task Note Button + Modal Actions) -->
                <div class="title-right-actions">
                    <!-- Task Note Button (dedicated note for this task) -->
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <span class="detail-link-note-btn" class:active={hasTaskNote}
                          on:click={handleTaskNoteClick}
                          on:mouseenter={handleTaskNoteHover}
                          on:contextmenu={handleTaskNoteContextMenu}
                          role="button" tabindex="0"
                          title={taskNoteTooltip}
                          on:keydown={(e) => e.key === "Enter" && handleTaskNoteClick(e)}>
                        {#if hasTaskNote}
                            <!-- Dedicated task note active icon (File Text / Document with lines) -->
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                                <line x1="10" y1="9" x2="8" y2="9"/>
                            </svg>
                        {:else}
                            <!-- Create dedicated task note icon (Document with plus) -->
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="12" y1="18" x2="12" y2="12"/>
                                <line x1="9" y1="15" x2="15" y2="15"/>
                            </svg>
                        {/if}
                    </span>

                    {#if isModal}
                        <div class="detail-modal-actions">
                            <!-- Fullscreen / Restore Toggle Button -->
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <span class="detail-modal-fullscreen-btn"
                                  on:click={toggleFullscreen}
                                  role="button" tabindex="0"
                                  title={isFullscreen ? (t("restore_window") || "Restore window / 还原窗口") : (t("fullscreen_window") || "Full screen / 全屏放大")}
                                  on:keydown={(e) => e.key === "Enter" && toggleFullscreen()}>
                                {#if isFullscreen}
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="4 14 10 14 10 20"/>
                                        <polyline points="20 10 14 10 14 4"/>
                                        <line x1="14" y1="10" x2="21" y2="3"/>
                                        <line x1="3" y1="21" x2="10" y2="14"/>
                                    </svg>
                                {:else}
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="15 3 21 3 21 9"/>
                                        <polyline points="9 21 3 21 3 15"/>
                                        <line x1="21" y1="3" x2="14" y2="10"/>
                                        <line x1="3" y1="21" x2="10" y2="14"/>
                                    </svg>
                                {/if}
                            </span>

                            <!-- Close button in modal mode -->
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <span class="detail-modal-close-btn"
                                  on:click={closePanel}
                                  role="button" tabindex="0"
                                  title="Close details (Esc)"
                                  on:keydown={(e) => e.key === "Enter" && closePanel()}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"/>
                                    <line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </span>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Steps -->
            <div class="steps-container" class:is-center-aligned={centerAlignTasks}>
                {#if task.steps && task.steps.length > 0}
                    <div
                        class="steps-dnd-zone"
                        use:dndzone={{
                            items: task.steps,
                            flipDurationMs: DND_FLIP_DURATION,
                            dropAnimationDisabled: true,
                            dropTargetStyle: {},
                            type: 'task-step-' + task.id
                        }}
                        on:consider={handleDndConsider}
                        on:finalize={handleDndFinalize}
                    >
                        {#each task.steps as step (step.id)}
                            <div class="step-item" class:is-center-aligned={centerAlignTasks} animate:flip={{ duration: DND_FLIP_DURATION }}>
                                <div class="step-left-controls">
                                    <span class="step-drag-handle" title="Drag to reorder">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                            <circle cx="9" cy="5" r="1.8"/>
                                            <circle cx="15" cy="5" r="1.8"/>
                                            <circle cx="9" cy="12" r="1.8"/>
                                            <circle cx="15" cy="12" r="1.8"/>
                                            <circle cx="9" cy="19" r="1.8"/>
                                            <circle cx="15" cy="19" r="1.8"/>
                                        </svg>
                                    </span>
                                    <span class="checkbox" on:click|stopPropagation={() => toggleStepDone(step.id)}
                                          role="checkbox" aria-checked={step.done} tabindex="0"
                                          on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleStepDone(step.id)}>
                                        {#if step.done}
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                                 stroke="var(--todo-accent)" stroke-width="2">
                                                <circle cx="12" cy="12" r="10"/>
                                                <polyline points="8 12 11 15 16 9"/>
                                            </svg>
                                        {:else}
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                                 stroke="currentColor" stroke-width="2">
                                                <circle cx="12" cy="12" r="10"/>
                                            </svg>
                                        {/if}
                                    </span>
                                </div>
                                <div class="step-content-col" class:is-center-aligned={centerAlignTasks}>
                                    {#if getStepImages(step).length > 0}
                                        <TaskImageStrip
                                            images={getStepImages(step)}
                                            app={actualApp}
                                            size={38}
                                            isCenterAligned={centerAlignTasks}
                                            onDelete={(imgRef) => removeImageFromStep(step.id, imgRef)}
                                            onCut={(imgRef) => removeImageFromStep(step.id, imgRef)}
                                            onHover={(imgRef, isHovered) => {
                                                if (isHovered && step.id) {
                                                    hoveredImageRef = { imageRef: imgRef, stepId: step.id };
                                                } else if (hoveredImageRef?.imageRef === imgRef) {
                                                    hoveredImageRef = null;
                                                }
                                            }}
                                        />
                                    {/if}
                                    <textarea
                                        use:autosize={step.text}
                                        rows="1"
                                        value={step.text}
                                        class:completed={step.done}
                                        class:is-center-aligned={centerAlignTasks}
                                        on:focus={() => { if (step.id) focusedTarget = { type: 'step', stepId: step.id }; }}
                                        on:input={(e) => updateStepText(step.id, e.currentTarget.value)}
                                        on:blur={() => handleStepBlur(step.id)}
                                        on:keydown={(e) => {
                                            if (e.key === "Enter" && !e.shiftKey) {
                                                if (isStepEmpty(step)) {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    if (focusedTarget?.type === 'step' && focusedTarget.stepId === step.id) {
                                                        focusedTarget = null;
                                                    }
                                                    void deleteStep(step.id);
                                                    return;
                                                }
                                                e.preventDefault();
                                                e.currentTarget.blur();
                                            }
                                        }}
                                        placeholder="Step text"
                                    />
                                </div>
                                <span class="delete-step" on:click|stopPropagation={() => deleteStep(step.id)}
                                      role="button" tabindex="0"
                                      on:keydown|stopPropagation={(e) => e.key === "Enter" && deleteStep(step.id)}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                         stroke="currentColor" stroke-width="2">
                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                </span>
                            </div>
                        {/each}
                    </div>
                {/if}

                <!-- Add step row (kept outside dndzone so dndzone children strictly equal items) -->
                <div class="add-step-card" class:is-center-aligned={centerAlignTasks}>
                    {#if newStepImages.length > 0}
                        <TaskImageStrip
                            images={newStepImages}
                            app={actualApp}
                            size={38}
                            isCenterAligned={centerAlignTasks}
                            onDelete={(imgRef) => removeNewStepImage(imgRef)}
                            onCut={(imgRef) => removeNewStepImage(imgRef)}
                            onHover={(imgRef, isHovered) => {
                                if (isHovered) {
                                    hoveredImageRef = { imageRef: imgRef, isNewDraft: true };
                                } else if (hoveredImageRef?.imageRef === imgRef) {
                                    hoveredImageRef = null;
                                }
                            }}
                        />
                    {/if}
                    <div class="add-step-row" class:is-center-aligned={centerAlignTasks}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        <input
                            class="add-step-input"
                            class:is-center-aligned={centerAlignTasks}
                            type="text"
                            placeholder="Add step (Ctrl+V to paste image)"
                            bind:value={newStepText}
                            on:focus={() => { focusedTarget = { type: 'newStep' }; }}
                            on:keydown={handleStepKeydown}
                        />
                    </div>
                </div>
            </div>
        </div>

        <!-- Note -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="note-section" class:is-center-aligned={centerAlignTasks} on:focusin={() => { focusedTarget = { type: 'note' }; }}>
            {#if getNoteImages(task).length > 0}
                <TaskImageStrip
                    images={getNoteImages(task)}
                    app={actualApp}
                    size={44}
                    isCenterAligned={centerAlignTasks}
                    onDelete={(imgRef) => removeImageFromNote(imgRef)}
                    onCut={(imgRef) => removeImageFromNote(imgRef)}
                    onHover={(imgRef, isHovered) => {
                        if (isHovered) {
                            hoveredImageRef = { imageRef: imgRef, isNote: true };
                        } else if (hoveredImageRef?.imageRef === imgRef) {
                            hoveredImageRef = null;
                        }
                    }}
                />
            {/if}
            <textarea
                class="note-textarea"
                class:is-center-aligned={centerAlignTasks}
                placeholder="Add note (Ctrl+V to paste image)"
                bind:value={task.note}
                on:focus={() => { focusedTarget = { type: 'note' }; }}
                on:input={handleNoteInput}
            ></textarea>
        </div>

        <!-- Active Metadata Chips (Why, Note Link, SVG, Custom) -->
        {#if getTaskWhys(task).length > 0 || getTaskNoteLinks(task).length > 0 || (task.svgs && task.svgs.length > 0) || (task.customMeta && Object.keys(task.customMeta).length > 0)}
            <div class="detail-meta-chips-section" class:is-center-aligned={centerAlignTasks}>
                {#if getTaskWhys(task).length > 0}
                    {#each getTaskWhys(task) as whyItem, idx}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div class="meta-chip why-chip" title={whyItem}
                             on:click={() => openAddMetaModal('why', idx)}
                             role="button" tabindex="0">
                            <span class="chip-label">{getTaskWhys(task).length > 1 ? `Why #${idx + 1}` : 'Why'}</span>
                            <span class="chip-val">{whyItem}</span>
                            <span class="chip-delete" on:click|stopPropagation={() => deleteWhyEntry(idx)}
                                  role="button" tabindex="0" title={`Remove Why #${idx + 1}`}>✕</span>
                        </div>
                    {/each}
                {/if}
                {#if getTaskNoteLinks(task).length > 0}
                    {#each getTaskNoteLinks(task) as noteItem, idx}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div class="meta-chip note-chip" title={noteItem}
                             on:mouseenter={(e) => handleNoteChipHover(e, noteItem)}
                             on:click={() => openAddMetaModal('note_link', idx)}
                             role="button" tabindex="0">
                            <span class="chip-label">{getTaskNoteLinks(task).length > 1 ? `Note #${idx + 1}` : 'Note'}</span>
                            <span class="chip-val">{noteItem}</span>
                            <span class="chip-delete" on:click|stopPropagation={() => deleteNoteLinkEntry(idx)}
                                  role="button" tabindex="0" title={`Remove Note #${idx + 1}`}>✕</span>
                        </div>
                    {/each}
                {/if}
                {#if task.svgs && task.svgs.length > 0}
                    {#each task.svgs as svgItem, idx}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div class="meta-chip svg-chip" title={svgItem}
                             on:click={() => openAddMetaModal('svg', idx)}
                             role="button" tabindex="0">
                            <span class="chip-label">{task.svgs.length > 1 ? `SVG #${idx + 1}` : 'SVG'}</span>
                            <span class="chip-val">{svgItem.length > 30 ? svgItem.slice(0, 30) + '...' : svgItem}</span>
                            <span class="chip-delete"
                              use:longPress={{
                                  duration: 1500,
                                  onLongPress: () => deleteSvgChipWithSourceFile(idx),
                                  onClick: () => deleteSvgEntry(idx)
                              }}
                              on:keydown={(e) => e.key === "Enter" && deleteSvgEntry(idx)}
                              role="button" tabindex="0" title={`Click to remove, hold 1.5s to trash source file / 长按1.5秒直接删除源文件至垃圾桶`}>✕</span>
                        </div>
                    {/each}
                {/if}
                {#if task.customMeta}
                    {#each Object.entries(task.customMeta) as [k, v]}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div class="meta-chip custom-chip" title={`${k}: ${v}`}
                             on:click={() => openAddMetaModal('custom', k)}
                             role="button" tabindex="0">
                            <span class="chip-label">{k}</span>
                            <span class="chip-val">{v}</span>
                            <span class="chip-delete" on:click|stopPropagation={() => deleteCustomKey(k)}
                                  role="button" tabindex="0" title={`Remove ${k}`}>✕</span>
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}
        </div>

        <!-- Due Date & Repeat Section (Collapsible Drawer) -->
        {#if showScheduleSection}
            <div class="detail-schedule-section">
                <!-- Due Date Row -->
                <div class="schedule-row">
                    <div class="schedule-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                    </div>
                    <div class="schedule-content">
                        <span class="schedule-label">Due date</span>
                        <input
                            type="date"
                            class="due-date-input"
                            value={task.dueDate || ''}
                            on:change={(e) => {
                                if (task) {
                                    task.dueDate = e.currentTarget.value || undefined;
                                    scheduleSave();
                                }
                            }}
                        />
                    </div>
                    {#if task.dueDate}
                        <span class="schedule-clear-btn" on:click={clearDueDate}
                              role="button" tabindex="0" title="Clear due date"
                              on:keydown={(e) => e.key === "Enter" && clearDueDate()}>
                            ✕
                        </span>
                    {/if}
                </div>

                <!-- Repeat Row -->
                <div class="schedule-row clickable" on:click={() => showRepeatPicker = !showRepeatPicker}
                     role="button" tabindex="0"
                     on:keydown={(e) => e.key === "Enter" && (showRepeatPicker = !showRepeatPicker)}>
                    <div class="schedule-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="17 1 21 5 17 9"/>
                            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                            <polyline points="7 23 3 19 7 15"/>
                            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                        </svg>
                    </div>
                    <div class="schedule-content">
                        <span class="schedule-label">Repeat</span>
                        <span class="schedule-value" class:active={!!task.recurrence}>
                            {getRecurrenceLabel(task.recurrence)}
                        </span>
                    </div>
                    {#if task.recurrence}
                        <span class="schedule-clear-btn" on:click|stopPropagation={clearRecurrence}
                              role="button" tabindex="0" title="Remove recurrence"
                              on:keydown|stopPropagation={(e) => e.key === "Enter" && clearRecurrence()}>
                            ✕
                        </span>
                    {/if}
                </div>

                <!-- Repeat Picker Panel -->
                {#if showRepeatPicker}
                    <div class="repeat-picker-panel">
                        <div class="repeat-presets">
                            <button type="button" class="preset-btn" class:active={task.recurrence?.type === 'daily' && task.recurrence?.interval === 1}
                                    on:click={() => setRecurrencePreset('daily')}>Daily</button>
                            <button type="button" class="preset-btn" class:active={task.recurrence?.type === 'weekdays'}
                                    on:click={() => setRecurrencePreset('weekdays')}>Weekdays</button>
                            <button type="button" class="preset-btn" class:active={task.recurrence?.type === 'weekly' && task.recurrence?.interval === 1}
                                    on:click={() => setRecurrencePreset('weekly')}>Weekly</button>
                        </div>

                        <!-- Custom / Weekday selector -->
                        <div class="custom-repeat-section">
                            <div class="repeat-days-grid">
                                {#each [1, 2, 3, 4, 5, 6, 0] as day}
                                    <button
                                        type="button"
                                        class="weekday-chip"
                                        class:active={task.recurrence?.daysOfWeek?.includes(day)}
                                        on:click={() => handleWeekdayClick(day)}
                                    >
                                        {DAY_LABELS[day]}
                                    </button>
                                {/each}
                            </div>

                            <div class="custom-interval-row">
                                <span>Every</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="99"
                                    class="interval-input"
                                    value={task.recurrence?.interval || 1}
                                    on:change={(e) => setCustomInterval(parseInt(e.currentTarget.value) || 1)}
                                />
                                <span>day(s)</span>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        {/if}

        <!-- Footer: Schedule Drawer Toggle | Time Badge & Add Meta | Delete -->
        <div class="detail-footer">
            <!-- Schedule / Repeat Drawer Toggle -->
            <span class="footer-btn schedule-toggle-btn"
                  class:is-active={scheduleBadge.isActive}
                  class:is-overdue={scheduleBadge.isOverdue}
                  class:is-open={showScheduleSection}
                  on:click={toggleScheduleSection}
                  role="button" tabindex="0" title={scheduleBadge.tooltip}
                  on:keydown={(e) => e.key === "Enter" && toggleScheduleSection()}>
                {#if scheduleBadge.letter}
                    <span class="schedule-badge-letter">{scheduleBadge.letter}</span>
                {:else if task.recurrence}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="17 1 21 5 17 9"/>
                        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                        <polyline points="7 23 3 19 7 15"/>
                        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                    </svg>
                {:else}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                {/if}
            </span>

            <!-- Center: Time Badge + Add Meta Button -->
            <div class="footer-meta-tools">
                <span class="footer-btn time-badge-btn"
                      role="button" tabindex="0"
                      title={`Created: ${formatExactTime(task.createdAt)} (${getRelativeTime(task.createdAt)})`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <span class="time-badge-text">{getRelativeTime(task.createdAt)}</span>
                </span>

                <span class="footer-btn add-meta-btn"
                      on:click={() => openAddMetaModal()}
                      on:keydown={(e) => e.key === "Enter" && openAddMetaModal()}
                      role="button" tabindex="0" title="Add / Edit metadata (Why, Note Link, SVG, Custom)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                </span>
            </div>

            <!-- Delete -->
            <span class="footer-btn danger"
                  use:longPress={{
                      duration: 1500,
                      onLongPress: () => deleteTaskWithLongPress(),
                      onClick: () => deleteTask()
                  }}
                  role="button" tabindex="0" title="Delete task (hold 1.5s to trash task & source files directly / 长按1.5秒直接删除任务及源文件)"
                  on:keydown={(e) => e.key === "Enter" && deleteTask()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </span>
        </div>

        <!-- Add / Manage Metadata Modal Dialog (Portaled to document.body) -->
        {#if showAddMetaModal}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div use:portal
                 class="meta-modal-backdrop" on:click|stopPropagation={(e) => e.target === e.currentTarget && requestCloseAddMetaModal()} role="presentation">
                <div class="meta-modal-dialog" role="dialog" aria-modal="true" tabindex="-1"
                     on:pointerdown|stopPropagation
                     on:mousedown|stopPropagation
                     on:click|stopPropagation>
                    <div class="meta-modal-header">
                        <div class="meta-modal-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="3"/>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                            </svg>
                            <span>Task Metadata</span>
                        </div>
                        <span class="meta-modal-close" on:click={requestCloseAddMetaModal}
                              on:keydown={(e) => e.key === "Enter" && requestCloseAddMetaModal()}
                              role="button" tabindex="0">✕</span>
                    </div>

                    <div class="meta-modal-tabs">
                        <button type="button" class="meta-modal-tab" class:active={metaFormType === 'why'}
                                on:click={() => { metaFormType = 'why'; void focusMetaEditorInput(); }}>Why ({metaWhyList.length})</button>
                        <button type="button" class="meta-modal-tab" class:active={metaFormType === 'note_link'}
                                on:click={() => { metaFormType = 'note_link'; void focusMetaEditorInput(); }}>Note Links ({metaNoteLinks.length})</button>
                        <button type="button" class="meta-modal-tab" class:active={metaFormType === 'svg'}
                                on:click={() => { metaFormType = 'svg'; void focusMetaEditorInput(); }}>Visual SVG ({metaSvgList.length})</button>
                        <button type="button" class="meta-modal-tab" class:active={metaFormType === 'custom'}
                                on:click={() => { metaFormType = 'custom'; void focusMetaEditorInput(); }}>Custom ({metaCustomEntries.length})</button>
                    </div>

                    <div class="meta-modal-body">
                        {#if metaFormType === 'why'}
                            <div class="meta-section-header">
                                <span class="meta-field-label">Why / Methodology Rationales ({metaWhyList.length})</span>
                                <button type="button" class="meta-add-item-btn" on:click={addNewWhyItem}>+ Add Why</button>
                            </div>
                            {#if metaWhyList.length === 0}
                                <div class="meta-empty-tip">No rationales yet. Click "+ Add Why" to add one.</div>
                            {:else}
                                <div class="meta-items-list">
                                    {#each metaWhyList as whyItem, i}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                                        <div class="meta-item-card" class:active={selectedWhyIndex === i}
                                             on:click={() => { selectedWhyIndex = i; void focusMetaEditorInput(); }}>
                                            <span class="item-badge">#{i + 1}</span>
                                            <span class="item-preview">{whyItem.trim() ? (whyItem.length > 32 ? whyItem.slice(0, 32) + '...' : whyItem) : '(Empty Rationale)'}</span>
                                            <span class="item-delete" title="Delete this rationale"
                                                  on:click|stopPropagation={() => removeWhyItem(i)}>✕</span>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                            {#if selectedWhyIndex >= 0 && selectedWhyIndex < metaWhyList.length}
                                <div class="meta-item-editor">
                                    <div class="meta-editor-title">Editing Rationale #{selectedWhyIndex + 1}</div>
                                    <textarea class="meta-form-textarea" placeholder="Core rationale or mental model behind this instruction..."
                                              bind:value={metaWhyList[selectedWhyIndex]} rows="3"
                                              on:pointerdown|stopPropagation
                                              on:mousedown|stopPropagation
                                              on:click|stopPropagation></textarea>
                                </div>
                            {/if}
                        {:else if metaFormType === 'note_link'}
                            <div class="meta-section-header">
                                <span class="meta-field-label">Linked Notes ({metaNoteLinks.length})</span>
                                <button type="button" class="meta-add-item-btn" on:click={addNewNoteLinkItem}>+ Add Note Link</button>
                            </div>
                            {#if metaNoteLinks.length === 0}
                                <div class="meta-empty-tip">No linked notes yet. Click "+ Add Note Link" to reference external notes.</div>
                            {:else}
                                <div class="meta-items-list">
                                    {#each metaNoteLinks as noteLinkItem, i}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                                        <div class="meta-item-card" class:active={selectedNoteLinkIndex === i}
                                             on:click={() => { selectedNoteLinkIndex = i; void focusMetaEditorInput(); }}>
                                            <span class="item-badge">#{i + 1}</span>
                                            <span class="item-preview">{noteLinkItem.trim() ? (noteLinkItem.length > 32 ? noteLinkItem.slice(0, 32) + '...' : noteLinkItem) : '(Empty Note Link)'}</span>
                                            <span class="item-delete" title="Delete this note link"
                                                  on:click|stopPropagation={() => removeNoteLinkItem(i)}>✕</span>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                            {#if selectedNoteLinkIndex >= 0 && selectedNoteLinkIndex < metaNoteLinks.length}
                                {@const activeNoteLink = metaNoteLinks[selectedNoteLinkIndex]}
                                {@const activeHintFile = (activeNoteLink && plugin?.app)
                                    ? LinkedNoteService.resolveLinkedNoteFile(plugin.app, activeNoteLink, categoryFilepath)
                                    : null}
                                <div class="meta-item-editor">
                                    <div class="meta-editor-title">Editing Note Link #{selectedNoteLinkIndex + 1}</div>
                                    <div class="meta-form-field">
                                        <span class="meta-field-label">Linked Obsidian / OneNote Note</span>
                                        <input class="meta-form-input" type="text" placeholder="e.g. [[My Note]] or OneNote/Domain/Section/Topic.md"
                                               bind:value={metaNoteLinks[selectedNoteLinkIndex]}
                                               on:pointerdown|stopPropagation
                                               on:mousedown|stopPropagation
                                               on:click|stopPropagation />
                                        <span class="meta-form-hint">
                                            {#if activeHintFile}
                                                <span style="color: var(--text-success, #48c774); font-weight: 500;">✓ Matched: {activeHintFile.path}</span>
                                            {:else if activeNoteLink && activeNoteLink.trim()}
                                                <span style="color: var(--text-muted);">Searching note across vault...</span>
                                            {:else}
                                                Hovering badge in main view will preview this note. Clicking will open it.
                                            {/if}
                                        </span>
                                        {#if activeNoteLink && plugin?.app}
                                            <button type="button" class="meta-btn-secondary" style="align-self: flex-start; margin-top: 4px; font-size: 11px; padding: 3px 8px;"
                                                    on:click={() => void handleTestOpenNote(activeNoteLink)}>
                                                🔗 Test Open Note
                                            </button>
                                        {/if}
                                    </div>
                                </div>
                            {/if}
                        {:else if metaFormType === 'svg'}
                            <div class="meta-section-header">
                                <span class="meta-field-label">Visual SVGs ({metaSvgList.length})</span>
                                <button type="button" class="meta-add-item-btn" on:click={addNewSvgItem}>+ Add SVG</button>
                            </div>
                            {#if metaSvgList.length === 0}
                                <div class="meta-empty-tip">No SVGs yet. Click "+ Add SVG" to add one.</div>
                            {:else}
                                <div class="meta-items-list">
                                    {#each metaSvgList as svgItem, i}
                                        {@const resolvedThumb = resolveSvgItem(svgItem)}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                                        <div class="meta-item-card" class:active={selectedSvgIndex === i}
                                             on:click={() => { selectedSvgIndex = i; void focusMetaEditorInput(); }}>
                                            <span class="item-badge">#{i + 1}</span>
                                            <div class="item-svg-mini-thumb">
                                                {#if resolvedThumb.isInline}
                                                    <div class="thumb-render">
                                                        {@html resolvedThumb.content}
                                                    </div>
                                                {:else if resolvedThumb.srcUrl}
                                                    <img src={resolvedThumb.srcUrl} alt="" class="item-svg-mini-thumb-img" />
                                                {:else}
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                                    </svg>
                                                {/if}
                                            </div>
                                            <span class="item-preview">{svgItem.trim() ? (svgItem.length > 32 ? svgItem.slice(0, 32) + '...' : svgItem) : '(Empty SVG)'}</span>
                                            <span class="item-delete" title="点击删除条目，长按 1.5 秒直接删除源文件至垃圾桶"
                                                  use:longPress={{
                                                      duration: 1500,
                                                      onLongPress: () => deleteSvgWithSourceFile(i),
                                                      onClick: () => removeSvgItem(i)
                                                  }}
                                                  on:keydown={(e) => e.key === "Enter" && removeSvgItem(i)}
                                                  role="button" tabindex="0">✕</span>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                            {#if selectedSvgIndex >= 0 && selectedSvgIndex < metaSvgList.length}
                                {@const activeResolved = resolveSvgItem(metaSvgList[selectedSvgIndex])}
                                <div class="meta-item-editor">
                                    <div class="meta-editor-title">Editing SVG #{selectedSvgIndex + 1}</div>
                                    <div class="meta-svg-editor-row">
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                                        <div class="meta-svg-preview-box"
                                             class:clickable={!activeResolved.isInline && !!activeResolved.cleanPath}
                                             title={!activeResolved.isInline && activeResolved.cleanPath ? `Click to open: ${activeResolved.cleanPath}` : "SVG 实时预览"}
                                             on:click={() => handleOpenSvgFile(activeResolved)}>
                                            {#if activeResolved.isInline}
                                                <div class="meta-svg-preview-render">
                                                    {@html activeResolved.content}
                                                </div>
                                            {:else if activeResolved.srcUrl}
                                                <img src={activeResolved.srcUrl} alt="SVG Preview" class="meta-svg-preview-img" />
                                            {:else}
                                                <div class="meta-svg-preview-empty">
                                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                                        <polyline points="21 15 16 10 5 21"/>
                                                    </svg>
                                                    <span>No preview</span>
                                                </div>
                                            {/if}
                                        </div>
                                        <div class="meta-svg-editor-inputs">
                                            <textarea class="meta-form-textarea monospace" placeholder="OneNote/Original Game/AI Draw/assets/name.svg or <svg...>...</svg>"
                                                      bind:value={metaSvgList[selectedSvgIndex]} rows="3"
                                                      on:pointerdown|stopPropagation
                                                      on:mousedown|stopPropagation
                                                      on:click|stopPropagation></textarea>
                                            <span class="meta-form-hint">Path to .svg asset in vault, or raw &lt;svg&gt; XML markup.</span>
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        {:else if metaFormType === 'custom'}
                            <div class="meta-section-header">
                                <span class="meta-field-label">Custom Properties ({metaCustomEntries.length})</span>
                                <button type="button" class="meta-add-item-btn" on:click={addNewCustomEntry}>+ Add Property</button>
                            </div>
                            {#if metaCustomEntries.length === 0}
                                <div class="meta-empty-tip">No custom properties yet. Click "+ Add Property" to add one.</div>
                            {:else}
                                <div class="meta-items-list">
                                    {#each metaCustomEntries as entry, i}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                                        <div class="meta-item-card" class:active={selectedCustomIndex === i}
                                             on:click={() => { selectedCustomIndex = i; void focusMetaEditorInput(); }}>
                                            <span class="item-badge custom-badge">{entry.key.trim() || 'Key'}</span>
                                            <span class="item-preview">{entry.value.trim() || '(Empty value)'}</span>
                                            <span class="item-delete" title="Delete this property"
                                                  on:click|stopPropagation={() => removeCustomEntry(i)}>✕</span>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                            {#if selectedCustomIndex >= 0 && selectedCustomIndex < metaCustomEntries.length}
                                <div class="meta-item-editor">
                                    <div class="meta-editor-title">Editing Property #{selectedCustomIndex + 1}</div>
                                    <div class="meta-custom-edit-grid">
                                        <div class="meta-form-field">
                                            <span class="meta-field-label">Key</span>
                                            <input class="meta-form-input" type="text" placeholder="e.g. priority, author"
                                                   bind:value={metaCustomEntries[selectedCustomIndex].key}
                                                   on:pointerdown|stopPropagation
                                                   on:mousedown|stopPropagation
                                                   on:click|stopPropagation />
                                        </div>
                                        <div class="meta-form-field">
                                            <span class="meta-field-label">Value</span>
                                            <input class="meta-form-input" type="text" placeholder="e.g. high, Opus"
                                                   bind:value={metaCustomEntries[selectedCustomIndex].value}
                                                   on:pointerdown|stopPropagation
                                                   on:mousedown|stopPropagation
                                                   on:click|stopPropagation />
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        {/if}
                    </div>

                    <div class="meta-modal-footer">
                        <button type="button" class="meta-btn-secondary" on:click={requestCloseAddMetaModal}>Cancel</button>
                        <button type="button" class="meta-btn-primary" on:click={saveMetadata}>Save Metadata</button>
                    </div>
                </div>
            </div>
        {/if}

        <!-- Save Confirmation Modal on Closing Metadata with Unsaved Changes ("是否保存？") -->
        {#if showMetaSaveConfirmModal}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div use:portal class="svg-confirm-backdrop" on:click|self={cancelMetaSavePrompt} role="presentation">
                <div class="svg-confirm-modal" role="dialog" aria-modal="true" tabindex="-1">
                    <div class="svg-confirm-title">{t("confirm_save_title")}</div>
                    <div class="svg-confirm-desc">
                        {t("confirm_save_meta_desc")}
                    </div>
                    <div class="svg-confirm-actions">
                        <button type="button" class="svg-btn svg-btn-primary" on:click={saveAndCloseMetaModal}>
                            {t("confirm_save_btn")}
                        </button>
                        <button type="button" class="svg-btn svg-btn-warning" on:click={discardAndCloseMetaModal}>
                            {t("confirm_dont_save_btn")}
                        </button>
                        <button type="button" class="svg-btn svg-btn-ghost" on:click={cancelMetaSavePrompt}>
                            {t("confirm_keep_editing_btn")}
                        </button>
                    </div>
                </div>
            </div>
        {/if}
    {:else}
        <div class="detail-empty">
            {#if isModal}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="detail-empty-modal-header">
                    <span class="detail-modal-fullscreen-btn"
                          on:click={toggleFullscreen}
                          role="button" tabindex="0"
                          title={isFullscreen ? (t("restore_window") || "Restore window / 还原窗口") : (t("fullscreen_window") || "Full screen / 全屏放大")}
                          on:keydown={(e) => e.key === "Enter" && toggleFullscreen()}>
                        {#if isFullscreen}
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="4 14 10 14 10 20"/>
                                <polyline points="20 10 14 10 14 4"/>
                                <line x1="14" y1="10" x2="21" y2="3"/>
                                <line x1="3" y1="21" x2="10" y2="14"/>
                            </svg>
                        {:else}
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="15 3 21 3 21 9"/>
                                <polyline points="9 21 3 21 3 15"/>
                                <line x1="21" y1="3" x2="14" y2="10"/>
                                <line x1="3" y1="21" x2="10" y2="14"/>
                            </svg>
                        {/if}
                    </span>
                    <span class="detail-modal-close-btn"
                          on:click={closePanel}
                          role="button" tabindex="0"
                          title="Close (Esc)"
                          on:keydown={(e) => e.key === "Enter" && closePanel()}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </span>
                </div>
            {/if}
            <span>Click a task to view details.</span>
        </div>
    {/if}
</div>

<style>
    .step-content-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 4px;
    }

    .add-step-card {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .title-right-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        margin-left: auto;
    }

    .step-left-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }
</style>
