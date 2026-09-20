<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { dndzone } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import type { TaskItem, TaskStep } from "../types";
    import { EventName } from "../types";
    import { EventBus } from "../EventBus";
    import { autosize } from "../utils/domUtils";
    import type { DataService } from "../DataService";
    import { ensureStepIds, persistableSteps, reconcileDndSteps } from "../utils/stepIds";
    import { Logger } from "../Logger";

    // =============================================
    // Props
    // =============================================
    export let task: TaskItem;
    export let categoryFilepath: string;
    export let dataService: DataService;
    export let closeModal: () => void = () => {};

    // =============================================
    // Local State
    // =============================================
    let steps: TaskStep[] = task.steps ? ensureStepIds(task.id, task.steps) : [];
    let newStepText: string = "";
    let addInputEl: HTMLTextAreaElement;
    let modalBodyEl: HTMLElement;
    let saveTimeout: any = null;
    let isDraggingSteps: boolean = false;
    let preDndSteps: TaskStep[] = [];
    const SAVE_DEBOUNCE_MS = 400;
    const DND_FLIP_DURATION = 150;

    $: completedCount = steps.filter(s => s.done).length;
    $: totalCount = steps.length;
    $: progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // =============================================
    // Persistence
    // =============================================
    async function persistTask() {
        if (saveTimeout) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
        }
        if (!task || !categoryFilepath || isDraggingSteps) return;
        task.steps = persistableSteps(steps);
        await dataService.updateTask(categoryFilepath, task);
        EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath });
    }

    function scheduleSave() {
        if (isDraggingSteps) {
            void Logger.log(`[DND Modal] scheduleSave suppressed during active drag`);
            return;
        }
        if (saveTimeout) window.clearTimeout(saveTimeout);
        saveTimeout = window.setTimeout(async () => {
            await persistTask();
        }, SAVE_DEBOUNCE_MS);
    }

    export function flushSaveSync() {
        if (saveTimeout) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
            task.steps = persistableSteps(steps);
            void dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath });
        }
    }

    // =============================================
    // Step Actions & Drag-and-Drop
    // =============================================
    async function toggleStep(stepId?: string) {
        if (!stepId) return;
        const step = steps.find(s => s.id === stepId);
        if (!step) return;
        step.done = !step.done;
        steps = [...steps];
        await persistTask();
    }

    function handleStepInput(stepId: string | undefined, newText: string) {
        if (!stepId) return;
        const step = steps.find(s => s.id === stepId);
        if (!step) return;
        step.text = newText;
        scheduleSave();
    }

    async function deleteStep(stepId?: string) {
        if (!stepId || !task) return;
        const index = steps.findIndex(s => s.id === stepId);
        if (index === -1) return;
        const deletedStep = { ...steps[index] };
        steps = steps.filter(s => s.id !== stepId);
        void Logger.log(`[DND Modal] Deleted step: taskId=${task.id}, stepId=${stepId}, text="${deletedStep.text}", remaining=${steps.length}`);
        console.log(`[FluentTasks Modal] Deleted step: taskId=${task.id}, stepId=${stepId}, remaining=${steps.length}`);
        await persistTask();
        EventBus.emit(EventName.STEP_DELETED, {
            taskId: task.id,
            categoryFilepath,
            step: deletedStep,
            index,
        });
    }

    function handleDndConsider(e: CustomEvent<{ items: TaskStep[]; info: any }>) {
        if (!task) return;
        const trigger = e.detail.info?.trigger || "unknown";
        const incoming = e.detail.items || [];

        if (!isDraggingSteps) {
            isDraggingSteps = true;
            preDndSteps = steps ? steps.map(s => ({ ...s })) : [];
            if (saveTimeout) {
                window.clearTimeout(saveTimeout);
                saveTimeout = null;
            }
            void Logger.log(`[DND Modal] Drag started: taskId="${task.id}", preCount=${preDndSteps.length}, trigger=${trigger}`, {
                stepIds: preDndSteps.map(s => s.id)
            });
            console.log(`[FluentTasks DND Modal] Drag started: taskId=${task.id}, count=${preDndSteps.length}, trigger=${trigger}`);
        }

        void Logger.log(`[DND Modal] Consider: trigger=${trigger}, incomingCount=${incoming.length}`);
        steps = incoming;
    }

    async function handleDndFinalize(e: CustomEvent<{ items: TaskStep[]; info: any }>) {
        if (!task) return;
        const trigger = e.detail.info?.trigger || "unknown";
        const incoming = e.detail.items || [];

        void Logger.log(`[DND Modal] Finalize initiated: trigger=${trigger}, incomingCount=${incoming.length}, preCount=${preDndSteps.length}`);
        console.log(`[FluentTasks DND Modal] Finalize: trigger=${trigger}, incoming=${incoming.length}, preCount=${preDndSteps.length}`);

        const safeSteps = reconcileDndSteps(preDndSteps, incoming, trigger);
        steps = safeSteps;
        isDraggingSteps = false;
        preDndSteps = [];

        void Logger.log(`[DND Modal] Finalize completed: finalCount=${safeSteps.length}, stepIds=${safeSteps.map(s => s.id).join(",")}`);
        await persistTask();
    }

    async function addStep() {
        const trimmed = newStepText.trim();
        if (!trimmed) return;
        const newStep: TaskStep = {
            id: `${task.id}-step-${Date.now()}-${steps.length}`,
            text: trimmed,
            done: false
        };
        steps = [...steps, newStep];
        newStepText = "";
        void Logger.log(`[DND Modal] Added step: taskId=${task.id}, stepId=${newStep.id}, text="${newStep.text}", totalSteps=${steps.length}`);
        console.log(`[FluentTasks Modal] Added step: taskId=${task.id}, stepId=${newStep.id}, total=${steps.length}`);
        await persistTask();
        await tick();
        addInputEl?.focus();
        modalBodyEl?.scrollTo({ top: modalBodyEl.scrollHeight, behavior: 'smooth' });
    }

    function handleStepKeydown(e: KeyboardEvent, stepId?: string) {
        if (!stepId || e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
        }
    }

    function handleAddInputKeydown(e: KeyboardEvent) {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void addStep();
        }
    }

    function handleClose() {
        flushSaveSync();
        closeModal();
    }

    // External disk/AI sync listener
    async function handleExternalTaskUpdate(payload: any) {
        if (!task || !categoryFilepath || isDraggingSteps) return;
        if (!payload.categoryFilepath || payload.categoryFilepath === categoryFilepath) {
            if (payload.task && payload.task.id === task.id) {
                task = payload.task;
                steps = ensureStepIds(task.id, task.steps || []);
            } else if (payload.isExternal) {
                const tasks = await dataService.getTasks(categoryFilepath);
                const fresh = tasks.find(t => t.id === task.id);
                if (fresh) {
                    task = fresh;
                    steps = ensureStepIds(task.id, task.steps || []);
                }
            }
        }
    }

    onMount(() => {
        // Esc guard in capture phase to prevent conflicts with parent modal listeners
        const handleCaptureKeydown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                e.preventDefault();
                handleClose();
            }
        };

        window.addEventListener("keydown", handleCaptureKeydown, { capture: true });
        EventBus.on(EventName.TASK_UPDATED, handleExternalTaskUpdate);

        return () => {
            window.removeEventListener("keydown", handleCaptureKeydown, { capture: true });
            EventBus.off(EventName.TASK_UPDATED, handleExternalTaskUpdate);
            flushSaveSync();
        };
    });

    onDestroy(() => {
        flushSaveSync();
    });
</script>

<div class="task-steps-modal-container">
    <!-- Modal Header -->
    <div class="task-steps-modal-header">
        <div class="task-steps-modal-title-box">
            <svg class="task-steps-header-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            <div class="task-steps-modal-title" title={task.title}>{task.title}</div>
        </div>
        <div class="task-steps-modal-header-actions">
            <span class="task-steps-progress-pill">
                {completedCount}/{totalCount} {totalCount === 1 ? 'step' : 'steps'} completed
            </span>
        </div>
    </div>

    <!-- Progress Track -->
    {#if totalCount > 0}
        <div class="task-steps-progress-track">
            <div class="task-steps-progress-fill" style="width: {progressPercent}%;"></div>
        </div>
    {/if}

    <!-- Modal Scrollable Body -->
    <div class="task-steps-modal-body" bind:this={modalBodyEl}>
        {#if steps.length === 0}
            <div class="task-steps-empty-state">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--todo-text-muted)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 11 12 14 22 4"/>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
                <p>No subtasks yet. Add one below to break down this task.</p>
            </div>
        {:else}
            <div
                class="task-steps-list"
                use:dndzone={{
                    items: steps,
                    flipDurationMs: DND_FLIP_DURATION,
                    dropAnimationDisabled: true,
                    dropTargetStyle: {},
                    type: 'task-step-' + task.id
                }}
                on:consider={handleDndConsider}
                on:finalize={handleDndFinalize}
            >
                {#each steps as step (step.id)}
                    <div
                        class="steps-modal-item"
                        class:is-done={step.done}
                        animate:flip={{ duration: DND_FLIP_DURATION }}
                    >
                        <!-- Drag handle -->
                        <span class="steps-modal-drag-handle" title="Drag to reorder">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="9" cy="5" r="1.8" />
                                <circle cx="15" cy="5" r="1.8" />
                                <circle cx="9" cy="12" r="1.8" />
                                <circle cx="15" cy="12" r="1.8" />
                                <circle cx="9" cy="19" r="1.8" />
                                <circle cx="15" cy="19" r="1.8" />
                            </svg>
                        </span>

                        <!-- Checkbox -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <span
                            class="steps-modal-checkbox"
                            class:checked={step.done}
                            role="checkbox"
                            aria-checked={step.done}
                            tabindex="0"
                            on:click|stopPropagation={() => toggleStep(step.id)}
                            on:keydown|stopPropagation={(e) => (e.key === "Enter" || e.key === " ") && toggleStep(step.id)}
                            aria-label={step.done ? "Mark step incomplete" : "Mark step complete"}
                        >
                            {#if step.done}
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="8 12 11 15 16 9" />
                                </svg>
                            {:else}
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                    <circle cx="12" cy="12" r="10" />
                                </svg>
                            {/if}
                        </span>

                        <!-- Multi-line auto-resizing textarea with large font -->
                        <textarea
                            use:autosize={step.text}
                            rows="1"
                            class="steps-modal-textarea"
                            class:completed={step.done}
                            value={step.text}
                            placeholder="Step description..."
                            on:input={(e) => handleStepInput(step.id, e.currentTarget.value)}
                            on:blur={flushSaveSync}
                            on:keydown={(e) => handleStepKeydown(e, step.id)}
                        />

                        <!-- Delete step button -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <span
                            class="steps-modal-delete-btn"
                            role="button"
                            tabindex="0"
                            on:click|stopPropagation={() => deleteStep(step.id)}
                            on:keydown|stopPropagation={(e) => e.key === "Enter" && deleteStep(step.id)}
                            title="Delete step"
                            aria-label="Delete step"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </span>
                    </div>
                {/each}
            </div>
        {/if}

        <!-- Add Step Row -->
        <div class="steps-modal-add-row">
            <span class="steps-modal-add-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </span>
            <textarea
                use:autosize={newStepText}
                rows="1"
                class="steps-modal-add-input"
                placeholder="Add a step... (Press Enter to add, Shift+Enter for newline)"
                bind:value={newStepText}
                bind:this={addInputEl}
                on:keydown={handleAddInputKeydown}
            />
            <button
                type="button"
                class="steps-modal-add-btn"
                disabled={!newStepText.trim()}
                on:click={addStep}
            >
                Add
            </button>
        </div>
    </div>
</div>
