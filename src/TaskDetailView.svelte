<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, type TaskItem, type TaskStep } from "./types";
    import { SAVE_DEBOUNCE_MS } from "./constants";
    import type { App } from "obsidian";

    // =============================================
    // Props
    // =============================================
    export let dataService: DataService;

    // =============================================
    // State
    // =============================================
    let task: TaskItem | null = null;
    let categoryFilepath: string = "";
    let newStepText: string = "";

    // Debounce timer for auto-saving on input changes
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    // =============================================
    // Lifecycle
    // =============================================
    onMount(() => {
        EventBus.on(EventName.TASK_SELECTED, handleTaskSelected);
        EventBus.on(EventName.DETAIL_CLOSE, handleClose);
        EventBus.on(EventName.TASK_DELETED, handleTaskDeleted);
    });

    onDestroy(() => {
        EventBus.off(EventName.TASK_SELECTED, handleTaskSelected);
        EventBus.off(EventName.DETAIL_CLOSE, handleClose);
        EventBus.off(EventName.TASK_DELETED, handleTaskDeleted);
        if (saveTimeout) clearTimeout(saveTimeout);
    });

    // Called from main.ts when the view is opened directly
    export function loadTask(t: TaskItem, filepath: string) {
        task = { ...t, steps: t.steps.map(s => ({ ...s })) };
        categoryFilepath = filepath;
    }

    // =============================================
    // EventBus Handlers
    // =============================================
    function handleTaskSelected(payload: any) {
        loadTask(payload.task, payload.categoryFilepath);
    }

    function handleClose() {
        task = null;
        categoryFilepath = "";
    }

    function handleTaskDeleted(payload: any) {
        if (task && payload.task.id === task.id) {
            handleClose();
        }
    }

    // =============================================
    // Auto-Save (Debounced)
    // =============================================
    function scheduleSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            if (!task || !categoryFilepath) return;
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
    function handleTitleInput() {
        scheduleSave();
    }

    async function toggleComplete() {
        if (!task) return;
        task.completed = !task.completed;
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
        if (!task || !categoryFilepath) return;
        await dataService.updateTask(categoryFilepath, task);
        EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath });
    }

    // =============================================
    // Step Actions
    // =============================================
    function addStep() {
        const text = newStepText.trim();
        if (!text || !task) return;
        task.steps = [...task.steps, { text, done: false }];
        newStepText = "";
        task = task;
        scheduleSave();
    }

    function handleStepKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            addStep();
        }
    }

    function toggleStepDone(index: number) {
        if (!task) return;
        task.steps[index].done = !task.steps[index].done;
        task.steps = [...task.steps]; // trigger reactivity
        task = task;
        scheduleSave();
    }

    function updateStepText(index: number, newText: string) {
        if (!task) return;
        task.steps[index].text = newText;
        scheduleSave();
    }

    function deleteStep(index: number) {
        if (!task) return;
        task.steps.splice(index, 1);
        task.steps = [...task.steps];
        task = task;
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
        task = null;
        categoryFilepath = "";
        EventBus.emit(EventName.DETAIL_CLOSE, {});
    }

    async function deleteTask() {
        if (!task || !categoryFilepath) return;
        const toDelete = task;
        const path = categoryFilepath;
        task = null;
        categoryFilepath = "";
        await dataService.deleteTask(path, toDelete);
        EventBus.emit(EventName.TASK_DELETED, {
            task: toDelete,
            categoryFilepath: path,
        });
    }

    // =============================================
    // Helpers
    // =============================================
    function formatDate(iso: string): string {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString("en-US", {
                weekday: "short",
                year: "numeric",
                month: "long",
                day: "numeric",
            });
        } catch {
            return iso;
        }
    }
</script>

<div class="detail-container">
    {#if task}
        <!-- Header: Checkbox + Title + Star -->
        <div class="detail-header">
            <div class="title-row">
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

                <!-- Title input -->
                <input
                    class="detail-title-input"
                    type="text"
                    bind:value={task.title}
                    on:input={handleTitleInput}
                    placeholder="Task title"
                />

                <!-- Star -->
                <span class="star" class:active={task.starred}
                      on:click={toggleStar} role="button" tabindex="0"
                      on:keydown={(e) => e.key === "Enter" && toggleStar()}>
                    <svg width="20" height="20" viewBox="0 0 24 24"
                         fill={task.starred ? "currentColor" : "none"}
                         stroke="currentColor" stroke-width="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                </span>
            </div>

            <!-- Steps -->
            <div class="steps-container">
                {#each task.steps as step, i (i)}
                    <div class="step-item">
                        <span class="checkbox" on:click={() => toggleStepDone(i)}
                              role="checkbox" aria-checked={step.done} tabindex="0"
                              on:keydown={(e) => e.key === "Enter" && toggleStepDone(i)}>
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
                        <input
                            type="text"
                            value={step.text}
                            class:completed={step.done}
                            on:input={(e) => updateStepText(i, e.currentTarget.value)}
                        />
                        <span class="delete-step" on:click={() => deleteStep(i)}
                              role="button" tabindex="0"
                              on:keydown={(e) => e.key === "Enter" && deleteStep(i)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </span>
                    </div>
                {/each}

                <!-- Add step row -->
                <div class="add-step-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <input
                        class="add-step-input"
                        type="text"
                        placeholder="Add step"
                        bind:value={newStepText}
                        on:keydown={handleStepKeydown}
                    />
                </div>
            </div>
        </div>

        <!-- Note -->
        <div class="note-section">
            <textarea
                class="note-textarea"
                placeholder="Add note"
                bind:value={task.note}
                on:input={handleNoteInput}
            ></textarea>
        </div>

        <!-- Footer: Collapse | Created date | Delete -->
        <div class="detail-footer">
            <!-- Collapse (hide panel) -->
            <span class="footer-btn" on:click={closePanel}
                  role="button" tabindex="0" title="Hide detail panel"
                  on:keydown={(e) => e.key === "Enter" && closePanel()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="3" width="20" height="18" rx="2"/>
                    <line x1="15" y1="3" x2="15" y2="21"/>
                    <polyline points="11 9 8 12 11 15"/>
                </svg>
            </span>

            <!-- Created date -->
            <span class="created-info">
                Created on {formatDate(task.createdAt)}
            </span>

            <!-- Delete -->
            <span class="footer-btn danger" on:click={deleteTask}
                  role="button" tabindex="0" title="Delete task"
                  on:keydown={(e) => e.key === "Enter" && deleteTask()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </span>
        </div>
    {:else}
        <div class="detail-empty">
            Click a task to view details.
        </div>
    {/if}
</div>
