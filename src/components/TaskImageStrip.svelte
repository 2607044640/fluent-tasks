<script lang="ts">
    import { onDestroy } from "svelte";
    import type { App } from "obsidian";
    import TaskImageThumbnail from "./TaskImageThumbnail.svelte";
    import { portal } from "../utils/domUtils";
    import {
        reorderImageArray,
        resolveImageResourceUrl,
        getImageBaseName,
    } from "../utils/imageAttachmentUtils";

    export let app: App;
    export let images: string[] = [];
    export let size: number = 38;
    export let canDelete: boolean = true;
    export let showDivider: boolean = true;
    export let isCenterAligned: boolean = false;
    export let onDelete: ((imgRef: string) => void) | undefined = undefined;
    export let onCut: ((imgRef: string) => void) | undefined = undefined;
    export let onHover: ((imgRef: string, isHovered: boolean) => void) | undefined = undefined;
    export let onClick: ((imgRef: string) => void) | undefined = undefined;
    export let onReorder: ((newImages: string[]) => void) | undefined = undefined;

    const DRAG_THRESHOLD_PX = 5;

    let rowEl: HTMLElement | null = null;
    let isTrackingPointer: boolean = false;
    let isDragging: boolean = false;
    let dragSourceIdx: number = -1;
    let dragImgRef: string = "";
    let dragGhostSrc: string = "";
    let dragGhostName: string = "";
    let ghostX: number = 0;
    let ghostY: number = 0;
    let startX: number = 0;
    let startY: number = 0;
    let pointerOffsetX: number = 0;
    let pointerOffsetY: number = 0;
    let indicatorIdx: number = -1;
    let indicatorSide: "before" | "after" | null = null;
    let insertTargetPos: number = -1;
    let suppressClickCleanupTimer: number | null = null;
    let activeClickShield: ((ev: MouseEvent) => void) | null = null;

    $: canReorder = Boolean(onReorder) && Boolean(images && images.length > 1);

    function isDeleteBtnTarget(e: Event): boolean {
        const target = e.target as HTMLElement | null;
        return Boolean(target?.closest(".task-image-thumb-delete-btn"));
    }

    function cleanupPointerListeners() {
        window.removeEventListener("pointermove", handleWindowPointerMove, true);
        window.removeEventListener("pointerup", handleWindowPointerUp, true);
        window.removeEventListener("pointercancel", handleWindowPointerCancel, true);
        window.removeEventListener("blur", handleWindowPointerCancel);
    }

    function resetDragState() {
        isTrackingPointer = false;
        isDragging = false;
        dragSourceIdx = -1;
        dragImgRef = "";
        dragGhostSrc = "";
        dragGhostName = "";
        indicatorIdx = -1;
        indicatorSide = null;
        insertTargetPos = -1;
        document.body.classList.remove("fluent-tasks-image-dragging");
    }

    function removeClickShield() {
        if (activeClickShield) {
            window.removeEventListener("click", activeClickShield, true);
            activeClickShield = null;
        }
        if (suppressClickCleanupTimer !== null) {
            window.clearTimeout(suppressClickCleanupTimer);
            suppressClickCleanupTimer = null;
        }
    }

    function installClickShield() {
        removeClickShield();
        const shield = (ev: MouseEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            removeClickShield();
        };
        activeClickShield = shield;
        window.addEventListener("click", shield, true);
        suppressClickCleanupTimer = window.setTimeout(() => {
            removeClickShield();
        }, 300);
    }

    function updateDropTarget(clientX: number, clientY: number) {
        if (!rowEl) return;
        const slots = Array.from(rowEl.querySelectorAll<HTMLElement>(".task-image-slot[data-image-index]"));
        if (slots.length === 0) {
            indicatorIdx = -1;
            indicatorSide = null;
            insertTargetPos = -1;
            return;
        }

        const items = slots
            .map((el) => ({
                idx: Number(el.dataset.imageIndex),
                rect: el.getBoundingClientRect(),
            }))
            .filter((item) => !Number.isNaN(item.idx));

        if (items.length === 0) return;

        // Match the visual row closest to cursor Y (supports multi-row flex-wrap strips)
        const yDistances = items.map((item) => {
            if (clientY >= item.rect.top && clientY <= item.rect.bottom) return 0;
            return Math.min(Math.abs(clientY - item.rect.top), Math.abs(clientY - item.rect.bottom));
        });
        const minYDist = Math.min(...yDistances);

        const rowItems = items
            .filter((_, i) => yDistances[i] <= minYDist + 8)
            .sort((a, b) => a.rect.left - b.rect.left);

        let chosenIdx = rowItems[rowItems.length - 1].idx;
        let chosenSide: "before" | "after" = "after";
        let rawInsertPos = rowItems[rowItems.length - 1].idx + 1;

        for (const item of rowItems) {
            const midX = item.rect.left + item.rect.width / 2;
            if (clientX < midX) {
                chosenIdx = item.idx;
                chosenSide = "before";
                rawInsertPos = item.idx;
                break;
            }
        }

        if (rawInsertPos === dragSourceIdx || rawInsertPos === dragSourceIdx + 1) {
            indicatorIdx = -1;
            indicatorSide = null;
            insertTargetPos = -1;
            return;
        }

        indicatorIdx = chosenIdx;
        indicatorSide = chosenSide;
        insertTargetPos = rawInsertPos;
    }

    function handleSlotPointerDown(e: PointerEvent, idx: number, imgRef: string) {
        if (!canReorder || e.button !== 0 || isDeleteBtnTarget(e)) return;
        // Prevent parent task/step dndzone and cross-pane task drag from capturing thumbnail drags
        e.stopPropagation();

        const slotEl = e.currentTarget as HTMLElement;
        const rect = slotEl.getBoundingClientRect();

        dragSourceIdx = idx;
        dragImgRef = imgRef;
        dragGhostSrc = resolveImageResourceUrl(imgRef, app);
        dragGhostName = getImageBaseName(imgRef);
        startX = e.clientX;
        startY = e.clientY;
        pointerOffsetX = e.clientX - rect.left;
        pointerOffsetY = e.clientY - rect.top;
        ghostX = rect.left;
        ghostY = rect.top;
        indicatorIdx = -1;
        indicatorSide = null;
        insertTargetPos = -1;
        isTrackingPointer = true;

        window.addEventListener("pointermove", handleWindowPointerMove, true);
        window.addEventListener("pointerup", handleWindowPointerUp, true);
        window.addEventListener("pointercancel", handleWindowPointerCancel, true);
        window.addEventListener("blur", handleWindowPointerCancel);
    }

    function handleWindowPointerMove(e: PointerEvent) {
        if (!isTrackingPointer) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
            isDragging = true;
            onHover?.(dragImgRef, false);
            window.getSelection()?.removeAllRanges();
            document.body.classList.add("fluent-tasks-image-dragging");
        }

        e.preventDefault();
        ghostX = e.clientX - pointerOffsetX;
        ghostY = e.clientY - pointerOffsetY;
        updateDropTarget(e.clientX, e.clientY);
    }

    function handleWindowPointerUp(e: PointerEvent) {
        if (!isTrackingPointer) return;

        const wasDragging = isDragging;
        const fromIdx = dragSourceIdx;
        const targetPos = insertTargetPos;

        cleanupPointerListeners();

        if (wasDragging) {
            e.preventDefault();
            e.stopPropagation();
            installClickShield();

            if (fromIdx >= 0 && targetPos >= 0 && onReorder) {
                const reordered = reorderImageArray(images, fromIdx, targetPos);
                const changed =
                    reordered.length === images.length &&
                    reordered.some((val, i) => val !== images[i]);
                if (changed) {
                    onReorder(reordered);
                }
            }
        }

        resetDragState();
    }

    function handleWindowPointerCancel() {
        cleanupPointerListeners();
        resetDragState();
    }

    onDestroy(() => {
        cleanupPointerListeners();
        resetDragState();
        removeClickShield();
    });
</script>

{#if images && images.length > 0}
    <div class="task-image-strip-wrapper" class:is-center-aligned={isCenterAligned}>
        <div class="task-image-strip-inner" class:is-center-aligned={isCenterAligned}>
            <div
                class="task-image-strip-row"
                class:is-center-aligned={isCenterAligned}
                class:is-reordering={isDragging}
                bind:this={rowEl}
            >
                {#each images as imgRef, idx (imgRef)}
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div
                        class="task-image-slot"
                        class:is-draggable={canReorder}
                        class:is-drag-source={isDragging && dragSourceIdx === idx}
                        class:drop-before={isDragging && indicatorIdx === idx && indicatorSide === "before"}
                        class:drop-after={isDragging && indicatorIdx === idx && indicatorSide === "after"}
                        data-image-index={idx}
                        on:pointerdown={(e) => handleSlotPointerDown(e, idx, imgRef)}
                        on:mousedown={(e) => {
                            if (canReorder && e.button === 0 && !isDeleteBtnTarget(e)) {
                                e.stopPropagation();
                            }
                        }}
                        on:touchstart={(e) => {
                            if (canReorder && !isDeleteBtnTarget(e)) {
                                e.stopPropagation();
                            }
                        }}
                        on:dragstart={(e) => {
                            if (canReorder) e.preventDefault();
                        }}
                    >
                        <TaskImageThumbnail
                            imageRef={imgRef}
                            {app}
                            {size}
                            {canDelete}
                            onDelete={onDelete ? () => onDelete(imgRef) : undefined}
                            onCut={onCut ? () => onCut(imgRef) : undefined}
                            onHover={onHover ? (isHovered) => { if (!isDragging) onHover(imgRef, isHovered); } : undefined}
                            onClick={onClick ? () => onClick(imgRef) : undefined}
                        />
                    </div>
                {/each}
            </div>
            {#if showDivider}
                <div class="task-image-strip-divider"></div>
            {/if}
        </div>
    </div>
{/if}

{#if isDragging}
    <div
        use:portal
        class="fluent-tasks-image-drag-ghost"
        style="left: {ghostX}px; top: {ghostY}px; width: {size}px; height: {size}px; {dragGhostSrc ? `background-image: url('${dragGhostSrc}');` : ''}"
        aria-label={dragGhostName}
    >
        {#if !dragGhostSrc}
            <span>🖼️</span>
        {/if}
    </div>
{/if}

<style>
    .task-image-strip-wrapper {
        display: flex;
        flex-direction: column;
        width: 100%;
        margin-bottom: 6px;
    }

    .task-image-strip-wrapper.is-center-aligned {
        align-items: center;
    }

    .task-image-strip-inner {
        display: inline-flex;
        flex-direction: column;
        width: fit-content;
        max-width: 100%;
        align-items: stretch;
    }

    .task-image-strip-inner.is-center-aligned {
        align-items: center;
    }

    .task-image-strip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
    }

    .task-image-strip-row.is-center-aligned {
        justify-content: center;
    }

    .task-image-slot {
        position: relative;
        display: inline-flex;
        flex-shrink: 0;
        user-select: none;
        -webkit-user-select: none;
    }

    .task-image-slot.is-draggable :global(.task-image-thumbnail-container) {
        cursor: grab;
    }

    .task-image-slot.is-drag-source {
        opacity: 0.3;
        transform: scale(0.94);
        transition: opacity 0.12s ease, transform 0.12s ease;
    }

    .task-image-strip-row.is-reordering :global(.task-image-thumbnail-container) {
        pointer-events: none;
    }

    .task-image-slot.drop-before::before,
    .task-image-slot.drop-after::after {
        content: "";
        position: absolute;
        top: -2px;
        bottom: -2px;
        width: 3px;
        background: var(--todo-accent, var(--interactive-accent, #8b5cf6));
        border-radius: 3px;
        box-shadow: 0 0 8px 1px var(--todo-accent-glow, rgba(139, 92, 246, 0.75));
        z-index: 12;
        pointer-events: none;
    }

    .task-image-slot.drop-before::before {
        left: -4.5px;
    }

    .task-image-slot.drop-after::after {
        right: -4.5px;
    }

    .task-image-strip-divider {
        height: 1px;
        width: 100%;
        align-self: stretch;
        background-color: var(--background-modifier-border, rgba(255, 255, 255, 0.12));
        margin-top: 8px;
        margin-bottom: 6px;
        opacity: 0.85;
    }
</style>
