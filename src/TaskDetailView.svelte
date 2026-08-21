<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, type TaskItem, type TaskStep, type RecurrenceRule } from "./types";
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
    let showScheduleSection: boolean = false;
    let showRepeatPicker: boolean = false;

    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
                task.recurrence = { type: 'weekly', interval: 1, daysOfWeek: [new Date(task.dueDate + "T00:00:00").getDay()] };
                break;
        }
        showRepeatPicker = false;
        scheduleSave();
    }

    function clearDueDate() {
        if (!task) return;
        task.dueDate = undefined;
        task.recurrence = undefined;
        showRepeatPicker = false;
        scheduleSave();
    }

    function clearRecurrence() {
        if (!task) return;
        task.recurrence = undefined;
        showRepeatPicker = false;
        scheduleSave();
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
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    // =============================================
    // Lifecycle
    // =============================================
    onMount(() => {
        EventBus.on(EventName.TASK_SELECTED, handleTaskSelected);
        EventBus.on(EventName.DETAIL_CLOSE, handleClose);
        EventBus.on(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.on(EventName.TASK_UPDATED, handleExternalTaskUpdate);
    });

    onDestroy(() => {
        EventBus.off(EventName.TASK_SELECTED, handleTaskSelected);
        EventBus.off(EventName.DETAIL_CLOSE, handleClose);
        EventBus.off(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.off(EventName.TASK_UPDATED, handleExternalTaskUpdate);
        if (saveTimeout) clearTimeout(saveTimeout);
    });

    // Called from main.ts when the view is opened directly
    export function loadTask(t: TaskItem, filepath: string) {
        task = { ...t, steps: t.steps.map(s => ({ ...s })) };
        categoryFilepath = filepath;
        showScheduleSection = false;
        showRepeatPicker = false;
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
        showScheduleSection = false;
        showRepeatPicker = false;
    }

    function handleTaskDeleted(payload: any) {
        if (task && payload.task.id === task.id) {
            handleClose();
        }
    }

    function handleExternalTaskUpdate(payload: any) {
        if (task && payload.task && payload.task.id === task.id) {
            task = { ...payload.task, steps: payload.task.steps.map((s: any) => ({ ...s })) };
            categoryFilepath = payload.categoryFilepath || categoryFilepath;
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

        <!-- Why Metadata -->
        <div class="detail-section meta-section">
            <div class="section-label meta-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                Why (Rationale)
            </div>
            <textarea
                class="meta-why-input"
                placeholder="Why does this task exist? What is the core reasoning?"
                bind:value={task.why}
                on:input={scheduleSave}
                rows="2"
            ></textarea>
        </div>

        <!-- SVG Icons Metadata -->
        <div class="detail-section meta-section">
            <div class="section-label meta-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                </svg>
                SVG Icons
            </div>
            {#if task.svgs && task.svgs.length > 0}
                <div class="meta-svg-list">
                    {#each task.svgs as svgContent, i}
                        <div class="meta-svg-item">
                            <div class="meta-svg-preview">
                                {#if svgContent}
                                    {@html svgContent}
                                {/if}
                            </div>
                            <input
                                class="meta-svg-code-input"
                                type="text"
                                value={svgContent}
                                placeholder="<svg ...>...</svg>"
                                on:input={(e) => {
                                    if (task) {
                                        if (!task.svgs) task.svgs = [];
                                        task.svgs[i] = e.currentTarget.value;
                                        task.svgs = [...task.svgs];
                                        scheduleSave();
                                    }
                                }}
                            />
                            <span class="meta-svg-remove"
                                  on:click={() => {
                                      if (task && task.svgs) {
                                          task.svgs = task.svgs.filter((_, idx) => idx !== i);
                                          scheduleSave();
                                      }
                                  }}
                                  on:keydown={(e) => {
                                      if (e.key === "Enter" && task && task.svgs) {
                                          task.svgs = task.svgs.filter((_, idx) => idx !== i);
                                          scheduleSave();
                                      }
                                  }}
                                  role="button" tabindex="0" title="Remove icon">
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
            <span class="meta-add-btn"
                  on:click={() => {
                      if (task) {
                          if (!task.svgs) task.svgs = [];
                          task.svgs = [...task.svgs, ''];
                      }
                  }}
                  on:keydown={(e) => {
                      if (e.key === "Enter" && task) {
                          if (!task.svgs) task.svgs = [];
                          task.svgs = [...task.svgs, ''];
                      }
                  }}
                  role="button" tabindex="0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add SVG icon
            </span>
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
                                task.dueDate = e.currentTarget.value || undefined;
                                scheduleSave();
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

        <!-- Footer: Schedule Drawer Toggle | Created date | Delete -->
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
