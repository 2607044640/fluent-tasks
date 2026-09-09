<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import type { TaskItem } from "../types";
    import { EventName } from "../types";
    import { EventBus } from "../EventBus";
    import { autosize } from "../utils/domUtils";
    import type { DataService } from "../DataService";

    // =============================================
    // Props
    // =============================================
    export let task: TaskItem;
    export let categoryFilepath: string;
    export let dataService: DataService;
    export const plugin: any = null;
    export let closeModal: () => void = () => {};

    // =============================================
    // Local State
    // =============================================
    let steps: { text: string; done: boolean }[] = task.steps ? task.steps.map(s => ({ ...s })) : [];
    let newStepText: string = "";
    let addInputEl: HTMLTextAreaElement;
    let saveTimeout: any = null;
    const SAVE_DEBOUNCE_MS = 400;

    $: completedCount = steps.filter(s => s.done).length;
    $: totalCount = steps.length;
    $: progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // =============================================
    // Persistence
    // =============================================
    async function persistTask() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
        }
        if (!task || !categoryFilepath) return;
        task.steps = steps.map(s => ({ ...s }));
        await dataService.updateTask(categoryFilepath, task);
        EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath });
    }

    function scheduleSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            await persistTask();
        }, SAVE_DEBOUNCE_MS);
    }

    export function flushSaveSync() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
            saveTimeout = null;
            task.steps = steps.map(s => ({ ...s }));
            void dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath });
        }
    }

    // =============================================
    // Step Actions
    // =============================================
    async function toggleStep(index: number) {
        if (index < 0 || index >= steps.length) return;
        steps[index].done = !steps[index].done;
        steps = [...steps];
        await persistTask();
    }

    function handleStepInput(index: number, newText: string) {
        if (index < 0 || index >= steps.length) return;
        steps[index].text = newText;
        scheduleSave();
    }

    async function deleteStep(index: number) {
        if (index < 0 || index >= steps.length) return;
        steps.splice(index, 1);
        steps = [...steps];
        await persistTask();
    }

    async function addStep() {
        const trimmed = newStepText.trim();
        if (!trimmed) return;
        steps = [...steps, { text: trimmed, done: false }];
        newStepText = "";
        await persistTask();
        await tick();
        addInputEl?.focus();
    }

    function handleStepKeydown(e: KeyboardEvent, index: number) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
        }
    }

    function handleAddInputKeydown(e: KeyboardEvent) {
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
    function handleExternalTaskUpdate(payload: any) {
        if (!task || !categoryFilepath) return;
        if (payload.categoryFilepath === categoryFilepath && payload.isExternal) {
            if (payload.task && payload.task.id === task.id) {
                task = payload.task;
                steps = task.steps ? task.steps.map((s: any) => ({ ...s })) : [];
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
            <button
                type="button"
                class="task-steps-modal-close-btn"
                on:click={handleClose}
                title="Close (Esc)"
                aria-label="Close"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>
    </div>

    <!-- Progress Track -->
    {#if totalCount > 0}
        <div class="task-steps-progress-track">
            <div class="task-steps-progress-fill" style="width: {progressPercent}%;"></div>
        </div>
    {/if}

    <!-- Modal Scrollable Body -->
    <div class="task-steps-modal-body">
        {#if steps.length === 0}
            <div class="task-steps-empty-state">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--todo-text-muted)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 11 12 14 22 4"/>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
                <p>No subtasks yet. Add one below to break down this task.</p>
            </div>
        {:else}
            <div class="task-steps-list">
                {#each steps as step, i (i)}
                    <div class="steps-modal-item" class:is-done={step.done}>
                        <!-- Checkbox -->
                        <button
                            type="button"
                            class="steps-modal-checkbox"
                            class:checked={step.done}
                            on:click={() => toggleStep(i)}
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
                        </button>

                        <!-- Multi-line auto-resizing textarea with large font -->
                        <textarea
                            use:autosize={step.text}
                            rows="1"
                            class="steps-modal-textarea"
                            class:completed={step.done}
                            value={step.text}
                            placeholder="Step description..."
                            on:input={(e) => handleStepInput(i, e.currentTarget.value)}
                            on:blur={flushSaveSync}
                            on:keydown={(e) => handleStepKeydown(e, i)}
                        />

                        <!-- Delete step button -->
                        <button
                            type="button"
                            class="steps-modal-delete-btn"
                            on:click={() => deleteStep(i)}
                            title="Delete step"
                            aria-label="Delete step"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
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
