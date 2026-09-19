<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { Notice } from "obsidian";
    import type { TaskItem, StepDeletedPayload, CategoryDeletedPayload } from "./types";
    import { EventName } from "./types";
    import { EventBus } from "./EventBus";
    import type { DataService } from "./DataService";
    import type FluentTasksPlugin from "./main";

    export let plugin: FluentTasksPlugin;
    export let dataService: DataService;

    interface UndoToastItem {
        id: string;
        type: "task" | "step" | "category";
        categoryFilepath: string;
        tasks?: TaskItem[];
        stepPayload?: StepDeletedPayload;
        categoryPayload?: CategoryDeletedPayload;
        message: string;
        timer: any;
        isBatch?: boolean;
        durationSec: number;
        expiresAt: number;
        remainingMs?: number;
    }

    let undoToasts: UndoToastItem[] = [];

    function getUndoDurationSec(): number {
        const configured = plugin?.settings?.undoDurationSeconds;
        if (typeof configured === "number" && !isNaN(configured) && configured > 0) {
            return configured;
        }
        return 2.5;
    }

    function dismissToast(id: string) {
        const target = undoToasts.find(t => t.id === id);
        if (target?.timer) {
            clearTimeout(target.timer);
        }
        undoToasts = undoToasts.filter(t => t.id !== id);
    }

    function pauseToastTimer(toast: UndoToastItem) {
        if (toast.timer) {
            clearTimeout(toast.timer);
            toast.timer = null;
            toast.remainingMs = Math.max(500, toast.expiresAt - Date.now());
        }
    }

    function resumeToastTimer(toast: UndoToastItem) {
        if (!toast.timer) {
            const delay = toast.remainingMs || (toast.durationSec * 1000);
            toast.expiresAt = Date.now() + delay;
            toast.timer = setTimeout(() => {
                dismissToast(toast.id);
            }, delay);
        }
    }

    function pushTaskUndoToast(categoryFilepath: string, tasks: TaskItem[], isBatch: boolean = false) {
        if (!tasks || tasks.length === 0) return;
        const id = "toast_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        const count = tasks.length;

        let message = "";
        if (isBatch || count > 1) {
            message = `Deleted ${count} tasks`;
        } else {
            const rawTitle = tasks[0].title ? tasks[0].title.trim() : "Untitled";
            const truncated = rawTitle.length > 26 ? rawTitle.slice(0, 24) + "..." : rawTitle;
            message = `Deleted "${truncated}"`;
        }

        const durationSec = getUndoDurationSec();
        const durationMs = durationSec * 1000;

        const timer = setTimeout(() => {
            dismissToast(id);
        }, durationMs);

        const toast: UndoToastItem = {
            id,
            type: "task",
            categoryFilepath,
            tasks,
            message,
            timer,
            isBatch: isBatch || count > 1,
            durationSec,
            expiresAt: Date.now() + durationMs,
        };

        undoToasts = [...undoToasts, toast];
    }

    function pushStepUndoToast(payload: StepDeletedPayload) {
        if (!payload || !payload.step) return;
        const id = "toast_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        const rawText = payload.step.text ? payload.step.text.trim() : "Untitled";
        const truncated = rawText.length > 26 ? rawText.slice(0, 24) + "..." : rawText;
        const message = `Deleted step "${truncated}"`;

        const durationSec = getUndoDurationSec();
        const durationMs = durationSec * 1000;

        const timer = setTimeout(() => {
            dismissToast(id);
        }, durationMs);

        const toast: UndoToastItem = {
            id,
            type: "step",
            categoryFilepath: payload.categoryFilepath,
            stepPayload: payload,
            message,
            timer,
            durationSec,
            expiresAt: Date.now() + durationMs,
        };

        undoToasts = [...undoToasts, toast];
    }

    function pushCategoryUndoToast(payload: CategoryDeletedPayload) {
        if (!payload || !payload.categoryName) return;
        const id = "toast_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        const rawName = payload.categoryName.trim();
        const truncated = rawName.length > 26 ? rawName.slice(0, 24) + "..." : rawName;
        const message = `Deleted list "${truncated}"`;

        const durationSec = getUndoDurationSec();
        const durationMs = durationSec * 1000;

        const timer = setTimeout(() => {
            dismissToast(id);
        }, durationMs);

        const toast: UndoToastItem = {
            id,
            type: "category",
            categoryFilepath: payload.categoryFilepath,
            categoryPayload: payload,
            message,
            timer,
            durationSec,
            expiresAt: Date.now() + durationMs,
        };

        undoToasts = [...undoToasts, toast];
    }

    async function executeUndo(toast: UndoToastItem) {
        dismissToast(toast.id);

        if (toast.type === "category" && toast.categoryPayload) {
            const { categoryName, categoryFilepath, fileContent, groupName, index } = toast.categoryPayload;
            try {
                await dataService.restoreCategory(categoryName, categoryFilepath, fileContent, groupName, index);
                const rawName = categoryName.trim();
                const truncated = rawName.length > 26 ? rawName.slice(0, 24) + "..." : rawName;
                new Notice(`Restored list: "${truncated}"`);
            } catch (err) {
                console.error("Failed to restore list:", err);
                new Notice("Failed to undo list deletion.");
            }
            return;
        }

        if (toast.type === "step" && toast.stepPayload) {
            const { taskId, categoryFilepath, step, index } = toast.stepPayload;
            try {
                const currentTasks = await dataService.getTasks(categoryFilepath);
                const targetTask = currentTasks.find(t => t.id === taskId);
                if (!targetTask) return;

                const existingSteps = targetTask.steps ? [...targetTask.steps] : [];
                if (existingSteps.some(s => s.id === step.id)) return;

                const insertIndex = Math.min(Math.max(0, index), existingSteps.length);
                existingSteps.splice(insertIndex, 0, step);
                targetTask.steps = existingSteps;

                await dataService.updateTask(categoryFilepath, targetTask);

                EventBus.emit(EventName.TASK_UPDATED, {
                    task: targetTask,
                    categoryFilepath,
                    isExternal: true,
                });

                const rawText = step.text ? step.text.trim() : "Untitled";
                const truncated = rawText.length > 26 ? rawText.slice(0, 24) + "..." : rawText;
                new Notice(`Restored step: "${truncated}"`);
            } catch (err) {
                console.error("Failed to restore step:", err);
                new Notice("Failed to undo step deletion.");
            }
            return;
        }

        if (toast.type === "task" && toast.tasks) {
            const tasksToRestore = toast.tasks;
            if (!tasksToRestore || tasksToRestore.length === 0) return;

            try {
                const currentTasks = await dataService.getTasks(toast.categoryFilepath);
                const existingIds = new Set(currentTasks.map(t => t.id));
                const newRestores = tasksToRestore.filter(t => !existingIds.has(t.id));
                if (newRestores.length === 0) return;

                const mergedTasks = [...newRestores, ...currentTasks];
                await dataService.saveTasks(toast.categoryFilepath, mergedTasks);

                EventBus.emit(EventName.TASK_UPDATED, {
                    categoryFilepath: toast.categoryFilepath,
                    isExternal: true
                });

                new Notice(
                    newRestores.length === 1 
                        ? `Restored: "${newRestores[0].title}"` 
                        : `Restored ${newRestores.length} tasks`
                );
            } catch (err) {
                console.error("Failed to restore task(s):", err);
                new Notice("Failed to undo task deletion.");
            }
        }
    }

    function handleTaskDeleted(payload: any) {
        if (!payload || !payload.categoryFilepath) return;
        if (payload.tasks && Array.isArray(payload.tasks)) {
            pushTaskUndoToast(payload.categoryFilepath, payload.tasks, true);
        } else if (payload.task && !payload.isBatch) {
            pushTaskUndoToast(payload.categoryFilepath, [payload.task], false);
        }
    }

    function handleStepDeleted(payload: StepDeletedPayload) {
        if (!payload || !payload.step) return;
        pushStepUndoToast(payload);
    }

    function handleCategoryDeleted(payload: CategoryDeletedPayload) {
        if (!payload || !payload.categoryName) return;
        pushCategoryUndoToast(payload);
    }

    onMount(() => {
        EventBus.on(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.on(EventName.STEP_DELETED, handleStepDeleted);
        EventBus.on(EventName.CATEGORY_DELETED, handleCategoryDeleted);
    });

    onDestroy(() => {
        EventBus.off(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.off(EventName.STEP_DELETED, handleStepDeleted);
        EventBus.off(EventName.CATEGORY_DELETED, handleCategoryDeleted);
        undoToasts.forEach(t => {
            if (t.timer) clearTimeout(t.timer);
        });
        undoToasts = [];
    });
</script>

{#if undoToasts.length > 0}
    <div class="fluent-tasks-undo-container">
        {#each undoToasts as toast (toast.id)}
            <div class="fluent-tasks-undo-toast" 
                 style="--undo-duration: {toast.durationSec}s;"
                 on:mouseenter={() => pauseToastTimer(toast)}
                 on:mouseleave={() => resumeToastTimer(toast)}>
                <div class="undo-toast-body">
                    <span class="undo-toast-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </span>
                    <span class="undo-toast-message" title={toast.message}>{toast.message}</span>
                    <button type="button" class="undo-toast-btn" on:click={() => executeUndo(toast)}>
                        Undo
                    </button>
                    <button type="button" class="undo-toast-close" on:click={() => dismissToast(toast.id)} title="Dismiss">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="undo-toast-progress-track">
                    <div class="undo-toast-progress-bar" style="animation-duration: {toast.durationSec}s;"></div>
                </div>
            </div>
        {/each}
    </div>
{/if}
