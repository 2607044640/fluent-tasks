<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, type TaskItem, type TaskStep, type RecurrenceRule } from "./types";
    import { SAVE_DEBOUNCE_MS } from "./constants";
    import { portal, autosize } from "./utils/domUtils";
    import { DAY_LABELS, formatExactTime, getRelativeTime, getRecurrenceLabel } from "./utils/timeUtils";

    // =============================================
    // Props
    // =============================================
    export let dataService: DataService;
    export let plugin: any = undefined;

    // =============================================
    // State
    // =============================================
    let task: TaskItem | null = null;
    let categoryFilepath: string = "";
    let newStepText: string = "";
    let showScheduleSection: boolean = false;
    let showRepeatPicker: boolean = false;

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
    onMount(() => {
        EventBus.on(EventName.TASK_SELECTED, handleTaskSelected);
        EventBus.on(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.on(EventName.TASK_UPDATED, handleExternalTaskUpdate);
    });

    onDestroy(() => {
        EventBus.off(EventName.TASK_SELECTED, handleTaskSelected);
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

    function handleTitleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
        }
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

    let showAddMetaModal: boolean = false;
    let metaFormType: "why" | "note_link" | "svg" | "custom" = "why";
    let metaWhyVal: string = "";
    let metaNoteLinkVal: string = "";
    let metaSvgVal: string = "";
    let metaCustomKey: string = "";
    let metaCustomVal: string = "";

    function openAddMetaModal() {
        if (!task) return;
        metaWhyVal = task.why || "";
        metaNoteLinkVal = task.note_link || "";
        metaSvgVal = task.svgs && task.svgs.length > 0 ? task.svgs[0] : "";
        metaCustomKey = "";
        metaCustomVal = "";
        showAddMetaModal = true;
    }

    function closeAddMetaModal() {
        showAddMetaModal = false;
    }

    async function saveMetadata() {
        if (!task) return;
        if (metaFormType === "why") {
            const val = metaWhyVal.trim();
            if (val) task.why = val;
            else delete task.why;
        } else if (metaFormType === "note_link") {
            const val = metaNoteLinkVal.trim();
            if (val) task.note_link = val;
            else delete task.note_link;
        } else if (metaFormType === "svg") {
            const val = metaSvgVal.trim();
            if (val) task.svgs = [val];
            else delete task.svgs;
        } else if (metaFormType === "custom") {
            const key = metaCustomKey.trim();
            const val = metaCustomVal.trim();
            if (key) {
                if (!task.customMeta) task.customMeta = {};
                task.customMeta[key] = val;
            }
        }
        task = { ...task };
        if (categoryFilepath) {
            await dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, {
                task,
                categoryFilepath,
            });
        }
        closeAddMetaModal();
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

    async function deleteMetaProp(prop: 'why' | 'note_link' | 'svg') {
        if (!task) return;
        if (prop === 'why') delete task.why;
        else if (prop === 'note_link') delete task.note_link;
        else if (prop === 'svg') delete task.svgs;
        task = { ...task };
        if (categoryFilepath) {
            await dataService.updateTask(categoryFilepath, task);
            EventBus.emit(EventName.TASK_UPDATED, {
                task,
                categoryFilepath,
            });
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

                <!-- Title input (auto-resizing textarea for full multi-line title wrapping) -->
                <textarea
                    use:autosize
                    class="detail-title-input"
                    rows="1"
                    bind:value={task.title}
                    on:input={handleTitleInput}
                    on:keydown={handleTitleKeydown}
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
                        <textarea
                            use:autosize
                            rows="1"
                            value={step.text}
                            class:completed={step.done}
                            on:input={(e) => updateStepText(i, e.currentTarget.value)}
                            on:keydown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    e.currentTarget.blur();
                                }
                            }}
                            placeholder="Step text"
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

        <!-- Active Metadata Chips (Why, Note Link, SVG, Custom) -->
        {#if task.why || task.note_link || (task.svgs && task.svgs.length > 0) || (task.customMeta && Object.keys(task.customMeta).length > 0)}
            <div class="detail-meta-chips-section">
                {#if task.why}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div class="meta-chip why-chip" title={task.why}
                         on:click={() => { metaFormType = 'why'; openAddMetaModal(); }}
                         role="button" tabindex="0">
                        <span class="chip-label">Why</span>
                        <span class="chip-val">{task.why}</span>
                        <span class="chip-delete" on:click|stopPropagation={() => deleteMetaProp('why')}
                              role="button" tabindex="0" title="Remove why">✕</span>
                    </div>
                {/if}
                {#if task.note_link}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div class="meta-chip note-chip" title={task.note_link}
                         on:click={() => { metaFormType = 'note_link'; openAddMetaModal(); }}
                         role="button" tabindex="0">
                        <span class="chip-label">Note</span>
                        <span class="chip-val">{task.note_link}</span>
                        <span class="chip-delete" on:click|stopPropagation={() => deleteMetaProp('note_link')}
                              role="button" tabindex="0" title="Remove note link">✕</span>
                    </div>
                {/if}
                {#if task.svgs && task.svgs.length > 0}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div class="meta-chip svg-chip" title={task.svgs[0]}
                         on:click={() => { metaFormType = 'svg'; openAddMetaModal(); }}
                         role="button" tabindex="0">
                        <span class="chip-label">SVG</span>
                        <span class="chip-val">{task.svgs[0].length > 30 ? task.svgs[0].slice(0, 30) + '...' : task.svgs[0]}</span>
                        <span class="chip-delete" on:click|stopPropagation={() => deleteMetaProp('svg')}
                              role="button" tabindex="0" title="Remove SVG">✕</span>
                    </div>
                {/if}
                {#if task.customMeta}
                    {#each Object.entries(task.customMeta) as [k, v]}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div class="meta-chip custom-chip" title={`${k}: ${v}`}>
                            <span class="chip-label">{k}</span>
                            <span class="chip-val">{v}</span>
                            <span class="chip-delete" on:click|stopPropagation={() => deleteCustomKey(k)}
                                  role="button" tabindex="0" title={`Remove ${k}`}>✕</span>
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}

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
                      on:click={openAddMetaModal}
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

        <!-- Add / Manage Metadata Modal Dialog (Portaled to document.body) -->
        {#if showAddMetaModal}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div use:portal
                 class="meta-modal-backdrop" on:click={(e) => e.target === e.currentTarget && closeAddMetaModal()} role="presentation">
                <div class="meta-modal-dialog" role="dialog" aria-modal="true" tabindex="-1">
                    <div class="meta-modal-header">
                        <div class="meta-modal-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="3"/>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                            </svg>
                            <span>Task Metadata</span>
                        </div>
                        <span class="meta-modal-close" on:click={closeAddMetaModal}
                              on:keydown={(e) => e.key === "Enter" && closeAddMetaModal()}
                              role="button" tabindex="0">✕</span>
                    </div>

                    <div class="meta-modal-tabs">
                        <button type="button" class="meta-modal-tab" class:active={metaFormType === 'why'}
                                on:click={() => metaFormType = 'why'}>Why</button>
                        <button type="button" class="meta-modal-tab" class:active={metaFormType === 'note_link'}
                                on:click={() => metaFormType = 'note_link'}>Note Link</button>
                        <button type="button" class="meta-modal-tab" class:active={metaFormType === 'svg'}
                                on:click={() => metaFormType = 'svg'}>Visual SVG</button>
                        <button type="button" class="meta-modal-tab" class:active={metaFormType === 'custom'}
                                on:click={() => metaFormType = 'custom'}>Custom</button>
                    </div>

                    <div class="meta-modal-body">
                        {#if metaFormType === 'why'}
                            <div class="meta-form-field">
                                <span class="meta-field-label">Why / Methodology Rationale</span>
                                <textarea class="meta-form-textarea" placeholder="Core rationale or mental model behind this instruction..."
                                          bind:value={metaWhyVal} rows="4"></textarea>
                            </div>
                        {:else if metaFormType === 'note_link'}
                            <div class="meta-form-field">
                                <span class="meta-field-label">Linked Obsidian / OneNote Note</span>
                                <input class="meta-form-input" type="text" placeholder="e.g. [[My Note]] or OneNote/Domain/Section/Topic.md"
                                       bind:value={metaNoteLinkVal} />
                                <span class="meta-form-hint">Hovering badge in main view will preview this note. Clicking will open it.</span>
                                {#if metaNoteLinkVal && plugin?.app}
                                    <button type="button" class="meta-btn-secondary" style="align-self: flex-start; margin-top: 4px; font-size: 11px; padding: 3px 8px;"
                                            on:click={() => {
                                                const clean = metaNoteLinkVal.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
                                                if (clean) plugin.app.workspace.openLinkText(clean, categoryFilepath, false);
                                            }}>
                                        🔗 Test Open Note
                                    </button>
                                {/if}
                            </div>
                        {:else if metaFormType === 'svg'}
                            <div class="meta-form-field">
                                <span class="meta-field-label">Visual Memory SVG (Path or Code)</span>
                                <textarea class="meta-form-textarea monospace" placeholder="OneNote/Original Game/AI Draw/assets/name.svg or <svg...>...</svg>"
                                          bind:value={metaSvgVal} rows="3"></textarea>
                                <span class="meta-form-hint">Path to .svg asset in vault, or raw &lt;svg&gt; XML markup.</span>
                            </div>
                        {:else if metaFormType === 'custom'}
                            {#if task.customMeta && Object.keys(task.customMeta).length > 0}
                                <div class="meta-existing-custom-box">
                                    <span class="meta-field-label">Current Properties ({Object.keys(task.customMeta).length})</span>
                                    <div class="custom-chips-grid">
                                        {#each Object.entries(task.customMeta) as [k, v]}
                                            <div class="custom-prop-row">
                                                <span class="custom-prop-key">{k}:</span>
                                                <span class="custom-prop-val">{v}</span>
                                                <span class="custom-prop-del" on:click={() => deleteCustomKey(k)}
                                                      role="button" tabindex="0" title="Delete property">✕</span>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                            <div class="meta-form-field">
                                <span class="meta-field-label">Property Key</span>
                                <input class="meta-form-input" type="text" placeholder="e.g. priority, author, tags, domain"
                                       bind:value={metaCustomKey} />
                            </div>
                            <div class="meta-form-field">
                                <span class="meta-field-label">Property Value</span>
                                <input class="meta-form-input" type="text" placeholder="e.g. high, Opus, #review, AI"
                                       bind:value={metaCustomVal} />
                            </div>
                        {/if}
                    </div>

                    <div class="meta-modal-footer">
                        <button type="button" class="meta-btn-secondary" on:click={closeAddMetaModal}>Cancel</button>
                        <button type="button" class="meta-btn-primary" on:click={saveMetadata}>Save Metadata</button>
                    </div>
                </div>
            </div>
        {/if}
    {:else}
        <div class="detail-empty">
            Click a task to view details.
        </div>
    {/if}
</div>
