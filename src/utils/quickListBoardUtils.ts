import type { CategoryInfo, GroupInfo, SidebarItem } from "../types";
import { resolveUniqueName } from "./sidebarTreeUtils";

export type QuickListLayoutMode = "grid" | "table" | "list";
export type TablePositionsMap = Record<string, [number, number]>;
export type ColumnTitlesMap = Record<string, string>;

export interface GridCardData {
    id: string;
    type: "root" | "group";
    name: string;
    group?: GroupInfo;
    items?: CategoryInfo[];
    height: number;
}

export interface RectLike {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface ListItemGeometry {
    id: string;
    rect: RectLike;
}

export interface CardGeometry {
    id: string;
    type: "root" | "group";
    isExpanded: boolean;
    itemsCount: number;
    containsDragged?: boolean;
    rect: RectLike;
    items: ListItemGeometry[];
}

export interface ColumnGeometry {
    colIdx: number;
    rect: RectLike;
    cards: CardGeometry[];
    bottomDropzoneRect?: RectLike | null;
}

export interface ClassicGroupGeometry {
    id: string;
    itemsCount: number;
    isExpanded: boolean;
    containsDragged?: boolean;
    rect: RectLike;
    headerRect: RectLike;
    items: ListItemGeometry[];
}

export type BoardDropTarget =
    | { kind: "none" }
    | { kind: "card-slot"; cardId: string; position: "top" | "bottom" }
    | { kind: "col-bottom"; colIdx: number }
    | { kind: "col-insert"; colIdx: number; lineX: number; lineTop: number; lineHeight: number }
    | { kind: "new-col-end" }
    | { kind: "list-item"; targetId: string; position: "top" | "bottom" }
    | { kind: "group-inside"; groupId: string }
    | { kind: "root-empty" }
    | { kind: "new-group-col"; colIdx: number }
    | { kind: "new-group-new-col" };

export interface TableColumnsComputation {
    columns: GridCardData[][];
    columnKeys: number[];
    generatedInitialPositions?: TablePositionsMap;
}

export interface TableColumnMoveMeta {
    srcColIdx: number;
    srcWasSingleCard: boolean;
    insertedColIdx: number | null;
}

export interface TableMoveResult {
    columns: GridCardData[][];
    changed: boolean;
    moveMeta?: TableColumnMoveMeta;
}

export interface EdgePanResult {
    vx: number;
    vy: number;
    direction: string | null;
}

export interface ScrollBoundsLike {
    scrollLeft: number;
    scrollTop: number;
    clientWidth: number;
    clientHeight: number;
    scrollWidth: number;
    scrollHeight: number;
}

export function pointInRect(x: number, y: number, rect: RectLike, pad: number = 0): boolean {
    return (
        x >= rect.left - pad &&
        x <= rect.right + pad &&
        y >= rect.top - pad &&
        y <= rect.bottom + pad
    );
}

export function areLayoutColumnsEqual(colsA: GridCardData[][], colsB: GridCardData[][]): boolean {
    if (colsA.length !== colsB.length) return false;
    for (let i = 0; i < colsA.length; i++) {
        const colA = colsA[i];
        const colB = colsB[i];
        if (colA.length !== colB.length) return false;
        for (let j = 0; j < colA.length; j++) {
            const cardA = colA[j];
            const cardB = colB[j];
            if (cardA.id !== cardB.id) return false;
            if (cardA.name !== cardB.name) return false;
            if (cardA.group?.isExpanded !== cardB.group?.isExpanded) return false;
            if (Math.abs(cardA.height - cardB.height) > 4) return false;
            const itemsA = cardA.items || cardA.group?.items || [];
            const itemsB = cardB.items || cardB.group?.items || [];
            if (itemsA.length !== itemsB.length) return false;
            for (let k = 0; k < itemsA.length; k++) {
                if (itemsA[k].id !== itemsB[k].id) return false;
            }
        }
    }
    return true;
}

export function computeTableColumns(
    cards: GridCardData[],
    existingPositions: TablePositionsMap = {}
): TableColumnsComputation {
    const colMap = new Map<number, Array<{ card: GridCardData; row: number }>>();
    const unassigned: GridCardData[] = [];

    for (const card of cards) {
        const rawPos = existingPositions[card.id] ?? existingPositions[card.name];
        if (rawPos && Array.isArray(rawPos) && typeof rawPos[0] === "number" && typeof rawPos[1] === "number") {
            const col = Math.max(0, Math.floor(rawPos[0]));
            const row = Math.max(0, Math.floor(rawPos[1]));
            if (!colMap.has(col)) colMap.set(col, []);
            colMap.get(col)!.push({ card, row });
        } else {
            unassigned.push(card);
        }
    }

    let generatedInitialPositions: TablePositionsMap | undefined;

    if (colMap.size > 0) {
        for (const card of unassigned) {
            let minCol = 0;
            let minCount = Infinity;
            for (const [colIdx, items] of colMap.entries()) {
                if (items.length < minCount) {
                    minCount = items.length;
                    minCol = colIdx;
                }
            }
            const colItems = colMap.get(minCol)!;
            const maxRow = colItems.length > 0 ? Math.max(...colItems.map(i => i.row)) + 1 : 0;
            colItems.push({ card, row: maxRow });
        }
    } else if (cards.length > 0) {
        const targetCols = Math.min(4, Math.max(1, cards.length));
        for (let i = 0; i < cards.length; i++) {
            const col = i % targetCols;
            const row = Math.floor(i / targetCols);
            if (!colMap.has(col)) colMap.set(col, []);
            colMap.get(col)!.push({ card: cards[i], row });
        }
        const initialPositions: TablePositionsMap = {};
        for (const [c, items] of colMap.entries()) {
            for (const item of items) {
                if (item.card.id) {
                    initialPositions[item.card.id] = [c, item.row];
                }
            }
        }
        for (const [c, items] of colMap.entries()) {
            for (const item of items) {
                if (item.card.name && !Object.prototype.hasOwnProperty.call(initialPositions, item.card.name)) {
                    initialPositions[item.card.name] = [c, item.row];
                }
            }
        }
        generatedInitialPositions = initialPositions;
    }

    const sortedColIndices = Array.from(colMap.keys()).sort((a, b) => a - b);
    const columns: GridCardData[][] = [];
    const columnKeys: number[] = [];

    for (const colIdx of sortedColIndices) {
        const items = colMap.get(colIdx) || [];
        if (items.length === 0) continue;
        items.sort((a, b) => a.row - b.row);
        columns.push(items.map(i => i.card));
        columnKeys.push(colIdx);
    }

    return { columns, columnKeys, generatedInitialPositions };
}

/** Resolve column display name, defaulting to "Column N" (1-based) when unset. */
export function getColumnDisplayTitle(
    columnTitles: ColumnTitlesMap | undefined,
    colKey: number
): string {
    const custom = columnTitles?.[String(colKey)]?.trim();
    return custom || `Column ${colKey + 1}`;
}

/**
 * Remap custom column titles after a Table-mode card drag changes column indices.
 * Single-card columns moved to a new column slot preserve their title; emptied columns drop theirs.
 */
export function remapTableColumnTitles(
    prevTitles: ColumnTitlesMap | undefined,
    prevColKeys: number[],
    moveMeta: TableColumnMoveMeta | undefined
): ColumnTitlesMap {
    const sourceTitles = prevTitles || {};
    if (!moveMeta) return { ...sourceTitles };

    const { srcColIdx, srcWasSingleCard, insertedColIdx } = moveMeta;
    const prevCount = prevColKeys.length;
    const nextTitles: ColumnTitlesMap = {};

    const getTitleForOldSlot = (oldSlot: number): string | undefined => {
        const key = String(prevColKeys[oldSlot] ?? oldSlot);
        const val = sourceTitles[key]?.trim();
        return val || undefined;
    };

    if (insertedColIdx !== null) {
        let writeIdx = 0;
        for (let oldSlot = 0; oldSlot < prevCount; oldSlot++) {
            if (srcWasSingleCard && oldSlot === srcColIdx) continue;
            if (writeIdx === insertedColIdx) writeIdx++;
            const title = getTitleForOldSlot(oldSlot);
            if (title) nextTitles[String(writeIdx)] = title;
            writeIdx++;
        }
        if (srcWasSingleCard) {
            const movedTitle = getTitleForOldSlot(srcColIdx);
            if (movedTitle) nextTitles[String(insertedColIdx)] = movedTitle;
        }
    } else {
        let writeIdx = 0;
        for (let oldSlot = 0; oldSlot < prevCount; oldSlot++) {
            if (srcWasSingleCard && oldSlot === srcColIdx) continue;
            const title = getTitleForOldSlot(oldSlot);
            if (title) nextTitles[String(writeIdx)] = title;
            writeIdx++;
        }
    }

    return nextTitles;
}

export function packCardsIntoK(
    cardsToPack: GridCardData[],
    k: number,
    rowGap: number
): { items: GridCardData[]; h: number }[] {
    const safeK = Math.max(1, k);
    const maxPerCol = Math.ceil(cardsToPack.length / safeK);
    const sorted = [...cardsToPack].sort((a, b) => b.height - a.height);
    const bins = Array.from({ length: safeK }, () => ({ items: [] as GridCardData[], h: 0 }));

    for (const c of sorted) {
        let valid = bins.filter(b => b.items.length < maxPerCol);
        if (valid.length === 0) valid = bins;
        valid.sort((a, b) => a.h - b.h);
        const best = valid[0];
        const needed = best.items.length === 0 ? c.height : (c.height + rowGap);
        best.items.push(c);
        best.h += needed;
    }
    return bins;
}

export function computeGridBins(
    cards: GridCardData[],
    maxCandidateK: number,
    rowGap: number,
    targetPeakH: number,
    maxUsableH: number,
    fontScale: number
): { items: GridCardData[]; h: number }[] {
    if (cards.length === 0) return [];
    const cappedK = Math.max(1, Math.min(cards.length, maxCandidateK));
    let bestScore = Infinity;
    let bestBins: { items: GridCardData[]; h: number }[] | null = null;
    const sortedCards = [...cards].sort((a, b) => b.height - a.height);

    for (let k = cappedK; k >= 1; k--) {
        const bins: { items: GridCardData[]; h: number }[] = Array.from({ length: k }, () => ({ items: [], h: 0 }));

        for (const c of sortedCards) {
            bins.sort((a, b) => a.h - b.h);
            const underTarget = bins.filter(
                b => (b.h + (b.items.length === 0 ? c.height : c.height + rowGap)) <= targetPeakH
            );
            const chosen = underTarget.length > 0 ? underTarget[0] : bins[0];
            const needed = chosen.items.length === 0 ? c.height : (c.height + rowGap);
            chosen.items.push(c);
            chosen.h += needed;
        }

        const peakH = Math.max(...bins.map(b => b.h));
        const overflow = Math.max(0, peakH - maxUsableH);
        const overflowPenalty = overflow * 20000;
        const excess = Math.max(0, peakH - targetPeakH);
        const excessPenalty = excess * 150;
        const shortPenalty = Math.max(0, Math.round(180 * fontScale) - peakH) * 40;
        const avgH = bins.reduce((sum, b) => sum + b.h, 0) / k;
        const variance = bins.reduce((sum, b) => sum + (b.h - avgH) ** 2, 0) / k;
        const kBonus = (cappedK - k) * 60;

        const score = overflowPenalty + excessPenalty + shortPenalty + Math.sqrt(variance) * 5 + kBonus;
        if (score < bestScore) {
            bestScore = score;
            bestBins = bins;
        }
    }

    if (!bestBins) {
        bestBins = packCardsIntoK(cards, cappedK, rowGap);
    }

    const cardOrderMap = new Map(cards.map((c, i) => [c.id, i]));
    bestBins.sort((a, b) => {
        const orderA = cardOrderMap.get(a.items[0]?.id || "") ?? 0;
        const orderB = cardOrderMap.get(b.items[0]?.id || "") ?? 0;
        return orderA - orderB;
    });

    return bestBins;
}

export function buildTablePositions(
    prunedCols: GridCardData[][],
    existingPositions?: TablePositionsMap,
    preserveUnlisted: boolean = false
): TablePositionsMap {
    const positions: TablePositionsMap = {};
    const occupiedRowsByCol = new Map<number, Set<number>>();

    prunedCols.forEach((colCards, colIdx) => {
        if (!occupiedRowsByCol.has(colIdx)) {
            occupiedRowsByCol.set(colIdx, new Set<number>());
        }
        const rowSet = occupiedRowsByCol.get(colIdx)!;
        colCards.forEach((card, rowIdx) => {
            if (card.id) {
                positions[card.id] = [colIdx, rowIdx];
            }
            rowSet.add(rowIdx);
        });
    });

    prunedCols.forEach((colCards, colIdx) => {
        colCards.forEach((card, rowIdx) => {
            if (card.name && !Object.prototype.hasOwnProperty.call(positions, card.name)) {
                positions[card.name] = [colIdx, rowIdx];
            }
        });
    });

    if (preserveUnlisted && existingPositions) {
        const unlistedBuckets = new Map<string, { col: number; row: number; keys: string[] }>();
        for (const [key, coord] of Object.entries(existingPositions)) {
            if (Object.prototype.hasOwnProperty.call(positions, key)) continue;
            if (!Array.isArray(coord) || typeof coord[0] !== "number" || typeof coord[1] !== "number") continue;
            const col = Math.max(0, Math.floor(coord[0]));
            const row = Math.max(0, Math.floor(coord[1]));
            const bucketId = `${col}:${row}`;
            if (!unlistedBuckets.has(bucketId)) {
                unlistedBuckets.set(bucketId, { col, row, keys: [] });
            }
            unlistedBuckets.get(bucketId)!.keys.push(key);
        }

        const sortedBuckets = Array.from(unlistedBuckets.values()).sort((a, b) =>
            a.col !== b.col ? a.col - b.col : a.row - b.row
        );

        for (const bucket of sortedBuckets) {
            if (!occupiedRowsByCol.has(bucket.col)) {
                occupiedRowsByCol.set(bucket.col, new Set<number>());
            }
            const rowSet = occupiedRowsByCol.get(bucket.col)!;
            let assignedRow = bucket.row;
            while (rowSet.has(assignedRow)) {
                assignedRow++;
            }
            rowSet.add(assignedRow);
            for (const key of bucket.keys) {
                positions[key] = [bucket.col, assignedRow];
            }
        }
    }

    return positions;
}

function findCardCoords(
    columns: GridCardData[][],
    cardId: string
): { colIdx: number; rowIdx: number; card: GridCardData } | null {
    for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        for (let r = 0; r < col.length; r++) {
            if (col[r].id === cardId) {
                return { colIdx: c, rowIdx: r, card: col[r] };
            }
        }
    }
    return null;
}

export function moveCardInTable(
    columns: GridCardData[][],
    draggedId: string,
    targetCardId: string,
    position: "top" | "bottom" | "inside"
): TableMoveResult {
    if (!draggedId || !targetCardId || draggedId === targetCardId) {
        return { columns, changed: false };
    }
    const src = findCardCoords(columns, draggedId);
    const tgt = findCardCoords(columns, targetCardId);
    if (!src || !tgt) {
        return { columns, changed: false };
    }

    let adjTgtRow = tgt.rowIdx;
    if (src.colIdx === tgt.colIdx && src.rowIdx < tgt.rowIdx) {
        adjTgtRow--;
    }
    const insertAt = position === "top" ? adjTgtRow : adjTgtRow + 1;

    // Dropping into the identical slot produces no layout change.
    if (src.colIdx === tgt.colIdx && insertAt === src.rowIdx) {
        return { columns, changed: false };
    }

    const srcWasSingleCard = columns[src.colIdx].length === 1;
    const cols = columns.map(col => [...col]);
    cols[src.colIdx].splice(src.rowIdx, 1);
    cols[tgt.colIdx].splice(insertAt, 0, src.card);
    return {
        columns: cols.filter(c => c.length > 0),
        changed: true,
        moveMeta: { srcColIdx: src.colIdx, srcWasSingleCard, insertedColIdx: null },
    };
}

export function moveCardToColumnBottom(
    columns: GridCardData[][],
    draggedId: string,
    targetColIdx: number
): TableMoveResult {
    const src = findCardCoords(columns, draggedId);
    if (!src || targetColIdx < 0 || targetColIdx >= columns.length) {
        return { columns, changed: false };
    }

    if (src.colIdx === targetColIdx && src.rowIdx === columns[targetColIdx].length - 1) {
        return { columns, changed: false };
    }

    const srcWasSingleCard = columns[src.colIdx].length === 1;
    const cols = columns.map(col => [...col]);
    cols[src.colIdx].splice(src.rowIdx, 1);
    cols[targetColIdx].push(src.card);
    return {
        columns: cols.filter(c => c.length > 0),
        changed: true,
        moveMeta: { srcColIdx: src.colIdx, srcWasSingleCard, insertedColIdx: null },
    };
}

export function moveCardToNewColumn(
    columns: GridCardData[][],
    draggedId: string
): TableMoveResult {
    const src = findCardCoords(columns, draggedId);
    if (!src) {
        return { columns, changed: false };
    }
    if (src.colIdx === columns.length - 1 && columns[src.colIdx].length === 1) {
        return { columns, changed: false };
    }

    const srcWasSingleCard = columns[src.colIdx].length === 1;
    const cols = columns.map(col => [...col]);
    cols[src.colIdx].splice(src.rowIdx, 1);
    cols.push([src.card]);
    const finalCols = cols.filter(c => c.length > 0);
    return {
        columns: finalCols,
        changed: true,
        moveMeta: { srcColIdx: src.colIdx, srcWasSingleCard, insertedColIdx: finalCols.length - 1 },
    };
}

export function moveCardToNewColumnAt(
    columns: GridCardData[][],
    draggedId: string,
    targetColIdx: number
): TableMoveResult {
    const src = findCardCoords(columns, draggedId);
    if (!src) {
        return { columns, changed: false };
    }

    if (
        columns[src.colIdx].length === 1 &&
        (targetColIdx === src.colIdx || targetColIdx === src.colIdx + 1)
    ) {
        return { columns, changed: false };
    }

    const srcWasSingleCard = columns[src.colIdx].length === 1;
    const cols = columns.map(col => [...col]);
    cols[src.colIdx].splice(src.rowIdx, 1);

    let insertCol = targetColIdx;
    if (cols[src.colIdx].length === 0) {
        cols.splice(src.colIdx, 1);
        if (src.colIdx < insertCol) {
            insertCol = Math.max(0, insertCol - 1);
        }
    }
    insertCol = Math.max(0, Math.min(insertCol, cols.length));
    cols.splice(insertCol, 0, [src.card]);

    return {
        columns: cols,
        changed: true,
        moveMeta: { srcColIdx: src.colIdx, srcWasSingleCard, insertedColIdx: insertCol },
    };
}

export function createGroupFromListInBoard(
    sidebarItems: SidebarItem[],
    layoutColumns: GridCardData[][],
    movedId: string,
    colIdx: number,
    newGroupId: string
): { sidebarItems: SidebarItem[]; columns: GridCardData[][]; newGroup: GroupInfo } | null {
    if (!movedId) return null;

    let listToMove: CategoryInfo | null = null;
    const nextSidebar: SidebarItem[] = [];

    for (const item of sidebarItems) {
        if (item.type === "category" && (item.id === movedId || item.filepath === movedId)) {
            listToMove = item;
        } else if (item.type === "group") {
            const childIdx = item.items.findIndex(c => c.id === movedId || c.filepath === movedId);
            if (childIdx !== -1) {
                listToMove = item.items[childIdx];
                nextSidebar.push({
                    ...item,
                    items: item.items.filter(c => c.id !== movedId && c.filepath !== movedId),
                });
            } else {
                nextSidebar.push(item);
            }
        } else {
            nextSidebar.push(item);
        }
    }

    if (!listToMove) return null;

    const existingGroupNames = nextSidebar
        .filter((i): i is GroupInfo => i.type === "group")
        .map(g => g.name);
    const groupName = resolveUniqueName(existingGroupNames, listToMove.name || "New Group");

    const newGroup: GroupInfo = {
        id: newGroupId,
        type: "group",
        name: groupName,
        items: [{ ...listToMove }],
        isExpanded: true,
    };

    nextSidebar.push(newGroup);

    const nextRootCount = nextSidebar.filter(i => i.type === "category").length;
    const newCard: GridCardData = {
        id: newGroup.id,
        name: newGroup.name,
        group: newGroup,
        items: newGroup.items,
        type: "group",
        height: 60,
    };

    let cols: GridCardData[][] = layoutColumns.map(col =>
        col
            .map(c => {
                if (c.type === "root") {
                    const filteredRoot = (c.items || []).filter(i => i.id !== movedId && i.filepath !== movedId);
                    return filteredRoot.length > 0 ? { ...c, items: filteredRoot } : null;
                }
                if (c.type === "group" && c.group) {
                    const updatedGroup = nextSidebar.find(s => s.type === "group" && s.id === c.id) as GroupInfo | undefined;
                    return updatedGroup ? { ...c, group: updatedGroup, items: updatedGroup.items } : c;
                }
                return c;
            })
            .filter((c): c is GridCardData => c !== null)
    );

    if (nextRootCount === 0) {
        cols = cols.map(col => col.filter(c => c.type !== "root"));
    }

    const safeTargetCol = Math.max(0, colIdx);
    if (safeTargetCol >= cols.length) {
        cols.push([newCard]);
    } else {
        cols[safeTargetCol].push(newCard);
    }

    return {
        sidebarItems: nextSidebar,
        columns: cols.filter(c => c.length > 0),
        newGroup,
    };
}

export function calculateEdgeSpeed(dist: number, maxZone: number): number {
    const clamped = Math.max(0, Math.min(dist, maxZone));
    const factor = 1 - clamped / maxZone;
    return Math.round(8 + factor * 22);
}

export function computeEdgePan(
    clientX: number,
    clientY: number,
    boardRect: RectLike,
    scroll: ScrollBoundsLike,
    viewportWidth: number,
    viewportHeight: number,
    threshold: number = 56
): EdgePanResult {
    if (clientX <= 0 && clientY <= 0) {
        return { vx: 0, vy: 0, direction: null };
    }
    if (
        clientX < boardRect.left - 60 ||
        clientX > boardRect.right + 60 ||
        clientY < boardRect.top - 60 ||
        clientY > boardRect.bottom + 60
    ) {
        return { vx: 0, vy: 0, direction: null };
    }

    const distLeft = clientX - boardRect.left;
    const distRight = boardRect.right - clientX;
    const distTop = clientY - boardRect.top;
    const distBottom = boardRect.bottom - clientY;

    const canScrollLeft = scroll.scrollLeft > 1;
    const canScrollRight = scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 2;
    const canScrollUp = scroll.scrollTop > 1;
    const canScrollDown = scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 2;

    let vx = 0;
    let vy = 0;
    let dirX: "left" | "right" | null = null;
    let dirY: "up" | "down" | null = null;

    if (distLeft <= threshold && clientX >= 0) {
        dirX = "left";
        if (canScrollLeft) {
            vx = -calculateEdgeSpeed(Math.max(0, distLeft), threshold);
        }
    } else if (distRight <= threshold && clientX <= viewportWidth) {
        dirX = "right";
        if (canScrollRight) {
            vx = calculateEdgeSpeed(Math.max(0, distRight), threshold);
        }
    }

    if (distTop <= threshold && clientY >= 0) {
        dirY = "up";
        if (canScrollUp) {
            vy = -calculateEdgeSpeed(Math.max(0, distTop), threshold);
        }
    } else if (distBottom <= threshold && clientY <= viewportHeight) {
        dirY = "down";
        if (canScrollDown) {
            vy = calculateEdgeSpeed(Math.max(0, distBottom), threshold);
        }
    }

    let direction: string | null = null;
    if (dirX && dirY) direction = `${dirY}-${dirX}`;
    else if (dirX) direction = dirX;
    else if (dirY) direction = dirY;

    return { vx, vy, direction };
}

export function resolveListChildDropTargetFromRects(
    clientY: number,
    items: ListItemGeometry[],
    draggedId?: string
): { targetId: string; position: "top" | "bottom" } | null {
    if (!items || items.length === 0) return null;

    let resolved: { targetId: string; position: "top" | "bottom" };

    const firstRect = items[0].rect;
    if (clientY < firstRect.top + firstRect.height * 0.5) {
        resolved = { targetId: items[0].id, position: "top" };
    } else {
        let matched: { targetId: string; position: "top" | "bottom" } | null = null;
        for (let i = 0; i < items.length - 1; i++) {
            const rectA = items[i].rect;
            const rectB = items[i + 1].rect;
            const gapMid = (rectA.bottom + rectB.top) * 0.5;
            const midB = rectB.top + rectB.height * 0.5;

            if (clientY <= gapMid) {
                matched = { targetId: items[i].id, position: "bottom" };
                break;
            }
            if (clientY < midB) {
                matched = { targetId: items[i + 1].id, position: "top" };
                break;
            }
        }
        if (matched) {
            resolved = matched;
        } else {
            const last = items[items.length - 1];
            resolved = { targetId: last.id, position: "bottom" };
        }
    }

    if (!draggedId) return resolved;
    if (resolved.targetId === draggedId) return null;

    // Suppress redundant adjacent indicators when dragging an item right next to its own slot.
    const dragIdx = items.findIndex(item => item.id === draggedId);
    if (dragIdx !== -1) {
        if (resolved.position === "bottom" && dragIdx > 0 && resolved.targetId === items[dragIdx - 1].id) {
            return null;
        }
        if (resolved.position === "top" && dragIdx < items.length - 1 && resolved.targetId === items[dragIdx + 1].id) {
            return null;
        }
    }

    return resolved;
}

export function resolveBoardPointerTarget(params: {
    clientX: number;
    clientY: number;
    dragKind: "group" | "list";
    draggedId: string;
    layoutMode: QuickListLayoutMode;
    layoutColumns: GridCardData[][];
    boardRect: RectLike;
    columns: ColumnGeometry[];
    newColDropzoneRect?: RectLike | null;
    rootCount: number;
}): BoardDropTarget {
    const {
        clientX,
        clientY,
        dragKind,
        draggedId,
        layoutMode,
        layoutColumns,
        boardRect,
        columns,
        newColDropzoneRect,
        rootCount,
    } = params;

    if (!draggedId || !pointInRect(clientX, clientY, boardRect, 12)) {
        return { kind: "none" };
    }

    if (dragKind === "group") {
        if (layoutMode !== "table") {
            return { kind: "none" };
        }

        // Dropping anywhere inside the source card's own bounding box is always a clean no-op,
        // even near its left/right edges where an inter-column corridor tolerance overlaps.
        for (const col of columns) {
            const ownCard = col.cards.find(card => card.id === draggedId);
            if (ownCard && pointInRect(clientX, clientY, ownCard.rect, 0)) {
                return { kind: "none" };
            }
        }

        if (newColDropzoneRect && pointInRect(clientX, clientY, newColDropzoneRect, 2)) {
            const res = moveCardToNewColumn(layoutColumns, draggedId);
            return res.changed ? { kind: "new-col-end" } : { kind: "none" };
        }

        const isInsideColSurface = (col: ColumnGeometry): boolean =>
            Boolean(col.bottomDropzoneRect && pointInRect(clientX, clientY, col.bottomDropzoneRect, 0)) ||
            col.cards.some(card => pointInRect(clientX, clientY, card.rect, 0));

        // Check inter-column insertion corridors (0..columns.length - 1) without shifting flex layout
        // and without stealing pointer hits strictly inside a neighboring card or bottom dropzone.
        if (columns.length > 0) {
            const firstCol = columns[0];
            if (
                clientX >= Math.max(boardRect.left - 8, firstCol.rect.left - 24) &&
                clientX <= firstCol.rect.left + 2 &&
                clientY >= boardRect.top &&
                clientY <= boardRect.bottom &&
                (clientX < firstCol.rect.left || !isInsideColSurface(firstCol))
            ) {
                const res = moveCardToNewColumnAt(layoutColumns, draggedId, 0);
                if (res.changed) {
                    const lineX = Math.max(boardRect.left + 4, firstCol.rect.left - 8);
                    const lineTop = firstCol.cards.length > 0 ? firstCol.cards[0].rect.top : firstCol.rect.top;
                    const lineBottom = firstCol.cards.length > 0
                        ? firstCol.cards[firstCol.cards.length - 1].rect.bottom
                        : firstCol.rect.bottom;
                    return {
                        kind: "col-insert",
                        colIdx: 0,
                        lineX,
                        lineTop,
                        lineHeight: Math.max(180, lineBottom - lineTop),
                    };
                }
            }

            for (let c = 1; c < columns.length; c++) {
                const prev = columns[c - 1];
                const curr = columns[c];
                if (
                    clientX >= prev.rect.right - 3 &&
                    clientX <= curr.rect.left + 3 &&
                    clientY >= boardRect.top &&
                    clientY <= boardRect.bottom &&
                    ((clientX > prev.rect.right && clientX < curr.rect.left) ||
                        (!isInsideColSurface(prev) && !isInsideColSurface(curr)))
                ) {
                    const res = moveCardToNewColumnAt(layoutColumns, draggedId, c);
                    if (res.changed) {
                        const prevTop = prev.cards.length > 0 ? prev.cards[0].rect.top : prev.rect.top;
                        const currTop = curr.cards.length > 0 ? curr.cards[0].rect.top : curr.rect.top;
                        const prevBot = prev.cards.length > 0 ? prev.cards[prev.cards.length - 1].rect.bottom : prev.rect.bottom;
                        const currBot = curr.cards.length > 0 ? curr.cards[curr.cards.length - 1].rect.bottom : curr.rect.bottom;
                        const lineTop = Math.min(prevTop, currTop);
                        const lineBottom = Math.max(prevBot, currBot);
                        return {
                            kind: "col-insert",
                            colIdx: c,
                            lineX: (prev.rect.right + curr.rect.left) * 0.5,
                            lineTop,
                            lineHeight: Math.max(180, lineBottom - lineTop),
                        };
                    }
                }
            }
        }

        // Check column dropzones & cards
        for (const col of columns) {
            if (col.bottomDropzoneRect && pointInRect(clientX, clientY, col.bottomDropzoneRect, 2)) {
                const res = moveCardToColumnBottom(layoutColumns, draggedId, col.colIdx);
                return res.changed ? { kind: "col-bottom", colIdx: col.colIdx } : { kind: "none" };
            }

            if (clientX >= col.rect.left - 4 && clientX <= col.rect.right + 4) {
                const ownCard = col.cards.find(card => card.id === draggedId);
                if (ownCard && pointInRect(clientX, clientY, ownCard.rect, 0)) {
                    // Explicitly dropping back onto the source card is always a clean no-op.
                    return { kind: "none" };
                }

                let closestCardId = "";
                let closestPos: "top" | "bottom" = "bottom";
                let minDist = Infinity;

                for (const card of col.cards) {
                    if (card.id === draggedId) continue;
                    const rect = card.rect;
                    if (clientY >= rect.top && clientY <= rect.bottom) {
                        closestCardId = card.id;
                        closestPos = clientY - rect.top < rect.height * 0.5 ? "top" : "bottom";
                        minDist = 0;
                        break;
                    }
                    const distTop = Math.abs(clientY - rect.top);
                    if (distTop < minDist) {
                        minDist = distTop;
                        closestCardId = card.id;
                        closestPos = "top";
                    }
                    const distBottom = Math.abs(clientY - rect.bottom);
                    if (distBottom < minDist) {
                        minDist = distBottom;
                        closestCardId = card.id;
                        closestPos = "bottom";
                    }
                }

                if (closestCardId) {
                    const res = moveCardInTable(layoutColumns, draggedId, closestCardId, closestPos);
                    return res.changed
                        ? { kind: "card-slot", cardId: closestCardId, position: closestPos }
                        : { kind: "none" };
                }
            }
        }

        return { kind: "none" };
    }

    // dragKind === "list"
    if (layoutMode === "table") {
        if (newColDropzoneRect && pointInRect(clientX, clientY, newColDropzoneRect, 2)) {
            return { kind: "new-group-new-col" };
        }
        for (const col of columns) {
            if (col.bottomDropzoneRect && pointInRect(clientX, clientY, col.bottomDropzoneRect, 2)) {
                return { kind: "new-group-col", colIdx: col.colIdx };
            }
        }
    }

    for (const col of columns) {
        for (const card of col.cards) {
            if (!pointInRect(clientX, clientY, card.rect, 2)) continue;

            if (card.type === "root") {
                if (rootCount === 0 || card.items.length === 0) {
                    return { kind: "root-empty" };
                }
                const resolved = resolveListChildDropTargetFromRects(clientY, card.items, draggedId);
                return resolved
                    ? { kind: "list-item", targetId: resolved.targetId, position: resolved.position }
                    : { kind: "none" };
            }

            if (card.itemsCount === 0 || !card.isExpanded) {
                if (card.containsDragged) {
                    return { kind: "none" };
                }
                return { kind: "group-inside", groupId: card.id };
            }

            if (card.items.length === 0) {
                return { kind: "none" };
            }

            const resolved = resolveListChildDropTargetFromRects(clientY, card.items, draggedId);
            return resolved
                ? { kind: "list-item", targetId: resolved.targetId, position: resolved.position }
                : { kind: "none" };
        }
    }

    return { kind: "none" };
}

export function resolveClassicListPointerTarget(params: {
    clientX: number;
    clientY: number;
    draggedId: string;
    paneRect: RectLike;
    groups: ClassicGroupGeometry[];
    allListItems: ListItemGeometry[];
}): BoardDropTarget {
    const { clientX, clientY, draggedId, paneRect, groups, allListItems } = params;

    if (!draggedId || !pointInRect(clientX, clientY, paneRect, 8)) {
        return { kind: "none" };
    }

    for (const grp of groups) {
        if ((grp.itemsCount === 0 || !grp.isExpanded) && pointInRect(clientX, clientY, grp.rect, 0)) {
            if (grp.containsDragged) return { kind: "none" };
            return { kind: "group-inside", groupId: grp.id };
        }
        if (pointInRect(clientX, clientY, grp.headerRect, 0)) {
            if (grp.isExpanded && grp.items.length > 0) {
                const resolved = resolveListChildDropTargetFromRects(clientY, grp.items, draggedId);
                return resolved
                    ? { kind: "list-item", targetId: resolved.targetId, position: resolved.position }
                    : { kind: "none" };
            }
            if (!grp.containsDragged) {
                return { kind: "group-inside", groupId: grp.id };
            }
            return { kind: "none" };
        }
    }

    for (let i = 0; i < allListItems.length; i++) {
        const item = allListItems[i];
        if (!pointInRect(clientX, clientY, item.rect, 2)) continue;
        if (item.id === draggedId) return { kind: "none" };
        const midY = item.rect.top + item.rect.height * 0.5;
        const pos: "top" | "bottom" = clientY < midY ? "top" : "bottom";

        // Suppress redundant neighbor indicator if pointer is right next to dragged item
        const dragIdx = allListItems.findIndex(x => x.id === draggedId);
        if (dragIdx !== -1) {
            if (pos === "bottom" && dragIdx > 0 && item.id === allListItems[dragIdx - 1].id) {
                return { kind: "none" };
            }
            if (pos === "top" && dragIdx < allListItems.length - 1 && item.id === allListItems[dragIdx + 1].id) {
                return { kind: "none" };
            }
        }
        return { kind: "list-item", targetId: item.id, position: pos };
    }

    return { kind: "none" };
}
