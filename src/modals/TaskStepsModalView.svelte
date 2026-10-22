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
    import TaskImageThumbnail from "../components/TaskImageThumbnail.svelte";
    import TaskImageStrip from "../components/TaskImageStrip.svelte";
    import {
        saveImageAttachment,
        copyImageToClipboard,
        extractImageRefs,
        removeImageRefFromText,
        getImagesFromClipboard,
        isSameImageRef,
        getStepImages,
        removeImageFromStepItem,
    } from "../utils/imageAttachmentUtils";
    import { t } from "../lang/helpers";
    import { Notice } from "obsidian";

    // =============================================
    // Props
    // =============================================
    export let app: any = undefined;
    export let plugin: any = undefined;
    export let task: TaskItem;
    export let categoryFilepath: string;
    export let dataService: DataService;
    export let closeModal: () => void = () => {};
    export let centerAlignTasks: boolean = true;
    export let showStepsProgressPill: boolean = false;

    // =============================================
    // Local State
    // =============================================
    $: actualApp = app || dataService?.app || plugin?.app || (window as any).app;
    let steps: TaskStep[] = task.steps ? ensureStepIds(task.id, task.steps) : [];
    let newStepText: string = "";
    let newStepImages: string[] = [];
    let focusedStepId: string | null = null;
    let hoveredImageRef: { imageRef: string; stepId?: string; isNewDraft?: boolean } | null = null;
    let addInputEl: HTMLTextAreaElement;
    let modalBodyEl: HTMLElement;
    let saveTimeout: any = null;
    let isDraggingSteps: boolean = false;
    let preDndSteps: TaskStep[] = [];
    const SAVE_DEBOUNCE_MS = 400;
    const DND_FLIP_DURATION = 150;

    // In-Modal Search (Ctrl+F) State
    interface SearchMatch {
        id: string;
        globalIndex: number;
        stepId: string;
        stepIndex: number;
        start: number;
        end: number;
        text: string;
    }
    let showSearchBar: boolean = false;
    let searchQuery: string = "";
    let searchInputEl: HTMLInputElement;
    let allMatches: SearchMatch[] = [];
    let activeMatchIndex: number = -1;

    // =============================================
    // In-Modal Search (Ctrl+F) Methods
    // =============================================
    function escapeHtml(str: string): string {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function updateSearchMatches() {
        allMatches = [];
        const query = searchQuery.trim().toLowerCase();
        if (!query) {
            activeMatchIndex = -1;
            return;
        }

        let globalCounter = 0;
        for (let sIdx = 0; sIdx < steps.length; sIdx++) {
            const step = steps[sIdx];
            const text = step.text || "";
            const lowerText = text.toLowerCase();
            let matchIndexInStep = 0;
            let startIndex = 0;

            while (startIndex < lowerText.length) {
                const foundIdx = lowerText.indexOf(query, startIndex);
                if (foundIdx === -1) break;

                allMatches.push({
                    id: `${step.id}-m-${matchIndexInStep}`,
                    globalIndex: globalCounter++,
                    stepId: step.id || `step-${sIdx}`,
                    stepIndex: sIdx,
                    start: foundIdx,
                    end: foundIdx + query.length,
                    text: text.substring(foundIdx, foundIdx + query.length),
                });

                matchIndexInStep++;
                startIndex = foundIdx + Math.max(1, query.length);
            }
        }

        if (allMatches.length > 0) {
            if (activeMatchIndex >= allMatches.length || activeMatchIndex < 0) {
                activeMatchIndex = 0;
            }
        } else {
            activeMatchIndex = -1;
        }
    }

    async function scrollToActiveMatch() {
        await tick();
        if (activeMatchIndex < 0 || activeMatchIndex >= allMatches.length) return;
        const currentMatch = allMatches[activeMatchIndex];
        if (!currentMatch) return;

        const markEl = modalBodyEl?.querySelector(`#step-search-mark-${currentMatch.globalIndex}`) as HTMLElement;
        if (markEl && modalBodyEl) {
            const containerRect = modalBodyEl.getBoundingClientRect();
            const markRect = markEl.getBoundingClientRect();
            const markCenterFromContainerTop = (markRect.top - containerRect.top) + (markRect.height / 2);
            const targetScrollTop = modalBodyEl.scrollTop + markCenterFromContainerTop - (containerRect.height / 2);
            modalBodyEl.scrollTo({ top: Math.max(0, targetScrollTop), behavior: "smooth" });
        }
    }

    function focusSearchInput() {
        if (searchInputEl) {
            searchInputEl.focus();
            searchInputEl.select();
        }
        requestAnimationFrame(() => {
            if (searchInputEl) {
                searchInputEl.focus();
                searchInputEl.select();
            }
        });
        setTimeout(() => {
            if (searchInputEl) {
                searchInputEl.focus();
                searchInputEl.select();
            }
        }, 30);
        setTimeout(() => {
            if (searchInputEl) {
                searchInputEl.focus();
                searchInputEl.select();
            }
        }, 100);
    }

    async function openSearch() {
        showSearchBar = true;
        await tick();
        focusSearchInput();
        updateSearchMatches();
        if (allMatches.length > 0) {
            void scrollToActiveMatch();
        }
        focusSearchInput();
    }

    function closeSearch() {
        showSearchBar = false;
        searchQuery = "";
        allMatches = [];
        activeMatchIndex = -1;
    }

    function nextMatch() {
        if (allMatches.length === 0) return;
        activeMatchIndex = (activeMatchIndex + 1) % allMatches.length;
        void scrollToActiveMatch();
    }

    function prevMatch() {
        if (allMatches.length === 0) return;
        activeMatchIndex = (activeMatchIndex - 1 + allMatches.length) % allMatches.length;
        void scrollToActiveMatch();
    }

    function handleSearchInput() {
        updateSearchMatches();
        if (allMatches.length > 0) {
            void scrollToActiveMatch();
        }
    }

    function handleSearchKeydown(e: KeyboardEvent) {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) {
                prevMatch();
            } else {
                nextMatch();
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeSearch();
        }
    }

    function renderHighlightedText(text: string, stepId: string | undefined, query: string, currentActiveIdx: number): string {
        if (!text) return "";
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return escapeHtml(text);

        const stepMatches = allMatches.filter(m => m.stepId === stepId);
        if (stepMatches.length === 0) {
            return escapeHtml(text);
        }

        let html = "";
        let lastIdx = 0;

        for (const match of stepMatches) {
            if (match.start > lastIdx) {
                html += escapeHtml(text.substring(lastIdx, match.start));
            }
            const isActive = match.globalIndex === currentActiveIdx;
            const matchedChunk = text.substring(match.start, match.end);
            html += `<mark class="task-steps-search-mark ${isActive ? 'is-active' : ''}" id="step-search-mark-${match.globalIndex}">${escapeHtml(matchedChunk)}</mark>`;
            lastIdx = match.end;
        }

        if (lastIdx < text.length) {
            html += escapeHtml(text.substring(lastIdx));
        }

        if (text.endsWith("\n")) {
            html += "\n&nbsp;";
        }

        return html;
    }

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
        if (showSearchBar && searchQuery.trim()) {
            updateSearchMatches();
        }
        scheduleSave();
    }

    async function deleteStep(stepId?: string) {
        if (!stepId || !task) return;
        if (focusedStepId === stepId) {
            focusedStepId = null;
        }
        const index = steps.findIndex(s => s.id === stepId);
        if (index === -1) return;
        const deletedStep = { ...steps[index] };
        steps = steps.filter(s => s.id !== stepId);
        if (showSearchBar && searchQuery.trim()) {
            updateSearchMatches();
        }
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

    function getStepImages(step: TaskStep): string[] {
        const fromArray = step.images || [];
        const fromText = extractImageRefs(step.text);
        const combined = [...fromArray];
        for (const ref of fromText) {
            if (!combined.some(existing => isSameImageRef(existing, ref))) {
                combined.push(ref);
            }
        }
        return combined;
    }

    function isStepEmpty(step: TaskStep): boolean {
        const hasText = !!step.text && step.text.trim().length > 0;
        const hasImages = getStepImages(step).length > 0;
        return !hasText && !hasImages;
    }

    function removeImageFromStep(stepId: string | undefined, imageRef: string) {
        if (!stepId) return;
        const step = steps.find(s => s.id === stepId);
        if (!step) return;
        removeImageFromStepItem(step, imageRef);
        if (isStepEmpty(step)) {
            void deleteStep(stepId);
            return;
        }
        steps = [...steps];
        scheduleSave();
    }

    function removeNewStepImage(imageRef: string) {
        newStepImages = newStepImages.filter(img => !isSameImageRef(img, imageRef));
    }

    async function handleCutHoveredImage() {
        if (!hoveredImageRef || !actualApp) return;
        const { imageRef, stepId, isNewDraft } = hoveredImageRef;
        await copyImageToClipboard(imageRef, actualApp, t("image_cut") || "Image cut to clipboard / 图片已剪切至剪贴板");
        if (isNewDraft) {
            removeNewStepImage(imageRef);
        } else if (stepId) {
            removeImageFromStep(stepId, imageRef);
        }
        hoveredImageRef = null;
    }

    async function handleCopyHoveredImage() {
        if (!hoveredImageRef || !actualApp) return;
        await copyImageToClipboard(hoveredImageRef.imageRef, actualApp, t("image_copied") || "Image copied to clipboard / 图片已复制到剪贴板");
    }

    function handlePaste(e: ClipboardEvent) {
        if (!actualApp) return;
        const files = getImagesFromClipboard(e);
        if (!files || files.length === 0) return;

        e.preventDefault();
        e.stopPropagation();

        void (async () => {
            for (const file of files) {
                const savedPath = await saveImageAttachment(file, actualApp, categoryFilepath);
                if (!savedPath) continue;

                new Notice(t("image_pasted") || "Image attached / 图片已附加");

                if (focusedStepId && focusedStepId !== "__new__") {
                    const targetStep = steps.find(s => s.id === focusedStepId);
                    if (targetStep) {
                        targetStep.images = [...(targetStep.images || []), savedPath];
                        steps = [...steps];
                        scheduleSave();
                        continue;
                    }
                }
                newStepImages = [...newStepImages, savedPath];
            }
        })();
    }

    function handleDragOver(e: DragEvent) {
        if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
        }
    }

    async function handleDrop(e: DragEvent) {
        if (!actualApp) return;
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

        for (const file of imgFiles) {
            const savedPath = await saveImageAttachment(file, actualApp, categoryFilepath);
            if (!savedPath) continue;
            new Notice(t("image_pasted") || "Image attached / 图片已附加");
            if (focusedStepId && focusedStepId !== "__new__") {
                const targetStep = steps.find(s => s.id === focusedStepId);
                if (targetStep) {
                    targetStep.images = [...(targetStep.images || []), savedPath];
                    steps = [...steps];
                    scheduleSave();
                    continue;
                }
            }
            newStepImages = [...newStepImages, savedPath];
        }
    }

    async function addStep() {
        const trimmed = newStepText.trim();
        if (!trimmed && newStepImages.length === 0) return;
        const newStep: TaskStep = {
            id: `${task.id}-step-${Date.now()}-${steps.length}`,
            text: trimmed,
            done: false,
            ...(newStepImages.length > 0 ? { images: [...newStepImages] } : {})
        };
        steps = [...steps, newStep];
        newStepText = "";
        newStepImages = [];
        if (showSearchBar && searchQuery.trim()) {
            updateSearchMatches();
        }
        void Logger.log(`[DND Modal] Added step: taskId=${task.id}, stepId=${newStep.id}, text="${newStep.text}", images=${newStep.images?.length || 0}, totalSteps=${steps.length}`);
        console.log(`[FluentTasks Modal] Added step: taskId=${task.id}, stepId=${newStep.id}, total=${steps.length}`);
        await persistTask();
        await tick();
        addInputEl?.focus();
        modalBodyEl?.scrollTo({ top: modalBodyEl.scrollHeight, behavior: 'smooth' });
    }

    function handleStepBlur(stepId?: string) {
        if (stepId) {
            const step = steps.find(s => s.id === stepId);
            if (step && isStepEmpty(step)) {
                void deleteStep(stepId);
                return;
            }
        }
        flushSaveSync();
    }

    function handleStepKeydown(e: KeyboardEvent, stepId?: string) {
        if (!stepId || e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
            const step = steps.find(s => s.id === stepId);
            if (step && isStepEmpty(step)) {
                e.preventDefault();
                e.stopPropagation();
                void deleteStep(stepId);
                return;
            }

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
        steps = steps.filter(s => !isStepEmpty(s));
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
        // Automatically prune any stray empty steps
        if (steps.some(s => isStepEmpty(s))) {
            steps = steps.filter(s => !isStepEmpty(s));
            scheduleSave();
        }

        // Esc guard in capture phase to prevent conflicts with parent modal listeners
        const handleCaptureKeydown = (e: KeyboardEvent) => {
            if (document.querySelector(".task-img-preview-modal-shell")) {
                return;
            }

            if (e.key === "Escape") {
                if (showSearchBar) {
                    e.stopPropagation();
                    e.preventDefault();
                    closeSearch();
                    return;
                }
                e.stopPropagation();
                e.preventDefault();
                handleClose();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
                if (e.key === "f" || e.key === "F") {
                    e.preventDefault();
                    e.stopPropagation();
                    let initialQuery = "";
                    const active = document.activeElement;
                    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
                        if (typeof active.selectionStart === "number" && typeof active.selectionEnd === "number" && active.selectionStart !== active.selectionEnd) {
                            initialQuery = active.value.substring(active.selectionStart, active.selectionEnd).trim();
                        }
                    } else {
                        const sel = window.getSelection();
                        if (sel && !sel.isCollapsed) {
                            initialQuery = sel.toString().trim();
                        }
                    }
                    if (initialQuery) {
                        searchQuery = initialQuery;
                    }
                    void openSearch();
                    return;
                }

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

        window.addEventListener("keydown", handleCaptureKeydown, { capture: true });
        window.addEventListener("paste", handlePaste);
        window.addEventListener("dragover", handleDragOver);
        window.addEventListener("drop", handleDrop);
        EventBus.on(EventName.TASK_UPDATED, handleExternalTaskUpdate);

        return () => {
            window.removeEventListener("keydown", handleCaptureKeydown, { capture: true });
            window.removeEventListener("paste", handlePaste);
            window.removeEventListener("dragover", handleDragOver);
            window.removeEventListener("drop", handleDrop);
            EventBus.off(EventName.TASK_UPDATED, handleExternalTaskUpdate);
            flushSaveSync();
        };
    });

    onDestroy(() => {
        flushSaveSync();
    });
</script>

<div class="task-steps-modal-container" class:is-center-aligned={centerAlignTasks}>
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
            <button
                type="button"
                class="task-steps-header-search-btn"
                class:is-active={showSearchBar}
                title={showSearchBar ? "Close search (Ctrl+F / Esc)" : "Search steps (Ctrl+F)"}
                aria-label="Search steps"
                on:click={() => {
                    if (showSearchBar) {
                        closeSearch();
                    } else {
                        void openSearch();
                    }
                }}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
            </button>
        </div>
    </div>

    <!-- Floating In-Modal Search Bar (Ctrl+F) -->
    {#if showSearchBar}
        <div class="task-steps-search-bar" role="search" aria-label="Search within steps">
            <div class="task-steps-search-input-wrapper">
                <svg class="task-steps-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                    type="text"
                    class="task-steps-search-input"
                    placeholder="Search in steps..."
                    bind:this={searchInputEl}
                    bind:value={searchQuery}
                    on:input={handleSearchInput}
                    on:keydown={handleSearchKeydown}
                    aria-label="Search steps"
                />
                {#if searchQuery.trim()}
                    <span class="task-steps-search-count" class:no-match={allMatches.length === 0}>
                        {allMatches.length === 0 ? "0/0" : `${activeMatchIndex + 1}/${allMatches.length}`}
                    </span>
                {/if}
            </div>

            <div class="task-steps-search-actions">
                <button
                    type="button"
                    class="task-steps-search-btn"
                    title="Previous match (Shift+Enter)"
                    aria-label="Previous match"
                    disabled={allMatches.length === 0}
                    on:click={prevMatch}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="18 15 12 9 6 15"/>
                    </svg>
                </button>
                <button
                    type="button"
                    class="task-steps-search-btn"
                    title="Next match (Enter)"
                    aria-label="Next match"
                    disabled={allMatches.length === 0}
                    on:click={nextMatch}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </button>
                <button
                    type="button"
                    class="task-steps-search-btn task-steps-search-close-btn"
                    title="Close search (Esc)"
                    aria-label="Close search"
                    on:click={closeSearch}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        </div>
    {/if}

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

                        <!-- Multi-line auto-resizing textarea with thumbnail row placed ABOVE the text -->
                        <div class="steps-modal-text-col">
                            {#if getStepImages(step).length > 0}
                                <TaskImageStrip
                                    images={getStepImages(step)}
                                    app={actualApp}
                                    size={44}
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
                            <div class="steps-modal-text-wrapper">
                                {#if showSearchBar && searchQuery.trim()}
                                    <div class="steps-modal-text-backdrop" aria-hidden="true">
                                        {@html renderHighlightedText(step.text, step.id, searchQuery, activeMatchIndex)}
                                    </div>
                                {/if}
                                <textarea
                                    use:autosize={step.text}
                                    rows="1"
                                    class="steps-modal-textarea"
                                    class:completed={step.done}
                                    value={step.text}
                                    placeholder="Step description..."
                                    on:focus={() => { focusedStepId = step.id || null; }}
                                    on:input={(e) => handleStepInput(step.id, e.currentTarget.value)}
                                    on:blur={() => handleStepBlur(step.id)}
                                    on:keydown={(e) => handleStepKeydown(e, step.id)}
                                />
                            </div>
                        </div>

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

        <!-- Add Step Container -->
        <div class="steps-modal-add-card">
            {#if newStepImages.length > 0}
                <TaskImageStrip
                    images={newStepImages}
                    app={actualApp}
                    size={44}
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
                    placeholder="Add a step... (Press Enter to add, Shift+Enter for newline, Ctrl+V to paste image)"
                    bind:value={newStepText}
                    bind:this={addInputEl}
                    on:focus={() => { focusedStepId = "__new__"; }}
                    on:keydown={handleAddInputKeydown}
                />
                <button
                    type="button"
                    class="steps-modal-add-btn"
                    disabled={!newStepText.trim() && newStepImages.length === 0}
                    on:click={addStep}
                >
                    Add
                </button>
            </div>
        </div>
    </div>

    {#if showStepsProgressPill && totalCount > 0}
        <div class="task-steps-modal-footer">
            <span class="task-steps-progress-pill">
                {completedCount}/{totalCount} {totalCount === 1 ? 'step' : 'steps'} completed
            </span>
        </div>
    {/if}
</div>

<style>
    .steps-modal-text-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 6px;
    }

    .steps-modal-add-card {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex-shrink: 0;
    }
</style>
