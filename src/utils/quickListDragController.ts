import {
    computeEdgePan,
    resolveBoardPointerTarget,
    resolveClassicListPointerTarget,
    type BoardDropTarget,
    type ClassicGroupGeometry,
    type ColumnGeometry,
    type GridCardData,
    type ListItemGeometry,
    type QuickListLayoutMode,
} from "./quickListBoardUtils";

export interface DragPayload {
    kind: "group" | "category";
    id: string;
    name: string;
    filepath?: string;
    count?: number;
    isRoot?: boolean;
}

export interface DragControllerState {
    isPointerDragging: boolean;
    isForbiddenGroupDrag: boolean;
    isDraggingGroup: boolean;
    draggedListId: string;
    activeDragPayload: DragPayload | null;
    ghostX: number;
    ghostY: number;
    ghostWidth: number;
    dropTarget: BoardDropTarget;
    activeEdgeDirection: string | null;
}

export interface QuickListDragHost {
    getLayoutMode(): QuickListLayoutMode;
    isGridLayout(): boolean;
    getBoardEl(): HTMLElement | null;
    getListPaneEl(): HTMLElement | null;
    getModalContainerEl(): HTMLElement | null;
    getLayoutColumns(): GridCardData[][];
    getRootCount(): number;
    getEditingItemId(): string;
    collectBoardGeometry(draggedId: string): {
        columns: ColumnGeometry[];
        newColDropzoneRect: DOMRect | null;
    };
    collectClassicListGeometry(draggedId: string): {
        groups: ClassicGroupGeometry[];
        allListItems: ListItemGeometry[];
    };
    onStateChange(state: DragControllerState): void;
    onForbiddenGroupDrag(): void;
    onCommitDrop(payload: DragPayload, target: BoardDropTarget): Promise<void>;
    onDragSessionEnded(): void;
}

interface PendingDrag {
    payload: DragPayload;
    startX: number;
    startY: number;
    pointerOffsetX: number;
    pointerOffsetY: number;
    ghostWidth: number;
}

const DRAG_THRESHOLD_PX = 6;
const EDGE_PAN_THRESHOLD = 56;
const POST_DRAG_CLICK_SHIELD_MS = 80;

export function isInteractiveDragExclusionTarget(targetEl: HTMLElement | null): boolean {
    if (!targetEl) return false;
    return Boolean(
        targetEl.closest(".quick-modal-inline-rename-input") ||
        targetEl.closest(".focused-list-item-checkbox")
    );
}

export class QuickListDragController {
    private host: QuickListDragHost;
    private pendingDrag: PendingDrag | null = null;
    private activePointerId: number | null = null;
    private capturedEl: HTMLElement | null = null;
    private state: DragControllerState = {
        isPointerDragging: false,
        isForbiddenGroupDrag: false,
        isDraggingGroup: false,
        draggedListId: "",
        activeDragPayload: null,
        ghostX: 0,
        ghostY: 0,
        ghostWidth: 240,
        dropTarget: { kind: "none" },
        activeEdgeDirection: null,
    };

    private lastClientX = 0;
    private lastClientY = 0;
    private edgeRafId: number | null = null;
    private edgeScrollVx = 0;
    private edgeScrollVy = 0;
    private activeClickShield: ((ev: MouseEvent) => void) | null = null;
    private clickShieldTimer: number | null = null;
    private suppressClickUntil = 0;
    private initialTargetRafId: number | null = null;

    constructor(host: QuickListDragHost) {
        this.host = host;
    }

    isSessionActive(): boolean {
        return Boolean(this.pendingDrag || this.state.isPointerDragging || this.state.isForbiddenGroupDrag);
    }

    wasDragJustPerformed(): boolean {
        return performance.now() < this.suppressClickUntil;
    }

    beginCandidate(e: PointerEvent, payload: DragPayload, sourceEl: HTMLElement | null): void {
        if (e.isPrimary === false || e.button !== 0) return;
        const targetEl = e.target as HTMLElement | null;
        if (isInteractiveDragExclusionTarget(targetEl)) return;

        const editingId = this.host.getEditingItemId();
        if (editingId && (editingId === payload.id || (payload.filepath && editingId === payload.filepath))) {
            return;
        }

        // In Grid/List mode, virtual "Lists" root card is non-draggable without triggering a group warning.
        if (payload.isRoot && this.host.getLayoutMode() !== "table") return;
        if (!sourceEl) return;

        if (this.isSessionActive()) {
            this.stopSession();
        }
        this.clearClickShield();

        const rect = sourceEl.getBoundingClientRect();
        this.activePointerId = e.pointerId;
        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;
        this.pendingDrag = {
            payload,
            startX: e.clientX,
            startY: e.clientY,
            pointerOffsetX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
            pointerOffsetY: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
            ghostWidth: Math.max(160, Math.min(340, rect.width)),
        };

        window.addEventListener("pointermove", this.handleWindowPointerMove, true);
        window.addEventListener("pointerup", this.handleWindowPointerUp, true);
        window.addEventListener("pointercancel", this.handleWindowPointerCancel, true);
        window.addEventListener("blur", this.handleWindowBlur);
        window.addEventListener("keydown", this.handleWindowEscape, true);
    }

    destroy(): void {
        this.stopSession();
        this.clearClickShield();
    }

    private emitState(): void {
        this.host.onStateChange({ ...this.state });
    }

    private clearClickShield(): void {
        this.suppressClickUntil = 0;
        if (this.activeClickShield) {
            window.removeEventListener("click", this.activeClickShield, true);
            this.activeClickShield = null;
        }
        if (this.clickShieldTimer !== null) {
            window.clearTimeout(this.clickShieldTimer);
            this.clickShieldTimer = null;
        }
    }

    private installPostDragClickShield(): void {
        this.clearClickShield();
        this.suppressClickUntil = performance.now() + POST_DRAG_CLICK_SHIELD_MS;
        const shield = (ev: MouseEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            this.clearClickShield();
        };
        this.activeClickShield = shield;
        window.addEventListener("click", shield, true);
        this.clickShieldTimer = window.setTimeout(() => {
            this.clearClickShield();
        }, POST_DRAG_CLICK_SHIELD_MS);
    }

    private acquirePointerCapture(pointerId: number): void {
        const containerEl = this.host.getModalContainerEl();
        if (!containerEl || typeof containerEl.setPointerCapture !== "function") return;
        try {
            containerEl.setPointerCapture(pointerId);
            this.capturedEl = containerEl;
        } catch {
            this.capturedEl = null;
        }
    }

    private releasePointerCapture(pointerId: number | null): void {
        const el = this.capturedEl;
        this.capturedEl = null;
        if (!el) return;
        if (pointerId !== null && typeof el.releasePointerCapture === "function") {
            try {
                if (typeof el.hasPointerCapture !== "function" || el.hasPointerCapture(pointerId)) {
                    el.releasePointerCapture(pointerId);
                }
            } catch {
                // Ignore if browser already released capture
            }
        }
    }

    private stopEdgePanning(): void {
        if (this.edgeRafId !== null) {
            window.cancelAnimationFrame(this.edgeRafId);
            this.edgeRafId = null;
        }
        this.edgeScrollVx = 0;
        this.edgeScrollVy = 0;
        if (this.state.activeEdgeDirection !== null) {
            this.state.activeEdgeDirection = null;
            this.emitState();
        }
    }

    private updateEdgePanning(clientX: number, clientY: number): void {
        const boardEl = this.host.getBoardEl();
        if (!boardEl || this.host.getLayoutMode() !== "table") {
            this.stopEdgePanning();
            return;
        }

        const pan = computeEdgePan(
            clientX,
            clientY,
            boardEl.getBoundingClientRect(),
            {
                scrollLeft: boardEl.scrollLeft,
                scrollTop: boardEl.scrollTop,
                clientWidth: boardEl.clientWidth,
                clientHeight: boardEl.clientHeight,
                scrollWidth: boardEl.scrollWidth,
                scrollHeight: boardEl.scrollHeight,
            },
            window.innerWidth,
            window.innerHeight,
            EDGE_PAN_THRESHOLD
        );

        const dirChanged = this.state.activeEdgeDirection !== pan.direction;
        this.state.activeEdgeDirection = pan.direction;
        this.edgeScrollVx = pan.vx;
        this.edgeScrollVy = pan.vy;
        if (dirChanged) {
            this.emitState();
        }

        if (this.edgeScrollVx !== 0 || this.edgeScrollVy !== 0) {
            if (this.edgeRafId === null) {
                this.edgeRafId = window.requestAnimationFrame(this.edgePanStep);
            }
        } else if (this.edgeRafId !== null) {
            window.cancelAnimationFrame(this.edgeRafId);
            this.edgeRafId = null;
        }
    }

    private edgePanStep = (): void => {
        const boardEl = this.host.getBoardEl();
        if (!boardEl || (this.edgeScrollVx === 0 && this.edgeScrollVy === 0)) {
            this.edgeRafId = null;
            return;
        }

        if (this.edgeScrollVx < 0 && boardEl.scrollLeft <= 0) {
            this.edgeScrollVx = 0;
        } else if (this.edgeScrollVx > 0 && boardEl.scrollLeft + boardEl.clientWidth >= boardEl.scrollWidth - 1) {
            this.edgeScrollVx = 0;
        }

        if (this.edgeScrollVy < 0 && boardEl.scrollTop <= 0) {
            this.edgeScrollVy = 0;
        } else if (this.edgeScrollVy > 0 && boardEl.scrollTop + boardEl.clientHeight >= boardEl.scrollHeight - 1) {
            this.edgeScrollVy = 0;
        }

        if (this.edgeScrollVx === 0 && this.edgeScrollVy === 0) {
            this.edgeRafId = null;
            return;
        }

        boardEl.scrollLeft += this.edgeScrollVx;
        boardEl.scrollTop += this.edgeScrollVy;
        if (this.state.isPointerDragging) {
            this.refreshDropTarget(this.lastClientX, this.lastClientY);
        }
        this.edgeRafId = window.requestAnimationFrame(this.edgePanStep);
    };

    private refreshDropTarget(clientX: number, clientY: number): void {
        const payload = this.state.activeDragPayload;
        if (!this.state.isPointerDragging || !payload) {
            if (this.state.dropTarget.kind !== "none") {
                this.state.dropTarget = { kind: "none" };
                this.emitState();
            }
            return;
        }

        const dragKind = payload.kind === "group" ? "group" : "list";
        const boardEl = this.host.getBoardEl();
        const listPaneEl = this.host.getListPaneEl();
        let nextTarget: BoardDropTarget = { kind: "none" };

        if (this.host.isGridLayout() && boardEl) {
            const { columns, newColDropzoneRect } = this.host.collectBoardGeometry(payload.id);
            nextTarget = resolveBoardPointerTarget({
                clientX,
                clientY,
                dragKind,
                draggedId: payload.id,
                layoutMode: this.host.getLayoutMode(),
                layoutColumns: this.host.getLayoutColumns(),
                boardRect: boardEl.getBoundingClientRect(),
                columns,
                newColDropzoneRect,
                rootCount: this.host.getRootCount(),
            });
        } else if (!this.host.isGridLayout() && listPaneEl && dragKind === "list") {
            const { groups, allListItems } = this.host.collectClassicListGeometry(payload.id);
            nextTarget = resolveClassicListPointerTarget({
                clientX,
                clientY,
                draggedId: payload.id,
                paneRect: listPaneEl.getBoundingClientRect(),
                groups,
                allListItems,
            });
        }

        this.state.dropTarget = nextTarget;
        this.emitState();
    }

    private detachWindowListeners(): void {
        window.removeEventListener("pointermove", this.handleWindowPointerMove, true);
        window.removeEventListener("pointerup", this.handleWindowPointerUp, true);
        window.removeEventListener("pointercancel", this.handleWindowPointerCancel, true);
        window.removeEventListener("blur", this.handleWindowBlur);
        window.removeEventListener("wheel", this.handleDragWheel, true);
        window.removeEventListener("keydown", this.handleWindowEscape, true);
    }

    private stopSession(): void {
        const pointerId = this.activePointerId;
        this.activePointerId = null;
        if (this.initialTargetRafId !== null) {
            window.cancelAnimationFrame(this.initialTargetRafId);
            this.initialTargetRafId = null;
        }
        this.detachWindowListeners();
        this.releasePointerCapture(pointerId);
        this.stopEdgePanning();
        this.pendingDrag = null;
        this.state = {
            isPointerDragging: false,
            isForbiddenGroupDrag: false,
            isDraggingGroup: false,
            draggedListId: "",
            activeDragPayload: null,
            ghostX: 0,
            ghostY: 0,
            ghostWidth: 240,
            dropTarget: { kind: "none" },
            activeEdgeDirection: null,
        };
        document.body.classList.remove("fluent-tasks-quicklist-dragging");
        document.body.classList.remove("fluent-tasks-quicklist-forbidden-drag");
        this.emitState();
    }

    private handleWindowPointerMove = (e: PointerEvent): void => {
        if (!this.isSessionActive()) return;
        if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

        // If mouse button was released outside the window without delivering pointerup, cancel cleanly.
        if (e.pointerType === "mouse" && e.buttons === 0) {
            this.stopSession();
            this.host.onDragSessionEnded();
            return;
        }

        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;

        if (!this.state.isPointerDragging && !this.state.isForbiddenGroupDrag && this.pendingDrag) {
            const dx = e.clientX - this.pendingDrag.startX;
            const dy = e.clientY - this.pendingDrag.startY;
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

            const payload = this.pendingDrag.payload;
            const layoutMode = this.host.getLayoutMode();

            // Grid and List modes preserve sidebar/bin order; Table mode supports full group drag.
            if (payload.kind === "group" && layoutMode !== "table") {
                this.state.isForbiddenGroupDrag = true;
                this.state.isDraggingGroup = true;
                this.state.draggedListId = payload.id;
                document.body.classList.add("fluent-tasks-quicklist-forbidden-drag");
                this.acquirePointerCapture(e.pointerId);
                this.emitState();
                this.host.onForbiddenGroupDrag();
                return;
            }

            this.state.isPointerDragging = true;
            this.state.activeDragPayload = payload;
            this.state.isDraggingGroup = payload.kind === "group";
            this.state.draggedListId = payload.id;
            this.state.ghostWidth = this.pendingDrag.ghostWidth;
            this.state.ghostX = e.clientX - this.pendingDrag.pointerOffsetX;
            this.state.ghostY = e.clientY - this.pendingDrag.pointerOffsetY;

            window.getSelection()?.removeAllRanges();
            document.body.classList.add("fluent-tasks-quicklist-dragging");
            this.acquirePointerCapture(e.pointerId);
            window.addEventListener("wheel", this.handleDragWheel, { capture: true, passive: false });
            this.emitState();

            if (this.initialTargetRafId !== null) {
                window.cancelAnimationFrame(this.initialTargetRafId);
            }
            this.initialTargetRafId = window.requestAnimationFrame(() => {
                this.initialTargetRafId = null;
                if (this.state.isPointerDragging) {
                    this.refreshDropTarget(this.lastClientX, this.lastClientY);
                }
            });
        }

        if (this.state.isForbiddenGroupDrag) {
            e.preventDefault();
            return;
        }

        if (!this.state.isPointerDragging || !this.pendingDrag) return;
        e.preventDefault();
        this.state.ghostX = e.clientX - this.pendingDrag.pointerOffsetX;
        this.state.ghostY = e.clientY - this.pendingDrag.pointerOffsetY;

        if (this.host.getLayoutMode() === "table") {
            this.updateEdgePanning(e.clientX, e.clientY);
        }
        this.refreshDropTarget(e.clientX, e.clientY);
    };

    private handleWindowPointerUp = async (e: PointerEvent): Promise<void> => {
        if (!this.isSessionActive()) return;
        if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;

        if (!this.state.isPointerDragging) {
            if (this.state.isForbiddenGroupDrag) {
                e.preventDefault();
                e.stopPropagation();
                this.installPostDragClickShield();
            }
            this.stopSession();
            this.host.onDragSessionEnded();
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        this.installPostDragClickShield();

        const payload = this.state.activeDragPayload;
        this.refreshDropTarget(e.clientX, e.clientY);
        const committedTarget = this.state.dropTarget;

        this.stopSession();

        try {
            if (payload && committedTarget.kind !== "none") {
                await this.host.onCommitDrop(payload, committedTarget);
            }
        } catch (err) {
            console.error("[QuickListDragController] Drop commit failed:", err);
        } finally {
            this.host.onDragSessionEnded();
        }
    };

    private handleWindowPointerCancel = (e: PointerEvent): void => {
        if (!this.isSessionActive()) return;
        if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
        this.stopSession();
        this.host.onDragSessionEnded();
    };

    private handleWindowBlur = (): void => {
        if (!this.isSessionActive()) return;
        this.stopSession();
        this.host.onDragSessionEnded();
    };

    private handleWindowEscape = (e: KeyboardEvent): void => {
        if (e.key === "Escape" && this.isSessionActive()) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.stopSession();
            this.host.onDragSessionEnded();
        }
    };

    private handleDragWheel = (e: WheelEvent): void => {
        if (!this.state.isPointerDragging) return;
        const boardEl = this.host.getBoardEl();
        const listPaneEl = this.host.getListPaneEl();
        const isGrid = this.host.isGridLayout();
        const container = isGrid ? boardEl : listPaneEl;
        if (!container) return;

        e.preventDefault();
        e.stopPropagation();

        if (isGrid && boardEl) {
            if (e.shiftKey) {
                if (boardEl.scrollWidth > boardEl.clientWidth) {
                    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                    if (delta !== 0) {
                        boardEl.scrollLeft += delta;
                    }
                }
            } else if (e.deltaY !== 0) {
                boardEl.scrollTop += e.deltaY;
            }
        } else if (listPaneEl && e.deltaY !== 0) {
            listPaneEl.scrollTop += e.deltaY;
        }

        this.refreshDropTarget(this.lastClientX, this.lastClientY);
    };
}
