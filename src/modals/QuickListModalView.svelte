<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { DataService } from "../DataService";
    import { EventBus } from "../EventBus";
    import { EventName, VIEW_TYPE_MAIN, STARRED_CATEGORY_PATH, STARRED_CATEGORY_NAME, makeFocusedGroupKey } from "../types";
    import type { CategoryInfo, SidebarItem, GroupInfo, TaskItem } from "../types";
    import { toggleGroupExpandedState, getFlatCategories, filterSidebarTree, moveSidebarItem, resolveUniqueName } from "../utils/sidebarTreeUtils";
    import { INPUT_FOCUS_DELAY_MS } from "../constants";
    import { Menu, Notice } from "obsidian";
    import type { App } from "obsidian";
    import { t, isChinese } from "../lang/helpers";
    import { isQuickListHotkeyAssigned, openHotkeySettingsForQuickList } from "../utils/hotkeyUtils";
    import { portal } from "../utils/domUtils";
    import {
        areLayoutColumnsEqual,
        buildTablePositions,
        computeGridBins,
        computeTableColumns,
        createGroupFromListInBoard,
        getColumnDisplayTitle,
        moveCardInTable,
        moveCardToColumnBottom,
        moveCardToNewColumn,
        moveCardToNewColumnAt,
        remapTableColumnTitles,
        type BoardDropTarget,
        type ClassicGroupGeometry,
        type ColumnGeometry,
        type ColumnTitlesMap,
        type GridCardData,
        type ListItemGeometry,
        type QuickListLayoutMode,
        type TablePositionsMap,
    } from "../utils/quickListBoardUtils";
    import {
        QuickListDragController,
        type DragPayload,
        type DragControllerState,
    } from "../utils/quickListDragController";

    // =============================================
    // Props
    // =============================================
    export let app: App;
    export let plugin: any = null;
    export let dataService: DataService;
    export let showTip: boolean = false;
    export let remainingTips: number = 0;
    export let isFocusedListMode: boolean = false;
    export let closeModal: () => void = () => {};

    // =============================================
    // State
    // =============================================
    let sidebarItems: SidebarItem[] = [];
    let categories: CategoryInfo[] = [];
    let taskCounts: Record<string, number> = {};
    let starredCount: number = 0;
    let searchQuery: string = "";
    let focusedIndex: number = -1;
    let layoutMode: QuickListLayoutMode = plugin?.settings?.quickListLayoutMode ?? (plugin?.settings?.quickListGridLayout === false ? 'list' : 'grid');
    $: isGridLayout = layoutMode !== 'list';
    let searchMode: 'list' | 'task' = isFocusedListMode ? 'list' : (plugin?.settings?.quickListSearchMode ?? 'list');
    let hideCompleted: boolean = plugin?.settings?.searchHideCompleted ?? true;
    let taskSearchResults: Array<{ task: TaskItem; category: CategoryInfo; matchField: string }> = [];
    let taskFocusedIndex: number = 0;
    let isSearchingTasks: boolean = false;
    let searchDebounceTimer: any = null;
    let taskResultsContainerEl: HTMLElement | null = null;
    let isComposing: boolean = false;
    let hasInitializedFocus: boolean = false;
    let isDataLoaded: boolean = false;
    let prevSearchQuery: string = "";
    let isPickingDefaultFocus: boolean = false;
    let showFocusPopover: boolean = false;
    let showHelpModal: boolean = false;
    let titleAlignment: 'center' | 'left' = plugin?.settings?.quickListTitleAlignment ?? 'center';
    let hideLeftSidebar: boolean = plugin?.settings?.hideLeftSidebar ?? false;
    let minimalPlaceholders: boolean = plugin?.settings?.minimalPlaceholders ?? false;
    let hasFloatingModalHotkey: boolean = true;
    $: showNoHotkeyWarning = hideLeftSidebar && !hasFloatingModalHotkey;

    // Focused Lists state (auto-save on click, clear all)
    let focusedListSet: Set<string> = new Set(plugin?.settings?.focusedLists || []);

    async function toggleFocusedList(filepath: string) {
        if (focusedListSet.has(filepath)) {
            focusedListSet.delete(filepath);
        } else {
            focusedListSet.add(filepath);
        }
        focusedListSet = new Set(focusedListSet);
        if (plugin?.settings) {
            plugin.settings.focusedLists = Array.from(focusedListSet);
            await plugin.saveSettings();
            EventBus.emit(EventName.SETTINGS_CHANGED, plugin.settings);
        }
    }

    async function toggleFocusedGroup(groupId: string) {
        await toggleFocusedList(makeFocusedGroupKey(groupId));
    }

    async function handleClearAllFocused() {
        if (focusedListSet.size === 0) return;
        focusedListSet.clear();
        focusedListSet = new Set();
        if (plugin?.settings) {
            plugin.settings.focusedLists = [];
            await plugin.saveSettings();
            EventBus.emit(EventName.SETTINGS_CHANGED, plugin.settings);
        }
    }

    function checkHotkeyStatus() {
        hideLeftSidebar = plugin?.settings?.hideLeftSidebar ?? false;
        if (app) {
            hasFloatingModalHotkey = isQuickListHotkeyAssigned(app);
        }
    }

    function handleOpenHotkeySettings() {
        if (app) {
            openHotkeySettingsForQuickList(app);
        }
    }

    function handleBoardWheel(e: WheelEvent) {
        const board = e.currentTarget as HTMLElement;
        if (!board) return;

        // Horizontal scroll strictly requires holding Shift
        if (e.shiftKey) {
            if (board.scrollWidth > board.clientWidth) {
                const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                if (delta !== 0) {
                    board.scrollLeft += delta;
                }
            }
            e.preventDefault();
            return;
        }

        // If hovering over an inner scrollable list container, let it scroll its own content vertically
        const target = e.target as HTMLElement | null;
        const cardItems = target?.closest(".quick-grid-card-items") as HTMLElement | null;
        if (cardItems && cardItems.scrollHeight > cardItems.clientHeight) {
            const canScrollDown = e.deltaY > 0 && cardItems.scrollTop + cardItems.clientHeight < cardItems.scrollHeight - 1;
            const canScrollUp = e.deltaY < 0 && cardItems.scrollTop > 1;
            if (canScrollDown || canScrollUp) {
                return;
            }
        }

        // Without Shift, only scroll vertically (never fall back to horizontal scrolling at boundaries)
        if (e.deltaY !== 0) {
            board.scrollTop += e.deltaY;
            e.preventDefault();
        } else if (e.deltaX !== 0) {
            e.preventDefault();
        }
    }

    function handleCompositionStart() {
        isComposing = true;
    }

    function handleCompositionEnd(e: CompositionEvent) {
        isComposing = false;
        searchQuery = (e.target as HTMLInputElement).value;
    }

    // Inline Add List / Group State
    let isAddingList: boolean = false;
    let newListName: string = "";
    let isCommittingAddList: boolean = false;
    let isAddingGroup: boolean = false;
    let newGroupName: string = "";
    let isCommittingAddGroup: boolean = false;

    // Inline Rename State
    let editingItemId: string = "";
    let editingItemType: "category" | "group" | "column" = "category";
    let editingName: string = "";
    let isCommittingRename: boolean = false;
    let renameInputEl: HTMLInputElement;
    let focusRestoreTimer: number | null = null;

    // Drag & Drop reordering state (synced from QuickListDragController)
    let draggedListId: string = "";
    let isDraggingGroup: boolean = false;
    let isPointerDragging: boolean = false;
    let isForbiddenGroupDrag: boolean = false;
    let activeDragPayload: DragPayload | null = null;
    let ghostX: number = 0;
    let ghostY: number = 0;
    let ghostWidth: number = 240;
    let dropTarget: BoardDropTarget = { kind: "none" };
    let activeEdgeDirection: string | null = null;
    let listPaneEl: HTMLElement | null = null;

    // DOM Element Bindings
    let searchInputEl: HTMLInputElement;
    let modalContainerEl: HTMLElement;
    let addListInputEl: HTMLInputElement;
    let addGroupInputEl: HTMLInputElement;
    let boardEl: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeDebounceTimer: number | null = null;
    let isAdjustingSpacing: boolean = false;

    $: isFiltering = (searchMode === 'list') && !!searchQuery.trim();
    $: filteredItems = (searchMode === 'list' && searchQuery.trim()) ? filterSidebarTree(sidebarItems, searchQuery) : sidebarItems;
    $: starredCategory = {
        id: STARRED_CATEGORY_PATH,
        name: STARRED_CATEGORY_NAME,
        filepath: STARRED_CATEGORY_PATH,
        type: "category",
        isSmartList: true
    } as CategoryInfo;
    $: isStarredMatching = starredCount > 0 && (!isFiltering || STARRED_CATEGORY_NAME.toLowerCase().includes(searchQuery.toLowerCase()));
    $: flatCategories = isStarredMatching
        ? [starredCategory, ...getFlatCategories(filteredItems)]
        : getFlatCategories(filteredItems);
    $: groupItems = filteredItems.filter(i => i.type === "group") as GroupInfo[];
    $: rootCategories = filteredItems.filter(i => i.type === "category") as CategoryInfo[];
    $: defaultFocusCategory = flatCategories.find(c => c.filepath === plugin?.settings?.defaultQuickListFocusFilepath);
    $: defaultFocusListName = defaultFocusCategory ? defaultFocusCategory.name : "";
    $: if (focusedIndex >= 0 && focusedIndex >= flatCategories.length && flatCategories.length > 0) {
        focusedIndex = Math.max(0, flatCategories.length - 1);
    }
    $: if (searchMode === 'list' && searchQuery !== prevSearchQuery) {
        prevSearchQuery = searchQuery;
        if (searchQuery.trim()) {
            focusedIndex = 0;
            scrollFocusedIntoView();
        }
    }

    $: if (filteredItems && isGridLayout) {
        scheduleAdjustSpacing();
    }

    $: if (searchMode === 'task' && !isComposing) {
        runTaskSearch(searchQuery);
    }

    let layoutColumns: GridCardData[][] = [];
    let layoutColumnKeys: number[] = [];
    let columnTitles: ColumnTitlesMap = { ...(plugin?.settings?.quickListColumnTitles || {}) };
    let rafId: number | null = null;
    let pendingLayoutRefreshAfterDrag: boolean = false;

    interface CardHeightRecord {
        height: number;
        itemCount: number;
    }
    let measuredCardHeights = new Map<string, CardHeightRecord>();

    function scheduleAdjustSpacing() {
        if (!isGridLayout) return;
        if (isPointerDragging) {
            pendingLayoutRefreshAfterDrag = true;
            return;
        }
        if (rafId !== null) window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(() => {
            rafId = null;
            updateLayoutColumns();
        });
    }

    function updateLayoutColumns(force: boolean = false) {
        if (!isGridLayout) return;
        if (isPointerDragging) {
            pendingLayoutRefreshAfterDrag = true;
            return;
        }

        // 1. Live base font size and scale detection (relative to standard 14px)
        const baseFontSize = boardEl
            ? parseFloat(window.getComputedStyle(boardEl).fontSize) || 14
            : (modalContainerEl ? parseFloat(window.getComputedStyle(modalContainerEl).fontSize) || 14 : 14);
        const fontScale = Math.max(0.75, Math.min(2.5, baseFontSize / 14));

        const estimatedItemH = Math.round(25 * fontScale);
        const estimatedHeaderH = Math.round(32 * fontScale);

        // 2. Gather all cards with font-scaled initial estimated heights or cached measurements
        const cards: GridCardData[] = [];
        if (rootCategories.length > 0) {
            const itemCount = rootCategories.length;
            const cached = measuredCardHeights.get("__root__");
            const height = (cached && cached.itemCount === itemCount)
                ? cached.height
                : (estimatedHeaderH + itemCount * estimatedItemH);
            cards.push({
                id: "__root__",
                type: "root",
                name: "Lists",
                items: rootCategories,
                height
            });
        }
        for (const group of groupItems) {
            const itemCount = (group.isExpanded && group.items) ? group.items.length : 0;
            const cached = measuredCardHeights.get(group.id);
            const height = (cached && cached.itemCount === itemCount)
                ? cached.height
                : (group.isExpanded ? (estimatedHeaderH + itemCount * estimatedItemH) : estimatedHeaderH);
            cards.push({
                id: group.id,
                type: "group",
                name: group.name,
                group: group,
                items: group.items,
                height
            });
        }

        if (cards.length === 0) {
            layoutColumns = [];
            layoutColumnKeys = [];
            return;
        }

        const headerEl = boardEl?.querySelector<HTMLElement>(".quick-grid-column-header");
        const measuredColHeaderH = (headerEl && headerEl.offsetHeight > 0)
            ? headerEl.offsetHeight
            : Math.round(30 * fontScale);

        // 3. Measure actual rendered DOM heights if available and expansion state matches
        if (boardEl) {
            for (const c of cards) {
                const safeCardId = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(c.id) : c.id;
                const el = boardEl.querySelector<HTMLElement>(`.quick-grid-card[data-card-id="${safeCardId}"]`);
                if (el && el.offsetHeight > 0) {
                    if (c.type === "group" && c.group) {
                        const hasDomItems = !!el.querySelector(".quick-grid-card-items");
                        // Only measure if DOM matches the card's current expansion state
                        if (hasDomItems === !!c.group.isExpanded) {
                            c.height = el.offsetHeight;
                            measuredCardHeights.set(c.id, {
                                height: el.offsetHeight,
                                itemCount: (c.group.isExpanded && c.items) ? c.items.length : 0
                            });
                        }
                    } else {
                        c.height = el.offsetHeight;
                        measuredCardHeights.set(c.id, {
                            height: el.offsetHeight,
                            itemCount: c.items ? c.items.length : 0
                        });
                    }
                }
            }
        }

        // 4. Compute available dimensions and bounds
        const availW = boardEl ? boardEl.clientWidth : 1200;
        const availH = boardEl ? boardEl.clientHeight : 540;

        const minColGap = plugin?.settings?.quickListMinColGap ?? 14;
        const minRowGap = plugin?.settings?.quickListMinRowGap ?? 10;
        const maxColGap = Math.max(minColGap, Math.round(18 * fontScale));
        const rowGap = minRowGap;

        const minPadX = Math.round(14 * fontScale);
        const minPadY = Math.max(8, Math.round(12 * fontScale));

        const configuredMaxCardW = plugin?.settings?.quickListMaxCardWidth ?? 380;
        const minCardW = Math.max(200, Math.round(210 * fontScale));
        const maxCardW = Math.max(minCardW + 40, Math.max(380, Math.round(configuredMaxCardW * Math.min(1.4, fontScale))));

        const availContentW = Math.max(100, availW - minPadX * 2);
        const maxColsByW = Math.max(1, Math.floor((availContentW + minColGap) / (minCardW + minColGap)));
        const maxCandidateK = Math.min(cards.length, maxColsByW);

        // Target peak height and maximum usable vertical bounds without overflow (reserve top column header slot)
        const colHeaderBlockH = measuredColHeaderH + rowGap;
        const maxUsableH = Math.max(140, availH - minPadY * 2 - colHeaderBlockH);
        const maxSingleH = Math.max(...cards.map(c => c.height));
        const targetPeakH = Math.min(maxUsableH, Math.max(maxSingleH, Math.floor((availH - colHeaderBlockH) * 0.82)));

        // 5. Find optimal K or compute Table mode columns
        let bestK = 1;
        let bestBins: { items: GridCardData[]; h: number }[] | null = null;
        let newColumnKeys: number[] = [];

        if (layoutMode === "table") {
            const tableRes = computeTableColumns(cards, plugin?.settings?.quickListGroupPositions || {});
            if (tableRes.generatedInitialPositions && plugin?.settings) {
                plugin.settings.quickListGroupPositions = tableRes.generatedInitialPositions;
                void plugin.saveSettings();
            }
            newColumnKeys = tableRes.columnKeys;
            bestBins = tableRes.columns.map(colItems => {
                let colH = colHeaderBlockH;
                for (let idx = 0; idx < colItems.length; idx++) {
                    colH += idx === 0 ? colItems[idx].height : (colItems[idx].height + rowGap);
                }
                return { items: colItems, h: colH };
            });
            bestK = Math.max(1, bestBins.length);
        } else {
            bestBins = computeGridBins(cards, maxCandidateK, rowGap, targetPeakH, maxUsableH, fontScale)
                .map(bin => ({ items: bin.items, h: bin.h + colHeaderBlockH }));
            bestK = Math.max(1, bestBins.length);
            newColumnKeys = bestBins.map((_, i) => i);
        }

        // 6. Update layoutColumns when forced or when column structure/items change
        const newColumns = bestBins.map(b => b.items);
        const keysChanged = layoutColumnKeys.length !== newColumnKeys.length ||
            layoutColumnKeys.some((k, idx) => k !== newColumnKeys[idx]);
        if (force || keysChanged || !areLayoutColumnsEqual(layoutColumns, newColumns)) {
            layoutColumns = newColumns;
            layoutColumnKeys = newColumnKeys;
        }

        // 7. Calculate elastic card width, column gap, and symmetrical top/bottom padding to center vertically
        const peakH = Math.max(...bestBins.map(b => b.h));
        const padY = Math.max(minPadY, Math.floor((availH - peakH) / 2));

        const colGap = Math.min(maxColGap, Math.max(minColGap, Math.round(14 * fontScale)));
        const totalGapsW = (bestK - 1) * colGap;
        const divisor = layoutMode === "table" ? Math.max(1, Math.min(bestK, maxCandidateK)) : bestK;
        const actualCardW = Math.min(maxCardW, Math.max(minCardW, Math.floor((availContentW - totalGapsW) / divisor)));
        const totalW = bestK * actualCardW + totalGapsW;
        const padX = layoutMode === "table" ? minPadX : Math.max(minPadX, Math.floor((availW - totalW) / 2));

        if (boardEl) {
            boardEl.style.setProperty("--quick-grid-card-w", `${actualCardW}px`);
            boardEl.style.setProperty("--quick-grid-col-gap", `${colGap}px`);
            boardEl.style.setProperty("--quick-grid-row-gap", `${rowGap}px`);
            boardEl.style.setProperty("--quick-grid-item-slot-w", `${Math.round(24 * fontScale)}px`);
            boardEl.style.paddingTop = `${padY}px`;
            boardEl.style.paddingBottom = `${padY}px`;
            boardEl.style.paddingLeft = `${padX}px`;
            boardEl.style.paddingRight = `${padX}px`;

            if (layoutMode === "table" || totalW > availW) {
                boardEl.style.justifyContent = "flex-start";
            } else {
                boardEl.style.justifyContent = "center";
            }
        }

        if (!hasInitializedFocus && isDataLoaded && flatCategories.length > 0) {
            hasInitializedFocus = true;
            setTimeout(() => {
                applyInitialFocus();
            }, 30);
        }
    }

    function applyInitialFocus() {
        if (!flatCategories || flatCategories.length === 0 || searchQuery.trim()) {
            return;
        }

        const defaultPath = plugin?.settings?.defaultQuickListFocusFilepath;
        let targetIndex = -1;

        if (defaultPath) {
            targetIndex = flatCategories.findIndex(c => c.filepath === defaultPath);
        }

        // If no configured path or file missing, fallback to top-left item (首列首项)
        if (targetIndex === -1) {
            if (isGridLayout && layoutColumns.length > 0) {
                const firstCol = layoutColumns[0];
                if (firstCol && firstCol.length > 0) {
                    const firstCard = firstCol[0];
                    const firstItem = firstCard.type === "root"
                        ? (rootCategories && rootCategories[0])
                        : (firstCard.items && firstCard.items[0]);
                    if (firstItem) {
                        const idx = flatCategories.findIndex(c => c.filepath === firstItem.filepath);
                        if (idx !== -1) targetIndex = idx;
                    }
                }
            }
            if (targetIndex === -1) {
                // Fallback to first regular category, NEVER Starred smart list on open
                const firstRealIdx = flatCategories.findIndex(c => !c.isSmartList && c.filepath !== STARRED_CATEGORY_PATH);
                targetIndex = firstRealIdx !== -1 ? firstRealIdx : 0;
            }
        }

        focusedIndex = targetIndex;
        hasInitializedFocus = true;
        scrollFocusedIntoView();
    }

    function togglePickingDefaultFocus() {
        isPickingDefaultFocus = !isPickingDefaultFocus;
        if (isPickingDefaultFocus) {
            new Notice(t("focus_pick_mode_enabled"));
        }
    }

    function showFocusTooltip() {
        showFocusPopover = true;
    }

    function hideFocusTooltip() {
        showFocusPopover = false;
    }

    async function handleCategoryClick(cat: CategoryInfo) {
        if (isFocusedListMode) {
            await toggleFocusedList(cat.filepath);
            return;
        }
        if (isPickingDefaultFocus) {
            isPickingDefaultFocus = false;
            showFocusPopover = false;
            if (plugin?.settings) {
                plugin.settings.defaultQuickListFocusFilepath = cat.filepath;
                await plugin.saveSettings();
            }
            new Notice(t("focus_default_set", cat.name));
            const idx = flatCategories.findIndex(c => c.filepath === cat.filepath);
            if (idx !== -1) {
                focusedIndex = idx;
                scrollFocusedIntoView();
            }
            return;
        }
        await openCategoryInCenterOnly(cat);
    }

    async function toggleLayoutMode() {
        if (layoutMode === "grid") {
            layoutMode = "table";
        } else if (layoutMode === "table") {
            layoutMode = "list";
        } else {
            layoutMode = "grid";
        }

        if (plugin?.settings) {
            plugin.settings.quickListLayoutMode = layoutMode;
            plugin.settings.quickListGridLayout = (layoutMode !== "list");
            await plugin.saveSettings();
        }

        hasInitializedFocus = false;
        if (layoutMode !== "list") {
            scheduleAdjustSpacing();
        } else {
            hasInitializedFocus = true;
            applyInitialFocus();
        }
    }

    onMount(async () => {
        checkHotkeyStatus();
        window.addEventListener("focus", checkHotkeyStatus);
        document.addEventListener("visibilitychange", checkHotkeyStatus);
        await loadData();
        EventBus.on(EventName.CATEGORY_LIST_CHANGED, handleExternalListChanged);
        EventBus.on(EventName.TASK_UPDATED, handleExternalTaskUpdated);
        EventBus.on(EventName.TASK_MOVED, handleExternalTaskUpdated);
        EventBus.on(EventName.TASK_DELETED, handleExternalTaskUpdated);
        EventBus.on(EventName.TASK_COMPLETED, handleExternalTaskUpdated);
        EventBus.on(EventName.SETTINGS_CHANGED, handleSettingsChanged);

        searchInputEl?.focus();
        if (isFocusedListMode) {
            searchMode = 'list';
            if (layoutMode === 'list') layoutMode = 'grid';
            setTimeout(() => {
                searchInputEl?.focus();
                searchInputEl?.select();
            }, 50);
        }
        if (isGridLayout) {
            scheduleAdjustSpacing();
        }
        if (!hasInitializedFocus && flatCategories.length > 0) {
            applyInitialFocus();
        }

        window.addEventListener("resize", scheduleAdjustSpacing);

        if (typeof ResizeObserver !== "undefined" && modalContainerEl) {
            let lastObservedW = 0;
            let lastObservedH = 0;
            resizeObserver = new ResizeObserver((entries) => {
                if (!entries || entries.length === 0) return;
                const entry = entries[0];
                const cr = entry.contentRect;
                if (!cr) return;
                const dw = Math.abs(cr.width - lastObservedW);
                const dh = Math.abs(cr.height - lastObservedH);
                if (dw >= 2 || dh >= 2) {
                    lastObservedW = cr.width;
                    lastObservedH = cr.height;
                    if (resizeDebounceTimer !== null) {
                        window.clearTimeout(resizeDebounceTimer);
                    }
                    resizeDebounceTimer = window.setTimeout(() => {
                        resizeDebounceTimer = null;
                        scheduleAdjustSpacing();
                    }, 60);
                }
            });
            resizeObserver.observe(modalContainerEl);
        }
    });

    onDestroy(() => {
        dragController.destroy();
        if (focusRestoreTimer !== null) {
            window.clearTimeout(focusRestoreTimer);
            focusRestoreTimer = null;
        }
        window.removeEventListener("focus", checkHotkeyStatus);
        document.removeEventListener("visibilitychange", checkHotkeyStatus);
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = null;
        }
        if (resizeDebounceTimer !== null) {
            window.clearTimeout(resizeDebounceTimer);
            resizeDebounceTimer = null;
        }
        if (rafId !== null) {
            window.cancelAnimationFrame(rafId);
            rafId = null;
        }
        window.removeEventListener("resize", scheduleAdjustSpacing);
        EventBus.off(EventName.CATEGORY_LIST_CHANGED, handleExternalListChanged);
        EventBus.off(EventName.TASK_UPDATED, handleExternalTaskUpdated);
        EventBus.off(EventName.TASK_MOVED, handleExternalTaskUpdated);
        EventBus.off(EventName.TASK_DELETED, handleExternalTaskUpdated);
        EventBus.off(EventName.TASK_COMPLETED, handleExternalTaskUpdated);
        EventBus.off(EventName.SETTINGS_CHANGED, handleSettingsChanged);
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
    });

    function handleSettingsChanged(payload?: any) {
        checkHotkeyStatus();
        if (payload?.settings?.quickListTitleAlignment !== undefined) {
            titleAlignment = payload.settings.quickListTitleAlignment;
        } else if (plugin?.settings?.quickListTitleAlignment !== undefined) {
            titleAlignment = plugin.settings.quickListTitleAlignment;
        }
        if (payload?.settings?.minimalPlaceholders !== undefined) {
            minimalPlaceholders = payload.settings.minimalPlaceholders;
        } else if (plugin?.settings?.minimalPlaceholders !== undefined) {
            minimalPlaceholders = plugin.settings.minimalPlaceholders;
        }
        const nextTitles = payload?.settings?.quickListColumnTitles ?? plugin?.settings?.quickListColumnTitles;
        if (nextTitles && typeof nextTitles === "object") {
            columnTitles = { ...nextTitles };
        }
        if (isGridLayout) {
            scheduleAdjustSpacing();
        }
    }

    async function handleExternalListChanged(payload?: any) {
        if (payload && Array.isArray(payload.sidebarItems)) {
            sidebarItems = payload.sidebarItems;
            if (isFocusedListMode) {
                sidebarItems = sidebarItems.map(item => {
                    if (item.type === "group") {
                        return { ...item, isExpanded: true };
                    }
                    return item;
                });
            }
            categories = getFlatCategories(sidebarItems);
            await refreshStarredCount();
            await refreshTaskCounts();
            isDataLoaded = true;
            await tick();
            if (isGridLayout) {
                updateLayoutColumns(true);
            }
            scheduleAdjustSpacing();
            return;
        }
        await loadData();
    }

    function handleExternalTaskUpdated() {
        void refreshStarredCount();
        void refreshTaskCounts();
    }

    async function loadData() {
        columnTitles = { ...(plugin?.settings?.quickListColumnTitles || {}) };
        sidebarItems = await dataService.getSidebarItems();
        if (isFocusedListMode) {
            sidebarItems = sidebarItems.map(item => {
                if (item.type === "group") {
                    return { ...item, isExpanded: true };
                }
                return item;
            });
        }
        categories = await dataService.getCategories();
        await refreshStarredCount();
        await refreshTaskCounts();
        isDataLoaded = true;
        await tick();
        if (isGridLayout) {
            updateLayoutColumns(true);
        }
        if (!hasInitializedFocus && flatCategories.length > 0) {
            applyInitialFocus();
        }
        scheduleAdjustSpacing();
    }

    async function refreshStarredCount() {
        try {
            starredCount = await dataService.getStarredCount();
        } catch (e) {
            console.error("[QuickListModal] Failed to refresh starred count:", e);
        }
    }

    async function refreshTaskCounts() {
        const countPromises = categories.map(async (cat) => {
            try {
                const catTasks = await dataService.getTasks(cat.filepath);
                taskCounts[cat.filepath] = catTasks.filter(t => !t.completed).length;
            } catch {
                taskCounts[cat.filepath] = 0;
            }
        });
        await Promise.all(countPromises);
        taskCounts = { ...taskCounts };
    }

    async function toggleGroup(group: GroupInfo) {
        measuredCardHeights.delete(group.id);
        sidebarItems = toggleGroupExpandedState(sidebarItems, group.id);
        
        // 1. Await Svelte tick so reactive stores ($: groupItems, $: filteredItems) refresh
        await tick();

        // 2. Force immediate grid recalculation so layoutColumns updates right away
        if (isGridLayout) {
            updateLayoutColumns(true);
            scheduleAdjustSpacing();
        }

        // 3. Persist to disk and notify peers
        await dataService.saveSidebarState(sidebarItems);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems });
    }

    async function openCategoryInCenterOnly(cat: CategoryInfo) {
        if (!cat) return;

        // 1. Collapse left and right sidebars if open & suppress auto-expansion
        if (plugin && typeof plugin.collapseSidebars === "function") {
            plugin.collapseSidebars(1200);
        } else {
            const leftSplit = (app.workspace as any).leftSplit;
            if (leftSplit && !leftSplit.collapsed) leftSplit.collapse();
            const rightSplit = (app.workspace as any).rightSplit;
            if (rightSplit && !rightSplit.collapsed) rightSplit.collapse();
        }

        // 2. Reveal/Activate TaskMainView in center ONLY
        const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
        let leaf = leaves[0];
        if (!leaf) {
            leaf = app.workspace.getLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_MAIN, active: true });
        }
        await app.workspace.revealLeaf(leaf);

        // 3. Select category in main view
        EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat, focusInput: false });

        // 4. Close modal
        closeModal();
    }

    function runTaskSearch(query: string) {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        const q = query.trim();
        if (!q) {
            taskSearchResults = [];
            taskFocusedIndex = 0;
            isSearchingTasks = false;
            return;
        }
        searchDebounceTimer = setTimeout(async () => {
            isSearchingTasks = true;
            try {
                let results = await dataService.searchTasks(q, null);
                if (hideCompleted) {
                    results = results.filter(r => !r.task.completed);
                }
                taskSearchResults = results;
                taskFocusedIndex = 0;
            } catch (err) {
                console.error("[QuickListModal] Task search failed:", err);
                taskSearchResults = [];
            } finally {
                isSearchingTasks = false;
            }
        }, 50);
    }

    async function toggleHideCompleted(e?: MouseEvent) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        hideCompleted = !hideCompleted;
        if (plugin?.settings) {
            plugin.settings.searchHideCompleted = hideCompleted;
            await plugin.saveSettings();
        }
        if (searchMode === 'task' && searchQuery.trim().length > 0) {
            runTaskSearch(searchQuery);
        }
        searchInputEl?.focus();
    }

    async function toggleSearchMode() {
        searchMode = searchMode === 'list' ? 'task' : 'list';
        if (plugin?.settings) {
            plugin.settings.quickListSearchMode = searchMode;
            await plugin.saveSettings();
        }
        searchQuery = "";
        taskSearchResults = [];
        taskFocusedIndex = 0;
        if (searchMode === 'list') {
            if (isGridLayout) {
                scheduleAdjustSpacing();
            } else {
                applyInitialFocus();
            }
        }
        searchInputEl?.focus();
    }

    async function scrollTaskFocusedIntoView() {
        await tick();
        if (!taskResultsContainerEl) return;
        const focusedEl = taskResultsContainerEl.querySelector(".quick-modal-task-item.is-focused") as HTMLElement | null;
        if (focusedEl) {
            focusedEl.scrollIntoView({ block: "nearest" });
        }
    }

    async function openTaskInCenter(item: { task: TaskItem; category: CategoryInfo; matchField: string }) {
        if (!item || !item.task || !item.category) return;

        // 1. Collapse left and right sidebars if open & suppress auto-expansion
        if (plugin && typeof plugin.collapseSidebars === "function") {
            plugin.collapseSidebars(1200);
        } else {
            const leftSplit = (app.workspace as any).leftSplit;
            if (leftSplit && !leftSplit.collapsed) leftSplit.collapse();
            const rightSplit = (app.workspace as any).rightSplit;
            if (rightSplit && !rightSplit.collapsed) rightSplit.collapse();
        }

        // 2. Reveal/Activate TaskMainView in center ONLY
        const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
        let leaf = leaves[0];
        if (!leaf) {
            leaf = app.workspace.getLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_MAIN, active: true });
        }
        await app.workspace.revealLeaf(leaf);

        // 3. Switch to the category first
        EventBus.emit(EventName.CATEGORY_SELECTED, { category: item.category, focusInput: false });

        // 4. Then navigate to the specific task (scroll + highlight) & open detail panel
        window.setTimeout(() => {
            EventBus.emit(EventName.TASK_NAVIGATE, {
                taskId: item.task.id,
                isCompleted: item.task.completed,
            });
            EventBus.emit(EventName.TASK_SELECTED, {
                task: item.task,
                categoryFilepath: item.category.filepath,
                skipModal: true,
            });
        }, 200);

        // 5. Close modal
        closeModal();
    }

    // =============================================
    // Pointer-Event Drag & Drop Engine + RTS Edge Panning
    // =============================================
    let lastDragNoticeTime: number = 0;

    $: colInsertOverlayStyle = (() => {
        if (dropTarget.kind !== "col-insert" || !boardEl) return null;
        const bRect = boardEl.getBoundingClientRect();
        const clampedTop = Math.max(bRect.top + 4, dropTarget.lineTop);
        const clampedBottom = Math.min(bRect.bottom - 4, dropTarget.lineTop + dropTarget.lineHeight);
        const clampedHeight = Math.max(24, clampedBottom - clampedTop);
        const clampedLeft = Math.max(Math.round(bRect.left + 2), Math.min(Math.round(bRect.right - 2), Math.round(dropTarget.lineX)));
        return {
            left: clampedLeft,
            top: Math.round(clampedTop),
            height: Math.round(clampedHeight),
        };
    })();

    function showDragForbiddenNotice() {
        const now = Date.now();
        if (now - lastDragNoticeTime > 2500) {
            lastDragNoticeTime = now;
            const message = isChinese()
                ? "当前悬浮UI不支持拖拽分组。\n原因：排列list代码本身覆盖了拖拽操作；如需调整分组顺序，请在左侧边栏操作。"
                : "Dragging groups is not supported in Quick View.\nReason: List arrangement code overrides drag operations; to adjust group order, please use the sidebar.";
            new Notice(message, 5000);
        }
    }

    const dragController = new QuickListDragController({
        getLayoutMode: () => layoutMode,
        isGridLayout: () => isGridLayout,
        getBoardEl: () => boardEl,
        getListPaneEl: () => listPaneEl,
        getModalContainerEl: () => modalContainerEl || null,
        getLayoutColumns: () => layoutColumns,
        getRootCount: () => rootCategories.length,
        getEditingItemId: () => editingItemId,
        collectBoardGeometry: (draggedId: string) => collectBoardGeometry(draggedId),
        collectClassicListGeometry: (draggedId: string) => collectClassicListGeometry(draggedId),
        onStateChange: (state: DragControllerState) => {
            isPointerDragging = state.isPointerDragging;
            isForbiddenGroupDrag = state.isForbiddenGroupDrag;
            isDraggingGroup = state.isDraggingGroup;
            draggedListId = state.draggedListId;
            activeDragPayload = state.activeDragPayload;
            ghostX = state.ghostX;
            ghostY = state.ghostY;
            ghostWidth = state.ghostWidth;
            dropTarget = state.dropTarget;
            activeEdgeDirection = state.activeEdgeDirection;
        },
        onForbiddenGroupDrag: () => {
            showDragForbiddenNotice();
        },
        onCommitDrop: async (payload: DragPayload, target: BoardDropTarget) => {
            await commitBoardDrop(payload, target);
        },
        onDragSessionEnded: () => {
            if (pendingLayoutRefreshAfterDrag) {
                pendingLayoutRefreshAfterDrag = false;
                if (isGridLayout) {
                    updateLayoutColumns(true);
                    scheduleAdjustSpacing();
                }
            }
        },
    });

    function wasDragJustPerformed(): boolean {
        return dragController.wasDragJustPerformed();
    }

    function handleHeaderPointerDown(e: PointerEvent, payload: DragPayload) {
        const headerEl = e.currentTarget as HTMLElement | null;
        dragController.beginCandidate(e, payload, headerEl);
    }

    function handleListItemPointerDown(e: PointerEvent, item: CategoryInfo) {
        e.stopPropagation();
        if (item.filepath === STARRED_CATEGORY_PATH || item.isSmartList) return;
        const itemEl = e.currentTarget as HTMLElement | null;
        dragController.beginCandidate(
            e,
            {
                kind: "category",
                id: item.id,
                name: item.name,
                filepath: item.filepath,
                count: taskCounts[item.filepath] ?? 0,
            },
            itemEl
        );
    }

    function collectBoardGeometry(draggedId: string = ""): {
        columns: ColumnGeometry[];
        newColDropzoneRect: DOMRect | null;
    } {
        if (!boardEl) return { columns: [], newColDropzoneRect: null };
        const colEls = Array.from(boardEl.querySelectorAll<HTMLElement>(".quick-grid-column"));
        const columns: ColumnGeometry[] = colEls.map((colEl, colIdx) => {
            const dataCol = layoutColumns[colIdx] || [];
            const cardMap = new Map(dataCol.map(c => [c.id, c]));
            const cardEls = Array.from(colEl.querySelectorAll<HTMLElement>(".quick-grid-card"));
            const cards = cardEls.map((cardEl) => {
                const id = cardEl.dataset.cardId || cardEl.dataset.groupId || "";
                const data = cardMap.get(id);
                const isRoot = id === "__root__" || data?.type === "root";
                const isExpanded = isRoot ? true : Boolean(data?.group?.isExpanded);
                const groupChildren = data?.group?.items || data?.items || [];
                const itemsCount = isRoot ? rootCategories.length : groupChildren.length;
                const containsDragged = Boolean(
                    draggedId && groupChildren.some(ch => ch.id === draggedId || ch.filepath === draggedId)
                );
                const itemEls = Array.from(cardEl.querySelectorAll<HTMLElement>(".quick-modal-list-item"));
                const items: ListItemGeometry[] = itemEls
                    .map(el => ({ id: el.dataset.itemId || "", rect: el.getBoundingClientRect() }))
                    .filter(item => Boolean(item.id));
                return {
                    id,
                    type: isRoot ? ("root" as const) : ("group" as const),
                    isExpanded,
                    itemsCount,
                    containsDragged,
                    rect: cardEl.getBoundingClientRect(),
                    items,
                };
            });
            const bottomDropEl = colEl.querySelector<HTMLElement>(".quick-table-col-dropzone");
            return {
                colIdx,
                rect: colEl.getBoundingClientRect(),
                cards,
                bottomDropzoneRect: bottomDropEl ? bottomDropEl.getBoundingClientRect() : null,
            };
        });
        const newColEl = boardEl.querySelector<HTMLElement>(".quick-table-new-col-dropzone");
        return {
            columns,
            newColDropzoneRect: newColEl ? newColEl.getBoundingClientRect() : null,
        };
    }

    function collectClassicListGeometry(draggedId: string = ""): {
        groups: ClassicGroupGeometry[];
        allListItems: ListItemGeometry[];
    } {
        if (!listPaneEl) return { groups: [], allListItems: [] };
        const groupMap = new Map(groupItems.map(g => [g.id, g]));
        const groupEls = Array.from(listPaneEl.querySelectorAll<HTMLElement>(".quick-modal-group-container"));
        const groups: ClassicGroupGeometry[] = [];
        for (const grpEl of groupEls) {
            const id = grpEl.dataset.groupId || "";
            const grp = groupMap.get(id);
            const headerEl = grpEl.querySelector<HTMLElement>(".quick-modal-group-header");
            if (!id || !grp || !headerEl) continue;
            const childEls = Array.from(grpEl.querySelectorAll<HTMLElement>(".quick-modal-list-item"));
            const items: ListItemGeometry[] = childEls
                .map(el => ({ id: el.dataset.itemId || "", rect: el.getBoundingClientRect() }))
                .filter(it => Boolean(it.id));
            const containsDragged = Boolean(
                draggedId && (grp.items || []).some(ch => ch.id === draggedId || ch.filepath === draggedId)
            );
            groups.push({
                id,
                itemsCount: grp.items ? grp.items.length : 0,
                isExpanded: Boolean(grp.isExpanded),
                containsDragged,
                rect: grpEl.getBoundingClientRect(),
                headerRect: headerEl.getBoundingClientRect(),
                items,
            });
        }
        const allListItems: ListItemGeometry[] = Array.from(
            listPaneEl.querySelectorAll<HTMLElement>(".quick-modal-list-item[data-item-id]")
        )
            .map(el => ({ id: el.dataset.itemId || "", rect: el.getBoundingClientRect() }))
            .filter(it => Boolean(it.id) && it.id !== STARRED_CATEGORY_PATH);
        return { groups, allListItems };
    }

    async function commitBoardDrop(payload: DragPayload, target: BoardDropTarget) {
        if (payload.kind === "group") {
            if (layoutMode !== "table") return;

            const prevColKeys = [...layoutColumnKeys];
            let moveRes: { columns: GridCardData[][]; changed: boolean; moveMeta?: import("../utils/quickListBoardUtils").TableColumnMoveMeta } = {
                columns: layoutColumns,
                changed: false,
            };
            switch (target.kind) {
                case "card-slot":
                    moveRes = moveCardInTable(layoutColumns, payload.id, target.cardId, target.position);
                    break;
                case "col-bottom":
                    moveRes = moveCardToColumnBottom(layoutColumns, payload.id, target.colIdx);
                    break;
                case "col-insert":
                    moveRes = moveCardToNewColumnAt(layoutColumns, payload.id, target.colIdx);
                    break;
                case "new-col-end":
                    moveRes = moveCardToNewColumn(layoutColumns, payload.id);
                    break;
                default:
                    return;
            }
            if (moveRes.changed) {
                const nextColumnTitles = !isFiltering && moveRes.moveMeta
                    ? remapTableColumnTitles(columnTitles, prevColKeys, moveRes.moveMeta)
                    : undefined;
                await saveTableLayoutPositions(moveRes.columns, nextColumnTitles);
            }
            return;
        }

        // List (category) drops
        if (target.kind === "new-group-col" || target.kind === "new-group-new-col") {
            const colIdx = target.kind === "new-group-col" ? target.colIdx : layoutColumns.length;
            await createGroupFromListAtColumn(payload.id, colIdx);
            return;
        }

        let movedId = payload.id;
        let targetId = "";
        let pos: "top" | "bottom" | "inside" | null = null;

        if (target.kind === "list-item") {
            targetId = target.targetId;
            pos = target.position;
        } else if (target.kind === "group-inside") {
            targetId = target.groupId;
            pos = "inside";
        } else if (target.kind === "root-empty") {
            targetId = "__root__";
            pos = "top";
        }

        if (!movedId || !targetId || !pos || movedId === targetId) return;

        sidebarItems = moveSidebarItem(sidebarItems, movedId, targetId, pos);
        categories = getFlatCategories(sidebarItems);
        measuredCardHeights.clear();
        await tick();

        if (isGridLayout) {
            updateLayoutColumns(true);
            scheduleAdjustSpacing();
        }

        await dataService.saveSidebarState(sidebarItems);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems });
    }

    async function createGroupFromListAtColumn(movedId: string, colIdx: number) {
        const newGroupId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
        const created = createGroupFromListInBoard(sidebarItems, layoutColumns, movedId, colIdx, newGroupId);
        if (!created) return;

        sidebarItems = created.sidebarItems;
        categories = getFlatCategories(sidebarItems);
        measuredCardHeights.clear();

        await saveTableLayoutPositions(created.columns);
        await tick();

        if (isGridLayout) {
            updateLayoutColumns(true);
            scheduleAdjustSpacing();
        }

        await dataService.saveSidebarState(sidebarItems);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems });
    }

    async function saveTableLayoutPositions(prunedCols: GridCardData[][], nextColumnTitles?: ColumnTitlesMap) {
        const existingPositions = plugin?.settings?.quickListGroupPositions as TablePositionsMap | undefined;
        const positions = buildTablePositions(prunedCols, existingPositions, isFiltering);

        // Optimistic UI: update rendered columns & settings synchronously before awaiting disk write.
        layoutColumns = prunedCols;
        layoutColumnKeys = prunedCols.map((_, idx) => idx);
        if (plugin?.settings) {
            plugin.settings.quickListGroupPositions = positions;
            if (nextColumnTitles) {
                plugin.settings.quickListColumnTitles = nextColumnTitles;
                columnTitles = nextColumnTitles;
            }
        }
        scheduleAdjustSpacing();

        if (plugin?.settings) {
            await plugin.saveSettings();
        }
    }

    // =============================================
    // Inline Rename & Context Menus
    // =============================================
    const COL_RENAME_PREFIX = "__col__:";

    function makeColRenameId(colKey: number): string {
        return `${COL_RENAME_PREFIX}${colKey}`;
    }

    async function saveSingleColumnTitle(colKey: number, rawName: string) {
        if (!plugin?.settings) return;
        const trimmed = rawName.trim();
        const defaultTitle = `Column ${colKey + 1}`;
        const nextTitles: ColumnTitlesMap = { ...(plugin.settings.quickListColumnTitles || {}) };
        if (!trimmed || trimmed === defaultTitle) {
            delete nextTitles[String(colKey)];
        } else {
            nextTitles[String(colKey)] = trimmed;
        }
        plugin.settings.quickListColumnTitles = nextTitles;
        columnTitles = nextTitles;
        await plugin.saveSettings();
        scheduleAdjustSpacing();
    }

    interface RenameTarget {
        id: string;
        name: string;
        type: "category" | "group" | "column";
        filepath?: string;
        colKey?: number;
    }

    let hoveredRenameTarget: RenameTarget | null = null;
    let lastMouseX: number = -1;
    let lastMouseY: number = -1;

    function handlePointerMove(e: PointerEvent) {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }

    function handlePointerLeave() {
        lastMouseX = -1;
        lastMouseY = -1;
        hoveredRenameTarget = null;
    }

    function setHoveredTarget(target: RenameTarget) {
        hoveredRenameTarget = target;
    }

    function clearHoveredTarget(id: string) {
        if (hoveredRenameTarget?.id === id || hoveredRenameTarget?.filepath === id) {
            hoveredRenameTarget = null;
        }
    }

    function getTargetUnderMouse(): RenameTarget | null {
        let hitInsideModal = false;

        // Priority 1: Pointer coordinates hit-test (dynamic cursor position)
        if (lastMouseX >= 0 && lastMouseY >= 0 && typeof document.elementFromPoint === "function") {
            try {
                const el = document.elementFromPoint(lastMouseX, lastMouseY);
                if (el) {
                    if (!modalContainerEl || modalContainerEl.contains(el)) {
                        hitInsideModal = true;
                    }
                    // Check if hovering over a category list item
                    const listItemEl = el.closest(".quick-modal-list-item") as HTMLElement | null;
                    if (listItemEl) {
                        const filepath = listItemEl.dataset.filepath;
                        const itemId = listItemEl.dataset.itemId;
                        const cat = categories.find(c => (filepath && c.filepath === filepath) || (itemId && c.id === itemId))
                            || flatCategories.find(c => (filepath && c.filepath === filepath) || (itemId && c.id === itemId));
                        if (cat) {
                            return { id: cat.id || cat.filepath, name: cat.name, type: "category", filepath: cat.filepath };
                        }
                    }

                    // Check if hovering over a column title header
                    const colHeaderEl = el.closest(".quick-grid-column-header") as HTMLElement | null;
                    if (colHeaderEl && colHeaderEl.dataset.colKey !== undefined) {
                        const colKey = parseInt(colHeaderEl.dataset.colKey, 10);
                        if (!Number.isNaN(colKey)) {
                            return {
                                id: makeColRenameId(colKey),
                                name: getColumnDisplayTitle(columnTitles, colKey),
                                type: "column",
                                colKey,
                            };
                        }
                    }

                    // Check if hovering over a group header or group container/card
                    const groupEl = el.closest(".quick-grid-card-header, .quick-modal-group-header, .quick-grid-card, .quick-modal-group-container") as HTMLElement | null;
                    if (groupEl) {
                        const groupId = groupEl.dataset.groupId || groupEl.dataset.cardId;
                        if (groupId) {
                            const grp = groupItems.find(g => g.id === groupId) || (sidebarItems.find(i => i.id === groupId && i.type === "group") as GroupInfo | undefined);
                            if (grp) {
                                return { id: grp.id, name: grp.name, type: "group" };
                            }
                        }
                    }
                }
            } catch {
                // Ignore any hit-test exceptions
            }
        }

        // Priority 2: CSS :hover active element inside modalContainerEl
        if (modalContainerEl) {
            try {
                const hoveredListEl = modalContainerEl.querySelector(".quick-modal-list-item:hover") as HTMLElement | null;
                if (hoveredListEl) {
                    const filepath = hoveredListEl.dataset.filepath;
                    const itemId = hoveredListEl.dataset.itemId;
                    const cat = categories.find(c => (filepath && c.filepath === filepath) || (itemId && c.id === itemId))
                        || flatCategories.find(c => (filepath && c.filepath === filepath) || (itemId && c.id === itemId));
                    if (cat) {
                        return { id: cat.id || cat.filepath, name: cat.name, type: "category", filepath: cat.filepath };
                    }
                }

                const hoveredColEl = modalContainerEl.querySelector(".quick-grid-column-header:hover") as HTMLElement | null;
                if (hoveredColEl && hoveredColEl.dataset.colKey !== undefined) {
                    const colKey = parseInt(hoveredColEl.dataset.colKey, 10);
                    if (!Number.isNaN(colKey)) {
                        return {
                            id: makeColRenameId(colKey),
                            name: getColumnDisplayTitle(columnTitles, colKey),
                            type: "column",
                            colKey,
                        };
                    }
                }

                const hoveredGroupEl = modalContainerEl.querySelector(".quick-grid-card-header:hover, .quick-modal-group-header:hover, .quick-grid-card:hover, .quick-modal-group-container:hover") as HTMLElement | null;
                if (hoveredGroupEl) {
                    const groupId = hoveredGroupEl.dataset.groupId || hoveredGroupEl.dataset.cardId;
                    if (groupId) {
                        const grp = groupItems.find(g => g.id === groupId) || (sidebarItems.find(i => i.id === groupId && i.type === "group") as GroupInfo | undefined);
                        if (grp) {
                            return { id: grp.id, name: grp.name, type: "group" };
                        }
                    }
                }
            } catch {
                // Ignore querySelector exceptions
            }
        }

        // If elementFromPoint confirmed the cursor is over a non-target element inside the modal
        // (e.g. blank board space or non-renamable root card after DOM shifted), drop stale hover state.
        if (hitInsideModal) {
            hoveredRenameTarget = null;
            return null;
        }

        // Priority 3: Explicit mouseenter/mouseleave target tracking
        if (hoveredRenameTarget) {
            if (hoveredRenameTarget.type === "column" && hoveredRenameTarget.colKey !== undefined) {
                const colKey = hoveredRenameTarget.colKey;
                return {
                    id: makeColRenameId(colKey),
                    name: getColumnDisplayTitle(columnTitles, colKey),
                    type: "column",
                    colKey,
                };
            }
            const clean = (p?: string) => (p || "").replace(/\\/g, "/").replace(/^\/+/, "");
            const hId = clean(hoveredRenameTarget.id);
            const hFp = clean(hoveredRenameTarget.filepath);
            const cat = categories.find(c => (hId && clean(c.id) === hId) || (hFp && clean(c.filepath) === hFp));
            if (cat) {
                return { id: cat.id || cat.filepath, name: cat.name, type: "category", filepath: cat.filepath };
            }
            const grp = groupItems.find(g => g.id === hoveredRenameTarget!.id) || (sidebarItems.find(i => i.id === hoveredRenameTarget!.id && i.type === "group") as GroupInfo | undefined);
            if (grp) {
                return { id: grp.id, name: grp.name, type: "group" };
            }
            return hoveredRenameTarget;
        }

        return null;
    }

    async function startRenameItem(item: { id: string; name: string; type: "category" | "group" | "column"; filepath?: string; colKey?: number }) {
        if (item.id === STARRED_CATEGORY_PATH || item.filepath === STARRED_CATEGORY_PATH) return;
        if (focusRestoreTimer !== null) {
            window.clearTimeout(focusRestoreTimer);
            focusRestoreTimer = null;
        }
        editingItemId = item.id || item.filepath || "";
        editingItemType = item.type;
        editingName = item.name;
        if (item.type === "category") {
            const catPath = item.filepath || item.id;
            const idx = flatCategories.findIndex(c => c.filepath === catPath || c.id === catPath);
            if (idx >= 0) {
                focusedIndex = idx;
            }
        }
        await tick();
        renameInputEl?.focus();
        renameInputEl?.select();
        window.setTimeout(() => {
            if (renameInputEl && document.activeElement !== renameInputEl) {
                renameInputEl.focus();
                renameInputEl.select();
            }
        }, 30);
    }

    function scheduleModalFocusRestore() {
        if (focusRestoreTimer !== null) {
            window.clearTimeout(focusRestoreTimer);
        }
        focusRestoreTimer = window.setTimeout(() => {
            focusRestoreTimer = null;
            if (!editingItemId && !dragController.isSessionActive()) {
                modalContainerEl?.focus();
            }
        }, 30);
    }

    async function commitRename() {
        if (isCommittingRename || !editingItemId) return;
        const newName = editingName.trim();
        const itemId = editingItemId;
        const itemType = editingItemType;
        cancelRename();
        if (!newName || !itemId) {
            return;
        }

        isCommittingRename = true;
        try {
            if (itemType === "category") {
                const clean = (p?: string) => (p || "").replace(/\\/g, "/").replace(/^\/+/, "");
                const targetNorm = clean(itemId);
                const cat = categories.find(c => {
                    const cId = clean(c.id);
                    const cFp = clean(c.filepath);
                    return Boolean(targetNorm && (cId === targetNorm || cFp === targetNorm));
                });
                if (cat && cat.name !== newName) {
                    const newCat = await dataService.renameCategory(cat.filepath, newName);
                    if (plugin?.settings?.defaultQuickListFocusFilepath === cat.filepath) {
                        plugin.settings.defaultQuickListFocusFilepath = newCat.filepath;
                        await plugin.saveSettings();
                    }
                    await loadData();
                }
            } else if (itemType === "column") {
                if (itemId.startsWith(COL_RENAME_PREFIX)) {
                    const colKey = parseInt(itemId.slice(COL_RENAME_PREFIX.length), 10);
                    if (!Number.isNaN(colKey) && getColumnDisplayTitle(columnTitles, colKey) !== newName) {
                        await saveSingleColumnTitle(colKey, newName);
                    }
                }
            } else {
                const grp = groupItems.find(g => g.id === itemId) || (sidebarItems.find(i => i.id === itemId && i.type === "group") as GroupInfo | undefined);
                if (!grp || grp.name !== newName) {
                    await dataService.renameGroup(itemId, newName);
                    await loadData();
                }
            }
        } catch (e) {
            console.error("[QuickListModal] Rename failed:", e);
        } finally {
            isCommittingRename = false;
            scheduleModalFocusRestore();
        }
    }

    function showColumnContextMenu(e: MouseEvent, colKey: number) {
        e.preventDefault();
        e.stopPropagation();
        const menu = new Menu();
        const displayName = getColumnDisplayTitle(columnTitles, colKey);
        const hasCustom = Boolean(columnTitles[String(colKey)]?.trim());

        menu.addItem((item) => {
            item.setTitle("Rename column (F2)")
                .setIcon("edit")
                .onClick(() => {
                    void startRenameItem({
                        id: makeColRenameId(colKey),
                        name: displayName,
                        type: "column",
                        colKey,
                    });
                });
        });

        if (hasCustom) {
            menu.addItem((item) => {
                item.setTitle(`Reset to default (Column ${colKey + 1})`)
                    .setIcon("rotate-ccw")
                    .onClick(async () => {
                        await saveSingleColumnTitle(colKey, "");
                    });
            });
        }

        menu.showAtMouseEvent(e);
    }

    function cancelRename() {
        editingItemId = "";
        editingName = "";
        scheduleModalFocusRestore();
    }

    function showItemContextMenu(e: MouseEvent, item: { id: string; name: string; type: "category" | "group"; filepath?: string }) {
        if (item.id === STARRED_CATEGORY_PATH || item.filepath === STARRED_CATEGORY_PATH) return;
        e.preventDefault();
        e.stopPropagation();

        const menu = new Menu();

        if (item.type === "category" && item.filepath) {
            const isCurrentlyDefault = plugin?.settings?.defaultQuickListFocusFilepath === item.filepath;
            menu.addItem((i) => {
                i.setTitle(isCurrentlyDefault ? t("focus_cancel_default") : t("focus_set_default"))
                 .setIcon("target")
                 .onClick(async () => {
                     if (isCurrentlyDefault) {
                         plugin.settings.defaultQuickListFocusFilepath = "";
                         new Notice(t("focus_restored_default"));
                     } else {
                         plugin.settings.defaultQuickListFocusFilepath = item.filepath!;
                         new Notice(t("focus_default_set", item.name));
                     }
                     await plugin.saveSettings();
                 });
            });
        }

        menu.addItem((i) => {
            i.setTitle("Rename (F2)")
             .setIcon("edit")
             .onClick(() => startRenameItem(item));
        });

        menu.addItem((i) => {
            i.setTitle("Delete")
             .setIcon("trash")
             .setWarning(true)
             .onClick(async () => {
                 if (item.type === "category" && item.filepath) {
                     await dataService.deleteCategory(item.filepath);
                 } else if (item.type === "group") {
                     await dataService.deleteGroup(item.id);
                 }
                 await loadData();
             });
        });

        menu.showAtMouseEvent(e);
    }

    // =============================================
    // Inline Add List / Add Group
    // =============================================
    function startAddList() {
        isAddingList = true;
        newListName = "";
        setTimeout(() => addListInputEl?.focus(), INPUT_FOCUS_DELAY_MS);
    }

    async function commitAddList() {
        if (isCommittingAddList || !isAddingList) return;
        const name = newListName.trim();
        if (!name) {
            isAddingList = false;
            newListName = "";
            return;
        }
        isCommittingAddList = true;
        isAddingList = false;
        newListName = "";
        try {
            const newCat = await dataService.createCategory(name);
            await loadData();
            await tick();
            const idx = flatCategories.findIndex(c => c.filepath === newCat.filepath || c.id === newCat.id);
            if (idx !== -1) {
                focusedIndex = idx;
                scrollFocusedIntoView();
            }
        } catch (e) {
            new Notice(`Failed to create list: ${e}`);
        } finally {
            isCommittingAddList = false;
            setTimeout(() => {
                modalContainerEl?.focus();
            }, 30);
        }
    }

    function startAddGroup() {
        isAddingGroup = true;
        newGroupName = "";
        setTimeout(() => addGroupInputEl?.focus(), INPUT_FOCUS_DELAY_MS);
    }

    async function commitAddGroup() {
        if (isCommittingAddGroup || !isAddingGroup) return;
        const name = newGroupName.trim();
        if (!name) {
            isAddingGroup = false;
            newGroupName = "";
            return;
        }
        isCommittingAddGroup = true;
        isAddingGroup = false;
        newGroupName = "";
        try {
            await dataService.createGroup(name);
            await loadData();
        } catch (e) {
            new Notice(`Failed to create group: ${e}`);
        } finally {
            isCommittingAddGroup = false;
            setTimeout(() => {
                modalContainerEl?.focus();
            }, 30);
        }
    }

    // =============================================
    // Keyboard Physics (1D & 2D Directional Navigation)
    // =============================================
    function navigateDirection(direction: "up" | "down" | "left" | "right") {
        if (!flatCategories || flatCategories.length === 0) return;

        // If in classic single-column list mode, use standard linear navigation:
        if (!isGridLayout) {
            if (direction === "down") {
                focusedIndex = Math.min(flatCategories.length - 1, focusedIndex + 1);
            } else if (direction === "up") {
                focusedIndex = Math.max(0, focusedIndex - 1);
            }
            scrollFocusedIntoView();
            return;
        }

        // In 2D Grid Board layout: Geometric Spatial Navigation
        const items = Array.from(modalContainerEl?.querySelectorAll(".quick-modal-list-item") || []) as HTMLElement[];
        if (items.length === 0) return;

        // Get currently focused element (or default to first item in board)
        let currentEl = modalContainerEl?.querySelector(".quick-modal-list-item.is-focused") as HTMLElement | null;
        if (!currentEl) {
            const firstBoardItem = modalContainerEl?.querySelector(".quick-list-grid-board .quick-modal-list-item, .quick-modal-scrollable .quick-modal-list-item:not(.is-smart-item)") as HTMLElement | null;
            currentEl = firstBoardItem || items[0];
            const targetPath = currentEl.dataset.filepath;
            const idx = flatCategories.findIndex(c => c.filepath === targetPath);
            if (idx !== -1) focusedIndex = idx;
            scrollFocusedIntoView();
            return;
        }

        const currentRect = currentEl.getBoundingClientRect();
        const currentCenterX = currentRect.left + currentRect.width / 2;
        const currentCenterY = currentRect.top + currentRect.height / 2;

        let bestCandidate: HTMLElement | null = null;
        let minScore = Infinity;

        for (const item of items) {
            if (item === currentEl) continue;
            const rect = item.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const dx = centerX - currentCenterX;
            const dy = centerY - currentCenterY;

            let isEligible = false;
            let score = Infinity;

            switch (direction) {
                case "down":
                    if (rect.top >= currentRect.bottom - 4) {
                        isEligible = true;
                        // Strongly prefer elements in the same column (small |dx|)
                        score = dy + Math.abs(dx) * 3.0;
                    }
                    break;
                case "up":
                    if (rect.bottom <= currentRect.top + 4) {
                        isEligible = true;
                        score = -dy + Math.abs(dx) * 3.0;
                    }
                    break;
                case "right":
                    if (rect.left >= currentRect.right - 8) {
                        isEligible = true;
                        // Strongly prefer elements aligned on the same row (small |dy|)
                        score = dx + Math.abs(dy) * 2.5;
                    }
                    break;
                case "left":
                    if (rect.right <= currentRect.left + 8) {
                        isEligible = true;
                        score = -dx + Math.abs(dy) * 2.5;
                    }
                    break;
            }

            if (isEligible && score < minScore) {
                minScore = score;
                bestCandidate = item;
            }
        }

        // If no candidate found in strict direction, handle boundary wrapping
        if (!bestCandidate) {
            if (direction === "down") {
                focusedIndex = (focusedIndex + 1) % flatCategories.length;
                scrollFocusedIntoView();
                return;
            } else if (direction === "up") {
                focusedIndex = (focusedIndex - 1 + flatCategories.length) % flatCategories.length;
                scrollFocusedIntoView();
                return;
            } else if (direction === "right") {
                // Wrap around to leftmost column
                let leftmostCand: HTMLElement | null = null;
                let minX = Infinity;
                let minDy = Infinity;
                for (const item of items) {
                    const rect = item.getBoundingClientRect();
                    const centerY = rect.top + rect.height / 2;
                    const dy = Math.abs(centerY - currentCenterY);
                    if (rect.left < minX - 20) {
                        minX = rect.left;
                        minDy = dy;
                        leftmostCand = item;
                    } else if (Math.abs(rect.left - minX) <= 20 && dy < minDy) {
                        minDy = dy;
                        leftmostCand = item;
                    }
                }
                bestCandidate = leftmostCand;
            } else if (direction === "left") {
                // Wrap around to rightmost column
                let rightmostCand: HTMLElement | null = null;
                let maxX = -Infinity;
                let minDy = Infinity;
                for (const item of items) {
                    const rect = item.getBoundingClientRect();
                    const centerY = rect.top + rect.height / 2;
                    const dy = Math.abs(centerY - currentCenterY);
                    if (rect.right > maxX + 20) {
                        maxX = rect.right;
                        minDy = dy;
                        rightmostCand = item;
                    } else if (Math.abs(rect.right - maxX) <= 20 && dy < minDy) {
                        minDy = dy;
                        rightmostCand = item;
                    }
                }
                bestCandidate = rightmostCand;
            }
        }

        if (bestCandidate) {
            const targetPath = bestCandidate.dataset.filepath;
            const newIndex = flatCategories.findIndex(c => c.filepath === targetPath);
            if (newIndex !== -1) {
                focusedIndex = newIndex;
                scrollFocusedIntoView();
            }
        }
    }

    async function handleKeydown(e: KeyboardEvent) {
        if (e.isComposing || isComposing || e.keyCode === 229) return;

        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const keyLower = e.key.toLowerCase();
            if (keyLower === "z" || keyLower === "y") {
                const active = document.activeElement;
                const inTextInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
                if (!inTextInput) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }
        }

        if (showHelpModal) {
            if (e.key === "Escape" || e.key === "F1" || e.key === "?") {
                e.preventDefault();
                e.stopPropagation();
                showHelpModal = false;
                return;
            }
        }

        if (e.key === "F1") {
            e.preventDefault();
            e.stopPropagation();
            showHelpModal = !showHelpModal;
            return;
        }

        if (e.key === "?" && document.activeElement !== searchInputEl && !editingItemId && !isAddingList && !isAddingGroup) {
            e.preventDefault();
            e.stopPropagation();
            showHelpModal = !showHelpModal;
            return;
        }

        // If currently editing inline rename, give full precedence to rename controls
        if (editingItemId) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                await commitRename();
                return;
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelRename();
                return;
            } else if (e.key === "F2") {
                e.preventDefault();
                e.stopPropagation();
                const currentEditingId = editingItemId;
                await commitRename();
                const newTarget = getTargetUnderMouse();
                if (newTarget && newTarget.id !== currentEditingId && newTarget.filepath !== currentEditingId) {
                    await startRenameItem(newTarget);
                }
                return;
            }
            // Allow native input handling (typing, arrows, backspace, selection) inside rename input
            return;
        }

        if (e.key === "F2") {
            e.preventDefault();
            e.stopPropagation();
            if (isCommittingRename || dragController.isSessionActive()) return;

            const target = getTargetUnderMouse();
            if (target) {
                await startRenameItem(target);
            } else if (flatCategories[focusedIndex]) {
                const cat = flatCategories[focusedIndex];
                await startRenameItem({ id: cat.id || cat.filepath, name: cat.name, type: "category", filepath: cat.filepath });
            }
            return;
        }

        if (e.key === "Tab") {
            if (document.activeElement !== renameInputEl && document.activeElement !== addListInputEl && document.activeElement !== addGroupInputEl) {
                e.preventDefault();
                e.stopPropagation();
                void toggleSearchMode();
                return;
            }
        }

        if (searchMode === 'task' && searchQuery.trim().length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                e.stopPropagation();
                if (taskSearchResults.length > 0) {
                    taskFocusedIndex = (taskFocusedIndex + 1) % taskSearchResults.length;
                    void scrollTaskFocusedIntoView();
                }
                return;
            }

            if (e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                if (taskSearchResults.length > 0) {
                    taskFocusedIndex = (taskFocusedIndex - 1 + taskSearchResults.length) % taskSearchResults.length;
                    void scrollTaskFocusedIntoView();
                }
                return;
            }

            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (taskSearchResults.length > 0 && taskSearchResults[taskFocusedIndex]) {
                    void openTaskInCenter(taskSearchResults[taskFocusedIndex]);
                }
                return;
            }

            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                searchQuery = "";
                taskSearchResults = [];
                taskFocusedIndex = 0;
                return;
            }

            return;
        }

        if (isAddingList || isAddingGroup) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (isAddingList) void commitAddList();
                else void commitAddGroup();
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                isAddingList = false;
                isAddingGroup = false;
            }
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            navigateDirection("down");
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            navigateDirection("up");
            return;
        }

        if (e.key === "ArrowLeft") {
            // Allow cursor navigation inside search input when text is selected or cursor > 0
            if (document.activeElement === searchInputEl && searchQuery.length > 0 && searchInputEl.selectionStart !== 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            navigateDirection("left");
            return;
        }

        if (e.key === "ArrowRight") {
            // Allow cursor navigation inside search input when text is selected or cursor < length
            if (document.activeElement === searchInputEl && searchQuery.length > 0 && searchInputEl.selectionStart !== searchQuery.length) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            navigateDirection("right");
            return;
        }

        if (isPickingDefaultFocus) {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                isPickingDefaultFocus = false;
                new Notice(t("focus_pick_cancelled"));
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (flatCategories.length > 0 && flatCategories[focusedIndex]) {
                    void handleCategoryClick(flatCategories[focusedIndex]);
                }
                return;
            }
        }

        if (isFocusedListMode && (e.key === "Delete" || e.code === "Delete")) {
            if (!editingItemId && !isAddingList && !isAddingGroup) {
                if (document.activeElement === searchInputEl && searchQuery.length > 0) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                void handleClearAllFocused();
                return;
            }
        }

        if (isFocusedListMode && e.key === " ") {
            if (document.activeElement !== searchInputEl && !editingItemId && !isAddingList && !isAddingGroup) {
                e.preventDefault();
                e.stopPropagation();
                if (flatCategories.length > 0 && flatCategories[focusedIndex]) {
                    void handleCategoryClick(flatCategories[focusedIndex]);
                }
                return;
            }
        }

        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (flatCategories.length > 0 && flatCategories[focusedIndex]) {
                void handleCategoryClick(flatCategories[focusedIndex]);
            }
            return;
        }

        if (e.key === "Escape") {
            if (isFocusedListMode) {
                e.preventDefault();
                e.stopPropagation();
                closeModal();
                return;
            }
            if (searchQuery) {
                e.preventDefault();
                e.stopPropagation();
                searchQuery = "";
                return;
            }
            closeModal();
            return;
        }

        // Cookbook Tier 3: Lossless Typing Redirection into Search Input
        if (document.activeElement !== searchInputEl && !editingItemId && !isAddingList && !isAddingGroup) {
            if (!e.ctrlKey && !e.altKey && !e.metaKey && !["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key) && !e.key.startsWith("F")) {
                if (e.key === "Process" || e.keyCode === 229) {
                    searchInputEl?.focus();
                } else if (e.key === "Backspace") {
                    searchInputEl?.focus();
                    if (searchQuery.length > 0) {
                        e.preventDefault();
                        searchQuery = searchQuery.slice(0, -1);
                    }
                } else if (e.key.length === 1) {
                    searchInputEl?.focus();
                    e.preventDefault();
                    searchQuery += e.key;
                }
            }
        }
    }

    function scrollFocusedIntoView() {
        setTimeout(() => {
            const el = modalContainerEl?.querySelector(".quick-modal-list-item.is-focused") as HTMLElement | null;
            if (el) {
                if (isGridLayout && boardEl && boardEl.scrollWidth > boardEl.clientWidth) {
                    const boardRect = boardEl.getBoundingClientRect();
                    const itemRect = el.getBoundingClientRect();
                    if (itemRect.left < boardRect.left || itemRect.right > boardRect.right) {
                        const offset = (itemRect.left + itemRect.width / 2) - (boardRect.left + boardRect.width / 2);
                        boardEl.scrollLeft += offset;
                    }
                }
                el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
            }
        }, 10);
    }
</script>

<svelte:window on:keydown={handleKeydown} on:pointermove={handlePointerMove} />

<!-- svelte-ignore a11y-no-noninteractive-element-interactions a11y-no-noninteractive-tabindex a11y-click-events-have-key-events -->
<div 
    class="quick-modal-container quick-list-only-container"
    class:is-centered-titles={titleAlignment === 'center'}
    class:is-picking-focus={isPickingDefaultFocus}
    class:is-dragging-group={isForbiddenGroupDrag}
    class:is-pointer-dragging={isPointerDragging}
    class:is-table-mode={layoutMode === "table"}
    class:edge-dir-left={activeEdgeDirection === 'left'}
    class:edge-dir-right={activeEdgeDirection === 'right'}
    class:edge-dir-up={activeEdgeDirection === 'up'}
    class:edge-dir-down={activeEdgeDirection === 'down'}
    class:edge-dir-up-left={activeEdgeDirection === 'up-left'}
    class:edge-dir-up-right={activeEdgeDirection === 'up-right'}
    class:edge-dir-down-left={activeEdgeDirection === 'down-left'}
    class:edge-dir-down-right={activeEdgeDirection === 'down-right'}
    bind:this={modalContainerEl}
    on:pointerleave={handlePointerLeave}
    tabindex="0"
    role="region"
>
    {#if showTip}
        <div class="quick-modal-tip-banner">
            {@html t("quick_list_tip", remainingTips)}
        </div>
    {/if}

    <!-- Search & Layout Toggle Header -->
    <div class="quick-modal-filter-bar">
        <span class="quick-modal-filter-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
        </span>
        <input 
            type="text" 
            class="quick-modal-filter-input"
            placeholder={isFocusedListMode
                ? (t("focused_lists_search_placeholder") || "Search lists...")
                : (searchMode === 'task' 
                    ? (t("quick_list_task_search_placeholder") || "Search all tasks (title, steps, notes)...") 
                    : "Type to filter lists (↑↓←→ navigate, F2 rename, Enter to open in center)...")}
            bind:value={searchQuery}
            bind:this={searchInputEl}
            on:compositionstart={handleCompositionStart}
            on:compositionend={handleCompositionEnd}
        />
        {#if searchQuery}
            <button class="quick-modal-filter-clear" on:click={() => { searchQuery = ""; if (searchMode === 'task') taskSearchResults = []; searchInputEl?.focus(); }}>✕</button>
        {/if}

        {#if isStarredMatching}
            <button 
                class="quick-modal-header-btn quick-modal-starred-btn quick-modal-list-item is-smart-item"
                class:is-focused={flatCategories[focusedIndex]?.filepath === STARRED_CATEGORY_PATH}
                class:is-focused-selected={isFocusedListMode && focusedListSet.has(STARRED_CATEGORY_PATH)}
                data-filepath={STARRED_CATEGORY_PATH}
                data-item-id={STARRED_CATEGORY_PATH}
                title={isFocusedListMode ? "Starred tasks: click to toggle focused list" : `Starred tasks (${starredCount}): click to open in center view`}
                on:click={() => handleCategoryClick(starredCategory)}
            >
                {#if isFocusedListMode}
                    <input 
                        type="checkbox" 
                        class="focused-list-item-checkbox" 
                        checked={focusedListSet.has(STARRED_CATEGORY_PATH)}
                        tabindex="-1"
                        on:click|stopPropagation={() => toggleFocusedList(STARRED_CATEGORY_PATH)}
                    />
                {/if}
                <span class="quick-modal-smart-star-icon">★</span>
                <span class="quick-modal-starred-label">{STARRED_CATEGORY_NAME}</span>
                <span class="quick-modal-badge smart-count-badge">{starredCount}</span>
            </button>
        {/if}

        {#if isFocusedListMode}
            <button 
                class="quick-modal-header-btn focused-clear-all-btn"
                title="Clear all focused lists (Delete)"
                disabled={focusedListSet.size === 0}
                on:click={handleClearAllFocused}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                <span>{t("focused_lists_clear_all") || "Clear all"}</span>
                <kbd class="focused-clear-shortcut-badge">Delete</kbd>
            </button>
            {#if focusedListSet.size > 0}
                <span class="focused-selected-count-badge">
                    {t("focused_lists_selected_count", focusedListSet.size)}
                </span>
            {/if}
        {:else}
            {#if searchMode === 'task'}
                <button 
                    class="quick-modal-header-btn todo-search-filter-btn"
                    class:is-active={hideCompleted}
                    aria-label={t("quick_list_search_filter_tooltip") || "Toggle completed tasks filter"}
                    title={t("quick_list_search_filter_tooltip") || "Toggle completed tasks filter"}
                    tabindex="-1"
                    on:click={toggleHideCompleted}
                >
                    {hideCompleted 
                        ? (t("quick_list_search_filter_active_only") || "Active only") 
                        : (t("quick_list_search_filter_all_tasks") || "All tasks")}
                </button>
            {/if}

            <button 
                class="quick-modal-header-btn quick-modal-search-mode-btn"
                class:is-task-mode={searchMode === 'task'}
                title={searchMode === 'task' 
                    ? (t("quick_list_search_mode_title_to_list") || "Currently searching tasks. Click to permanently switch to list search.") 
                    : (t("quick_list_search_mode_title_to_task") || "Currently searching lists. Click to permanently switch to task search.")}
                on:click={toggleSearchMode}
            >
                {#if searchMode === 'task'}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 11 12 14 22 4"></polyline>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1 2-2h11"></path>
                    </svg>
                    <span>{t("quick_list_search_mode_task") || "Tasks"}</span>
                {:else}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                        <line x1="3" y1="6" x2="3.01" y2="6"></line>
                        <line x1="3" y1="12" x2="3.01" y2="12"></line>
                        <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                    <span>{t("quick_list_search_mode_list") || "Lists"}</span>
                {/if}
            </button>

            {#if isGridLayout}
                <button 
                    class="quick-modal-header-btn quick-modal-focus-picker-btn"
                    class:is-active={isPickingDefaultFocus}
                    on:click={togglePickingDefaultFocus}
                    on:contextmenu|preventDefault={async () => {
                        if (plugin?.settings) {
                            plugin.settings.defaultQuickListFocusFilepath = "";
                            await plugin.saveSettings();
                            new Notice(t("focus_restored_default_notice"));
                            applyInitialFocus();
                        }
                    }}
                    on:mouseenter={showFocusTooltip}
                    on:mouseleave={hideFocusTooltip}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="3"></circle>
                        <line x1="12" y1="2" x2="12" y2="5"></line>
                        <line x1="12" y1="19" x2="12" y2="22"></line>
                        <line x1="2" y1="12" x2="5" y2="12"></line>
                        <line x1="19" y1="12" x2="22" y2="12"></line>
                    </svg>
                    <span>{isPickingDefaultFocus ? t("focus_picking_target") : (defaultFocusListName ? t("focus_target_label", defaultFocusListName) : t("focus_set_btn"))}</span>
                </button>
                {#if showFocusPopover}
                    <div class="quick-modal-focus-popover">
                        <div class="focus-popover-title">{t("focus_popover_title")}</div>
                        <div class="focus-popover-desc">
                            {#if defaultFocusListName}
                                {t("focus_current_prefix")}<b>{defaultFocusListName}</b>
                            {:else}
                                {t("focus_unset_prefix")}<b>{t("focus_top_left_default")}</b>
                            {/if}
                        </div>
                        <div class="focus-popover-hint">
                            {t("focus_instruction_desc")}
                        </div>
                    </div>
                {/if}
            {/if}

            <button 
                class="quick-modal-header-btn quick-modal-layout-toggle-btn"
                title={layoutMode === "grid" 
                    ? "Current: Grid (Auto Bin-Packing). Click to switch to Table Board" 
                    : (layoutMode === "table" 
                        ? "Current: Table (Custom Blueprint Grid). Click to switch to Classic List" 
                        : "Current: Classic List. Click to switch to Auto Grid")}
                on:click={toggleLayoutMode}
            >
                {#if layoutMode === "grid"}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="7" height="7"></rect>
                        <rect x="14" y="3" width="7" height="7"></rect>
                        <rect x="14" y="14" width="7" height="7"></rect>
                        <rect x="3" y="14" width="7" height="7"></rect>
                    </svg>
                    <span>Grid</span>
                {:else if layoutMode === "table"}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                        <line x1="3" y1="9" x2="21" y2="9"></line>
                        <line x1="3" y1="15" x2="21" y2="15"></line>
                        <line x1="9" y1="3" x2="9" y2="21"></line>
                        <line x1="15" y1="3" x2="15" y2="21"></line>
                    </svg>
                    <span>Table</span>
                {:else}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                        <line x1="3" y1="6" x2="3.01" y2="6"></line>
                        <line x1="3" y1="12" x2="3.01" y2="12"></line>
                        <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                    <span>List</span>
                {/if}
            </button>

            {#if showNoHotkeyWarning}
                <button 
                    class="quick-modal-header-btn quick-modal-warning-btn"
                    title={t("warn_bind_hotkey_tooltip")}
                    on:click={handleOpenHotkeySettings}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <span>{t("warn_bind_hotkey_btn")}</span>
                </button>
            {/if}
        {/if}

        {#if searchMode === 'task' && searchQuery.trim().length > 0}
            <!-- Floating Task Search Results Dropdown Overlay (Does not unmount or alter the list board below) -->
            <div class="quick-modal-task-dropdown" bind:this={taskResultsContainerEl}>
                {#if isSearchingTasks}
                    <div class="quick-modal-task-dropdown-status">Searching tasks...</div>
                {:else if taskSearchResults.length === 0}
                    <div class="quick-modal-task-dropdown-status">{t("quick_list_task_search_no_results") || "No matching tasks found."}</div>
                {:else}
                    <div class="quick-modal-task-dropdown-list" role="listbox">
                        {#each taskSearchResults as item, idx (item.task.id)}
                            <div 
                                class="quick-modal-task-item"
                                class:is-focused={taskFocusedIndex === idx}
                                class:is-completed={item.task.completed}
                                role="option"
                                aria-selected={taskFocusedIndex === idx}
                                tabindex="0"
                                on:mouseenter={() => { taskFocusedIndex = idx; }}
                                on:click={() => openTaskInCenter(item)}
                            >
                                <div class="quick-modal-task-main">
                                    <span class="quick-modal-task-check" class:is-done={item.task.completed}>
                                        {#if item.task.completed}✓{/if}
                                    </span>
                                    <span class="quick-modal-task-title">{item.task.title}</span>
                                </div>
                                <div class="quick-modal-task-meta">
                                    <span class="quick-modal-task-cat">{item.category.name}</span>
                                    <span class="quick-modal-task-dot">·</span>
                                    <span class="quick-modal-task-match">Match: {item.matchField}</span>
                                    {#if item.task.completed}
                                        <span class="quick-modal-task-dot">·</span>
                                        <span class="quick-modal-task-completed-tag">Completed</span>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    </div>

    {#if isGridLayout}
        <!-- =============================================
             Grid Board / Dashboard Card Layout (图表平铺看板 - 横向滑动 + 纵向换列)
             ============================================= -->
        <div 
            class="quick-list-grid-board" 
            class:is-table-mode={layoutMode === "table"} 
            bind:this={boardEl} 
            on:wheel={handleBoardWheel}
        >
            {#if activeEdgeDirection}
                <div class="quick-table-edge-arrow is-{activeEdgeDirection}">
                    {#if activeEdgeDirection === 'left'}◀
                    {:else if activeEdgeDirection === 'right'}▶
                    {:else if activeEdgeDirection === 'up'}▲
                    {:else if activeEdgeDirection === 'down'}▼
                    {:else if activeEdgeDirection === 'up-left'}◤
                    {:else if activeEdgeDirection === 'up-right'}◥
                    {:else if activeEdgeDirection === 'down-left'}◣
                    {:else if activeEdgeDirection === 'down-right'}◢
                    {/if}
                </div>
            {/if}

            {#if filteredItems.length === 0 && !isStarredMatching}
                <div class="quick-modal-empty">No matching lists or groups found.</div>
            {:else}
                {#each layoutColumns as column, colIdx (colIdx)}
                    {@const colKey = layoutColumnKeys[colIdx] ?? colIdx}
                    <div class="quick-grid-column" data-col-key={colKey}>
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div
                            class="quick-grid-column-header"
                            class:is-editing={editingItemId === makeColRenameId(colKey)}
                            class:is-custom={Boolean(columnTitles[String(colKey)]?.trim())}
                            data-col-key={colKey}
                            on:mouseenter={() => setHoveredTarget({ id: makeColRenameId(colKey), name: getColumnDisplayTitle(columnTitles, colKey), type: "column", colKey })}
                            on:mouseleave={() => clearHoveredTarget(makeColRenameId(colKey))}
                            on:contextmenu={(e) => showColumnContextMenu(e, colKey)}
                        >
                            {#if editingItemId === makeColRenameId(colKey)}
                                <input
                                    type="text"
                                    class="quick-grid-column-rename-input"
                                    bind:value={editingName}
                                    bind:this={renameInputEl}
                                    on:blur={commitRename}
                                    on:pointerdown|stopPropagation
                                    on:click|stopPropagation
                                />
                            {:else}
                                <span
                                    class="quick-grid-column-title"
                                    title={`${getColumnDisplayTitle(columnTitles, colKey)} (Hover + F2 to rename)`}
                                >
                                    {getColumnDisplayTitle(columnTitles, colKey)}
                                </span>
                            {/if}
                        </div>
                        {#each column as card (card.id + "_" + (card.group ? (card.group.isExpanded ? "exp" : "col") : "root"))}
                            {#if card.type === "root"}
                                <!-- Standalone Root Categories Card -->
                                <div 
                                    class="quick-grid-card is-root-card" 
                                    data-card-id="__root__"
                                    class:is-dragging={isPointerDragging && draggedListId === "__root__"}
                                    class:drag-over-top={dropTarget.kind === "card-slot" && dropTarget.cardId === "__root__" && dropTarget.position === "top"}
                                    class:drag-over-bottom={dropTarget.kind === "card-slot" && dropTarget.cardId === "__root__" && dropTarget.position === "bottom"}
                                    class:drag-over-inside={dropTarget.kind === "root-empty"}
                                >
                                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                                    <div 
                                        class="quick-grid-card-header is-root-header"
                                        data-group-id="__root__"
                                        role="button"
                                        tabindex="0"
                                        on:pointerdown={(e) => handleHeaderPointerDown(e, { kind: "group", id: "__root__", name: "Lists", count: rootCategories.length, isRoot: true })}
                                        on:dragstart|preventDefault
                                    >
                                        <div class="quick-grid-card-title-wrap">
                                            <span class="quick-grid-card-icon">
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                                </svg>
                                            </span>
                                            <span class="quick-grid-card-title">Lists</span>
                                        </div>
                                        <span class="quick-grid-card-count">{rootCategories.length}</span>
                                    </div>
                                    <div 
                                        class="quick-grid-card-items"
                                        class:is-empty={rootCategories.length === 0}
                                    >
                                        {#each rootCategories as cat (cat.id)}
                                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                                            <div 
                                                class="quick-modal-list-item is-grid-item"
                                                class:is-focused={flatCategories[focusedIndex]?.filepath === cat.filepath}
                                                class:is-focused-selected={isFocusedListMode && focusedListSet.has(cat.filepath)}
                                                class:is-default-focus={!isFocusedListMode && plugin?.settings?.defaultQuickListFocusFilepath === cat.filepath}
                                                class:is-dragging={isPointerDragging && draggedListId === cat.id}
                                                class:drag-over-top={dropTarget.kind === "list-item" && dropTarget.targetId === cat.id && dropTarget.position === "top"}
                                                class:drag-over-bottom={dropTarget.kind === "list-item" && dropTarget.targetId === cat.id && dropTarget.position === "bottom"}
                                                data-filepath={cat.filepath}
                                                data-item-id={cat.id}
                                                role="button"
                                                tabindex="0"
                                                on:mouseenter={() => setHoveredTarget({ id: cat.id || cat.filepath, name: cat.name, type: "category", filepath: cat.filepath })}
                                                on:mouseleave={() => clearHoveredTarget(cat.id || cat.filepath)}
                                                on:pointerdown={(e) => handleListItemPointerDown(e, cat)}
                                                on:dragstart|preventDefault
                                                on:click={() => { if (!wasDragJustPerformed()) void handleCategoryClick(cat); }}
                                                on:contextmenu={(e) => showItemContextMenu(e, { id: cat.id || "", name: cat.name, type: "category", filepath: cat.filepath })}
                                            >
                                                <span class="quick-modal-list-icon">
                                                    {#if isFocusedListMode}
                                                        <input 
                                                            type="checkbox" 
                                                            class="focused-list-item-checkbox" 
                                                            checked={focusedListSet.has(cat.filepath)}
                                                            tabindex="-1"
                                                            on:pointerdown|stopPropagation
                                                            on:click|stopPropagation={() => toggleFocusedList(cat.filepath)}
                                                        />
                                                    {/if}
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                                    </svg>
                                                </span>
                                                
                                                {#if editingItemId === cat.id || (cat.filepath && editingItemId === cat.filepath)}
                                                    <input 
                                                        type="text" 
                                                        class="quick-modal-inline-rename-input"
                                                        bind:value={editingName}
                                                        bind:this={renameInputEl}
                                                        on:blur={commitRename}
                                                        on:pointerdown|stopPropagation
                                                        on:click|stopPropagation
                                                    />
                                                {:else}
                                                    <span class="quick-modal-list-name" title={cat.name}>{cat.name}</span>
                                                {/if}

                                                <div class="quick-modal-item-meta-right">
                                                    {#if (taskCounts[cat.filepath] ?? 0) > 0}
                                                        <span class="quick-modal-badge">{taskCounts[cat.filepath]}</span>
                                                    {/if}
                                                    {#if !isFocusedListMode && plugin?.settings?.defaultQuickListFocusFilepath === cat.filepath}
                                                        <span class="quick-modal-focus-tag" title={t("focus_tag_tooltip")}>
                                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                                                <circle cx="12" cy="12" r="10"></circle>
                                                                <circle cx="12" cy="12" r="3"></circle>
                                                                <line x1="12" y1="2" x2="12" y2="5"></line>
                                                                <line x1="12" y1="19" x2="12" y2="22"></line>
                                                                <line x1="2" y1="12" x2="5" y2="12"></line>
                                                                <line x1="19" y1="12" x2="22" y2="12"></line>
                                                            </svg>
                                                        </span>
                                                    {/if}
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {:else if card.type === "group" && card.group}
                                {@const group = card.group}
                                <div 
                                    class="quick-grid-card"
                                    data-card-id={group.id}
                                    data-group-id={group.id}
                                    class:is-dragging={(isPointerDragging || isForbiddenGroupDrag) && draggedListId === group.id}
                                    class:drag-over-top={dropTarget.kind === "card-slot" && dropTarget.cardId === group.id && dropTarget.position === "top"}
                                    class:drag-over-bottom={dropTarget.kind === "card-slot" && dropTarget.cardId === group.id && dropTarget.position === "bottom"}
                                    class:drag-over-inside={dropTarget.kind === "group-inside" && dropTarget.groupId === group.id}
                                >
                                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                                    <div 
                                        class="quick-grid-card-header"
                                        class:is-focused-selected={isFocusedListMode && focusedListSet.has(makeFocusedGroupKey(group.id))}
                                        data-group-id={group.id}
                                        role="button"
                                        tabindex="0"
                                        on:mouseenter={() => setHoveredTarget({ id: group.id, name: group.name, type: "group" })}
                                        on:mouseleave={() => clearHoveredTarget(group.id)}
                                        on:pointerdown={(e) => handleHeaderPointerDown(e, { kind: "group", id: group.id, name: group.name, count: group.items ? group.items.length : 0, isRoot: false })}
                                        on:dragstart|preventDefault
                                        on:click={() => { if (isFocusedListMode && !wasDragJustPerformed()) void toggleFocusedGroup(group.id); }}
                                        on:contextmenu={(e) => showItemContextMenu(e, { id: group.id, name: group.name, type: "group" })}
                                    >
                                        <div class="quick-grid-card-title-wrap">
                                            {#if isFocusedListMode}
                                                <input 
                                                    type="checkbox" 
                                                    class="focused-list-item-checkbox focused-group-checkbox"
                                                    checked={focusedListSet.has(makeFocusedGroupKey(group.id))}
                                                    tabindex="-1"
                                                    on:pointerdown|stopPropagation
                                                    on:click|stopPropagation={() => toggleFocusedGroup(group.id)}
                                                />
                                            {/if}
                                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                                            <span 
                                                class="quick-modal-group-chevron" 
                                                on:click|stopPropagation={() => { if (!wasDragJustPerformed()) void toggleGroup(group); }}
                                            >
                                                {group.isExpanded ? "▼" : "▶"}
                                            </span>

                                            {#if editingItemId === group.id}
                                                <input 
                                                    type="text" 
                                                    class="quick-modal-inline-rename-input"
                                                    bind:value={editingName}
                                                    bind:this={renameInputEl}
                                                    on:blur={commitRename}
                                                    on:pointerdown|stopPropagation
                                                    on:click|stopPropagation
                                                />
                                            {:else}
                                                <span class="quick-grid-card-title">
                                                    {group.name}
                                                </span>
                                            {/if}
                                        </div>

                                        <span class="quick-grid-card-count">
                                            {group.items ? group.items.length : 0}
                                        </span>
                                    </div>

                                    {#if group.isExpanded}
                                        <div 
                                            class="quick-grid-card-items"
                                            class:is-empty={!group.items || group.items.length === 0}
                                            class:drag-over-inside={dropTarget.kind === "group-inside" && dropTarget.groupId === group.id}
                                        >
                                            {#if group.items && group.items.length > 0}
                                                {#each group.items as child (child.id)}
                                                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                                                    <div 
                                                        class="quick-modal-list-item is-grid-item"
                                                        class:is-focused={flatCategories[focusedIndex]?.filepath === child.filepath}
                                                        class:is-focused-selected={isFocusedListMode && focusedListSet.has(child.filepath)}
                                                        class:is-default-focus={!isFocusedListMode && plugin?.settings?.defaultQuickListFocusFilepath === child.filepath}
                                                        class:is-dragging={isPointerDragging && draggedListId === child.id}
                                                        class:drag-over-top={dropTarget.kind === "list-item" && dropTarget.targetId === child.id && dropTarget.position === "top"}
                                                        class:drag-over-bottom={dropTarget.kind === "list-item" && dropTarget.targetId === child.id && dropTarget.position === "bottom"}
                                                        data-filepath={child.filepath}
                                                        data-item-id={child.id}
                                                        role="button"
                                                        tabindex="0"
                                                        on:mouseenter={() => setHoveredTarget({ id: child.id || child.filepath, name: child.name, type: "category", filepath: child.filepath })}
                                                        on:mouseleave={() => clearHoveredTarget(child.id || child.filepath)}
                                                        on:pointerdown={(e) => handleListItemPointerDown(e, child)}
                                                        on:dragstart|preventDefault
                                                        on:click={() => { if (!wasDragJustPerformed()) void handleCategoryClick(child); }}
                                                        on:contextmenu={(e) => showItemContextMenu(e, { id: child.id || "", name: child.name, type: "category", filepath: child.filepath })}
                                                    >
                                                        <span class="quick-modal-list-icon">
                                                            {#if isFocusedListMode}
                                                                <input 
                                                                    type="checkbox" 
                                                                    class="focused-list-item-checkbox" 
                                                                    checked={focusedListSet.has(child.filepath)}
                                                                    tabindex="-1"
                                                                    on:pointerdown|stopPropagation
                                                                    on:click|stopPropagation={() => toggleFocusedList(child.filepath)}
                                                                />
                                                            {/if}
                                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                                            </svg>
                                                        </span>
                                                        
                                                        {#if editingItemId === child.id || (child.filepath && editingItemId === child.filepath)}
                                                            <input 
                                                                type="text" 
                                                                class="quick-modal-inline-rename-input"
                                                                bind:value={editingName}
                                                                bind:this={renameInputEl}
                                                                on:blur={commitRename}
                                                                on:pointerdown|stopPropagation
                                                                on:click|stopPropagation
                                                            />
                                                        {:else}
                                                            <span class="quick-modal-list-name" title={child.name}>{child.name}</span>
                                                        {/if}

                                                        <div class="quick-modal-item-meta-right">
                                                            {#if (taskCounts[child.filepath] ?? 0) > 0}
                                                                <span class="quick-modal-badge">{taskCounts[child.filepath]}</span>
                                                            {/if}
                                                            {#if !isFocusedListMode && plugin?.settings?.defaultQuickListFocusFilepath === child.filepath}
                                                                <span class="quick-modal-focus-tag" title={t("focus_tag_tooltip")}>
                                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                                                        <circle cx="12" cy="12" r="10"></circle>
                                                                        <circle cx="12" cy="12" r="3"></circle>
                                                                        <line x1="12" y1="2" x2="12" y2="5"></line>
                                                                        <line x1="12" y1="19" x2="12" y2="22"></line>
                                                                        <line x1="2" y1="12" x2="5" y2="12"></line>
                                                                        <line x1="19" y1="12" x2="22" y2="12"></line>
                                                                    </svg>
                                                                </span>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                {/each}
                                            {:else}
                                                <div class="quick-grid-card-empty-dropzone">
                                                    Drop lists here
                                                </div>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        {/each}

                        {#if layoutMode === "table" && isPointerDragging}
                            {#if isDraggingGroup}
                                <div 
                                    class="quick-table-col-dropzone"
                                    class:drag-over={dropTarget.kind === "col-bottom" && dropTarget.colIdx === colIdx}
                                >
                                    + Drop at bottom
                                </div>
                            {:else if draggedListId}
                                <div 
                                    class="quick-table-col-dropzone is-new-group-zone"
                                    class:drag-over={dropTarget.kind === "new-group-col" && dropTarget.colIdx === colIdx}
                                >
                                    + New Group
                                </div>
                            {/if}
                        {/if}
                    </div>
                {/each}

                {#if layoutMode === "table" && isPointerDragging}
                    {#if isDraggingGroup}
                        <div 
                            class="quick-table-new-col-dropzone"
                            class:drag-over={dropTarget.kind === "new-col-end"}
                        >
                            <span class="quick-table-new-col-icon">+</span>
                            <span>New Column</span>
                        </div>
                    {:else if draggedListId}
                        <div 
                            class="quick-table-new-col-dropzone is-new-group-zone"
                            class:drag-over={dropTarget.kind === "new-group-new-col"}
                        >
                            <span class="quick-table-new-col-icon">+</span>
                            <span>New Column</span>
                        </div>
                    {/if}
                {/if}
            {/if}
        </div>

        {#if isPointerDragging && layoutMode === "table" && colInsertOverlayStyle}
            <div
                use:portal
                class="quick-table-col-insert-overlay"
                style="left: {colInsertOverlayStyle.left}px; top: {colInsertOverlayStyle.top}px; height: {colInsertOverlayStyle.height}px;"
            ></div>
        {/if}
    {:else}
        <!-- =============================================
             Classic Single-Column Hierarchical Tree Body
             ============================================= -->
        <div class="quick-list-scrollable" bind:this={listPaneEl}>
            {#if isStarredMatching}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div 
                    class="quick-modal-list-item is-smart-item"
                    class:is-focused={flatCategories[focusedIndex]?.filepath === STARRED_CATEGORY_PATH}
                    class:is-focused-selected={isFocusedListMode && focusedListSet.has(STARRED_CATEGORY_PATH)}
                    data-filepath={STARRED_CATEGORY_PATH}
                    data-item-id={STARRED_CATEGORY_PATH}
                    role="button"
                    tabindex="0"
                    on:click={() => handleCategoryClick(starredCategory)}
                    title={isFocusedListMode ? "Starred tasks: click to toggle focused list" : "Open Starred tasks list in center view"}
                >
                    <span class="quick-modal-smart-star-icon">
                        {#if isFocusedListMode}
                            <input 
                                type="checkbox" 
                                class="focused-list-item-checkbox" 
                                checked={focusedListSet.has(STARRED_CATEGORY_PATH)}
                                tabindex="-1"
                                on:click|stopPropagation={() => toggleFocusedList(STARRED_CATEGORY_PATH)}
                            />
                        {/if}
                        ★
                    </span>
                    <span class="quick-modal-list-name">{STARRED_CATEGORY_NAME}</span>
                    <div class="quick-modal-item-meta-right">
                        <span class="quick-modal-badge smart-count-badge">{starredCount}</span>
                    </div>
                </div>
            {/if}
            {#if filteredItems.length === 0 && !isStarredMatching}
                <div class="quick-modal-empty">No matching lists or groups found.</div>
            {:else}
                {#each filteredItems as item (item.id)}
                    {#if item.type === "group"}
                        <!-- Group Header -->
                        <div 
                            class="quick-modal-group-container"
                            data-group-id={item.id}
                            class:is-dragging={isForbiddenGroupDrag && draggedListId === item.id}
                            class:drag-over-inside={dropTarget.kind === "group-inside" && dropTarget.groupId === item.id}
                        >
                            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                            <div 
                                class="quick-modal-group-header"
                                class:is-focused-selected={isFocusedListMode && focusedListSet.has(makeFocusedGroupKey(item.id))}
                                data-group-id={item.id}
                                on:mouseenter={() => setHoveredTarget({ id: item.id, name: item.name, type: "group" })}
                                on:mouseleave={() => clearHoveredTarget(item.id)}
                                on:pointerdown={(e) => handleHeaderPointerDown(e, { kind: "group", id: item.id, name: item.name, count: item.items ? item.items.length : 0, isRoot: false })}
                                on:dragstart|preventDefault
                                on:click={() => { if (isFocusedListMode && !wasDragJustPerformed()) void toggleFocusedGroup(item.id); }}
                                on:contextmenu={(e) => showItemContextMenu(e, { id: item.id, name: item.name, type: "group" })}
                            >
                                {#if isFocusedListMode}
                                    <input 
                                        type="checkbox" 
                                        class="focused-list-item-checkbox focused-group-checkbox"
                                        checked={focusedListSet.has(makeFocusedGroupKey(item.id))}
                                        tabindex="-1"
                                        on:pointerdown|stopPropagation
                                        on:click|stopPropagation={() => toggleFocusedGroup(item.id)}
                                    />
                                {/if}
                                <!-- svelte-ignore a11y-click-events-have-key-events -->
                                <span class="quick-modal-group-chevron" on:click|stopPropagation={() => { if (!wasDragJustPerformed()) void toggleGroup(item); }}>
                                    {item.isExpanded ? "▼" : "▶"}
                                </span>

                                {#if editingItemId === item.id}
                                    <input 
                                        type="text" 
                                        class="quick-modal-inline-rename-input"
                                        bind:value={editingName}
                                        bind:this={renameInputEl}
                                        on:blur={commitRename}
                                        on:pointerdown|stopPropagation
                                        on:click|stopPropagation
                                    />
                                {:else}
                                    <span class="quick-modal-group-title" on:click={() => { if (!wasDragJustPerformed()) { if (isFocusedListMode) { void toggleFocusedGroup(item.id); } else { void toggleGroup(item); } } }}>
                                        {item.name}
                                    </span>
                                {/if}
                            </div>

                            <!-- Nested Group Children -->
                            {#if item.isExpanded && item.items}
                                <div class="quick-modal-group-children">
                                    {#each item.items as child (child.id)}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <div 
                                            class="quick-modal-list-item is-nested"
                                            class:is-focused={flatCategories[focusedIndex]?.filepath === child.filepath}
                                            class:is-focused-selected={isFocusedListMode && focusedListSet.has(child.filepath)}
                                            class:is-default-focus={!isFocusedListMode && plugin?.settings?.defaultQuickListFocusFilepath === child.filepath}
                                            class:is-dragging={isPointerDragging && draggedListId === child.id}
                                            class:drag-over-top={dropTarget.kind === "list-item" && dropTarget.targetId === child.id && dropTarget.position === "top"}
                                            class:drag-over-bottom={dropTarget.kind === "list-item" && dropTarget.targetId === child.id && dropTarget.position === "bottom"}
                                            data-filepath={child.filepath}
                                            data-item-id={child.id}
                                            role="button"
                                            tabindex="0"
                                            on:mouseenter={() => setHoveredTarget({ id: child.id || child.filepath, name: child.name, type: "category", filepath: child.filepath })}
                                            on:mouseleave={() => clearHoveredTarget(child.id || child.filepath)}
                                            on:pointerdown={(e) => handleListItemPointerDown(e, child)}
                                            on:dragstart|preventDefault
                                            on:click={() => { if (!wasDragJustPerformed()) void handleCategoryClick(child); }}
                                            on:contextmenu={(e) => showItemContextMenu(e, { id: child.id || "", name: child.name, type: "category", filepath: child.filepath })}
                                        >
                                            <span class="quick-modal-list-icon">
                                                {#if isFocusedListMode}
                                                    <input 
                                                        type="checkbox" 
                                                        class="focused-list-item-checkbox" 
                                                        checked={focusedListSet.has(child.filepath)}
                                                        tabindex="-1"
                                                        on:pointerdown|stopPropagation
                                                        on:click|stopPropagation={() => toggleFocusedList(child.filepath)}
                                                    />
                                                {/if}
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                                </svg>
                                            </span>
                                            
                                            {#if editingItemId === child.id || (child.filepath && editingItemId === child.filepath)}
                                                <input 
                                                    type="text" 
                                                    class="quick-modal-inline-rename-input"
                                                    bind:value={editingName}
                                                    bind:this={renameInputEl}
                                                    on:blur={commitRename}
                                                    on:pointerdown|stopPropagation
                                                    on:click|stopPropagation
                                                />
                                            {:else}
                                                <span class="quick-modal-list-name">{child.name}</span>
                                            {/if}

                                            <div class="quick-modal-item-meta-right">
                                                {#if (taskCounts[child.filepath] ?? 0) > 0}
                                                    <span class="quick-modal-badge">{taskCounts[child.filepath]}</span>
                                                {/if}
                                                {#if !isFocusedListMode && plugin?.settings?.defaultQuickListFocusFilepath === child.filepath}
                                                    <span class="quick-modal-focus-tag" title={t("focus_tag_tooltip")}>
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                                            <circle cx="12" cy="12" r="10"></circle>
                                                            <circle cx="12" cy="12" r="3"></circle>
                                                            <line x1="12" y1="2" x2="12" y2="5"></line>
                                                            <line x1="12" y1="19" x2="12" y2="22"></line>
                                                            <line x1="2" y1="12" x2="5" y2="12"></line>
                                                            <line x1="19" y1="12" x2="22" y2="12"></line>
                                                        </svg>
                                                    </span>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {:else}
                        <!-- Root Category Item -->
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <div 
                            class="quick-modal-list-item"
                            class:is-focused={flatCategories[focusedIndex]?.filepath === item.filepath}
                            class:is-focused-selected={isFocusedListMode && focusedListSet.has(item.filepath)}
                            class:is-default-focus={!isFocusedListMode && plugin?.settings?.defaultQuickListFocusFilepath === item.filepath}
                            class:is-dragging={isPointerDragging && draggedListId === item.id}
                            class:drag-over-top={dropTarget.kind === "list-item" && dropTarget.targetId === item.id && dropTarget.position === "top"}
                            class:drag-over-bottom={dropTarget.kind === "list-item" && dropTarget.targetId === item.id && dropTarget.position === "bottom"}
                            data-filepath={item.filepath}
                            data-item-id={item.id}
                            role="button"
                            tabindex="0"
                            on:mouseenter={() => setHoveredTarget({ id: item.id || item.filepath, name: item.name, type: "category", filepath: item.filepath })}
                            on:mouseleave={() => clearHoveredTarget(item.id || item.filepath)}
                            on:pointerdown={(e) => handleListItemPointerDown(e, item)}
                            on:dragstart|preventDefault
                            on:click={() => { if (!wasDragJustPerformed()) void handleCategoryClick(item); }}
                            on:contextmenu={(e) => showItemContextMenu(e, { id: item.id || "", name: item.name, type: "category", filepath: item.filepath })}
                        >
                            <span class="quick-modal-list-icon">
                                {#if isFocusedListMode}
                                    <input 
                                        type="checkbox" 
                                        class="focused-list-item-checkbox" 
                                        checked={focusedListSet.has(item.filepath)}
                                        tabindex="-1"
                                        on:pointerdown|stopPropagation
                                        on:click|stopPropagation={() => toggleFocusedList(item.filepath)}
                                    />
                                {/if}
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                </svg>
                            </span>
                            
                            {#if editingItemId === item.id || (item.filepath && editingItemId === item.filepath)}
                                <input 
                                    type="text" 
                                    class="quick-modal-inline-rename-input"
                                    bind:value={editingName}
                                    bind:this={renameInputEl}
                                    on:blur={commitRename}
                                    on:pointerdown|stopPropagation
                                    on:click|stopPropagation
                                />
                            {:else}
                                <span class="quick-modal-list-name">{item.name}</span>
                            {/if}

                            <div class="quick-modal-item-meta-right">
                                {#if (taskCounts[item.filepath] ?? 0) > 0}
                                    <span class="quick-modal-badge">{taskCounts[item.filepath]}</span>
                                {/if}
                                {#if !isFocusedListMode && plugin?.settings?.defaultQuickListFocusFilepath === item.filepath}
                                    <span class="quick-modal-focus-tag" title={t("focus_tag_tooltip")}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <circle cx="12" cy="12" r="3"></circle>
                                            <line x1="12" y1="2" x2="12" y2="5"></line>
                                            <line x1="12" y1="19" x2="12" y2="22"></line>
                                            <line x1="2" y1="12" x2="5" y2="12"></line>
                                            <line x1="19" y1="12" x2="22" y2="12"></line>
                                        </svg>
                                    </span>
                                {/if}
                            </div>
                        </div>
                    {/if}
                {/each}
            {/if}
        </div>
    {/if}

    {#if isPointerDragging && activeDragPayload}
        <div
            use:portal
            class="fluent-tasks-quicklist-drag-ghost"
            class:is-group-ghost={activeDragPayload.kind === "group"}
            style="left: {ghostX}px; top: {ghostY}px; width: {ghostWidth}px;"
        >
            <span class="fluent-tasks-quicklist-drag-ghost-icon">
                {#if activeDragPayload.kind === "group" && !activeDragPayload.isRoot}
                    ▼
                {:else}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                    </svg>
                {/if}
            </span>
            <span class="fluent-tasks-quicklist-drag-ghost-title">{activeDragPayload.name}</span>
            {#if (activeDragPayload.count ?? 0) > 0}
                <span class="fluent-tasks-quicklist-drag-ghost-count">{activeDragPayload.count}</span>
            {/if}
        </div>
    {/if}

    {#if !isFocusedListMode}
        <!-- Bottom Action Bar & Status Bar Footer -->
        <div class="quick-modal-list-pane-footer">
            {#if isAddingList}
                <div class="quick-modal-footer-add-wrap">
                    <input 
                        type="text" 
                        class="quick-modal-inline-add-input"
                        placeholder={minimalPlaceholders ? "New list name..." : "New list name (Enter to save, Esc to cancel)..."}
                        bind:value={newListName}
                        bind:this={addListInputEl}
                        on:keydown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                void commitAddList();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                isAddingList = false;
                                newListName = "";
                            }
                        }}
                        on:blur={commitAddList}
                    />
                </div>
            {:else if isAddingGroup}
                <div class="quick-modal-footer-add-wrap">
                    <input 
                        type="text" 
                        class="quick-modal-inline-add-input"
                        placeholder={minimalPlaceholders ? "New group name..." : "New group name (Enter to save, Esc to cancel)..."}
                        bind:value={newGroupName}
                        bind:this={addGroupInputEl}
                        on:keydown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                void commitAddGroup();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                isAddingGroup = false;
                                newGroupName = "";
                            }
                        }}
                        on:blur={commitAddGroup}
                    />
                </div>
            {:else}
                <button class="quick-modal-bottom-btn" on:click={startAddList}>+ New list</button>
                <button class="quick-modal-bottom-btn" on:click={startAddGroup}>+ New group</button>
            {/if}
            <button 
                class="quick-modal-help-btn" 
                on:click={() => showHelpModal = true} 
                title={isChinese() ? "快捷键与操作手势 (? / F1)" : "Shortcuts & Gestures Help (? / F1)"}
                aria-label="Help"
            >
                ?
            </button>
        </div>
    {/if}

    {#if showHelpModal}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div 
            class="quick-modal-help-backdrop" 
            on:click|self={() => showHelpModal = false}
            role="dialog"
            aria-modal="true"
            tabindex="-1"
        >
            <div class="quick-modal-help-card" role="document">
                <div class="quick-modal-help-header">
                    <div class="quick-modal-help-title">
                        <span>{isChinese() ? "快捷键与操作手势指南" : "Shortcuts & Gestures Guide"}</span>
                        <span class="quick-modal-help-title-badge">{layoutMode.toUpperCase()}</span>
                    </div>
                    <button 
                        class="quick-modal-help-close-btn" 
                        on:click={() => showHelpModal = false}
                        title={isChinese() ? "关闭 (Esc)" : "Close (Esc)"}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                <div class="quick-modal-help-content">
                    <div class="quick-help-section">
                        <div class="quick-help-section-title">{isChinese() ? "基础导航与检索" : "Navigation & Search"}</div>
                        <div class="quick-help-grid">
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "方向键切换焦点选择" : "Navigate items / cards"}</span>
                                <div class="quick-help-keys">
                                    <kbd class="quick-help-kbd">↑</kbd>
                                    <kbd class="quick-help-kbd">↓</kbd>
                                    <kbd class="quick-help-kbd">←</kbd>
                                    <kbd class="quick-help-kbd">→</kbd>
                                </div>
                            </div>
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "打开当前选中的清单 / 任务" : "Open selected list or task"}</span>
                                <div class="quick-help-keys"><kbd class="quick-help-kbd">Enter</kbd></div>
                            </div>
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "切换 清单检索 / 全局任务搜索" : "Toggle Lists / Tasks mode"}</span>
                                <div class="quick-help-keys"><kbd class="quick-help-kbd">Tab</kbd></div>
                            </div>
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "重命名当前选中的分组或清单" : "Rename focused group or list"}</span>
                                <div class="quick-help-keys"><kbd class="quick-help-kbd">F2</kbd></div>
                            </div>
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "关闭悬浮窗" : "Close modal"}</span>
                                <div class="quick-help-keys"><kbd class="quick-help-kbd">Esc</kbd></div>
                            </div>
                        </div>
                    </div>

                    <div class="quick-help-section">
                        <div class="quick-help-section-title">{isChinese() ? "画布与表格操作" : "Board & Table Actions"}</div>
                        <div class="quick-help-grid">
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "双向平移画布（滚轮垂直，Shift+滚轮水平）" : "Pan canvas (Wheel / Shift+Wheel)"}</span>
                                <div class="quick-help-keys">
                                    <kbd class="quick-help-kbd">Wheel</kbd>
                                    <kbd class="quick-help-kbd">Shift + Wheel</kbd>
                                </div>
                            </div>
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "RTS 边缘自动平移（鼠标移至视口边缘）" : "Edge Pan (RTS Auto-Scroll at screen edges)"}</span>
                                <div class="quick-help-keys"><kbd class="quick-help-kbd">Edge Pan</kbd></div>
                            </div>
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "拖拽分组卡片自由排布（列间插队、列底插入、新列）" : "Drag group to arrange columns & cards"}</span>
                                <div class="quick-help-keys"><kbd class="quick-help-kbd">Drag Group</kbd></div>
                            </div>
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "拖拽清单至底部形成新分组" : "Drag list to bottom '+ New Group'"}</span>
                                <div class="quick-help-keys"><kbd class="quick-help-kbd">Drag List → New Group</kbd></div>
                            </div>
                        </div>
                    </div>

                    <div class="quick-help-section">
                        <div class="quick-help-section-title">{isChinese() ? "快捷帮助" : "Help & Docs"}</div>
                        <div class="quick-help-grid">
                            <div class="quick-help-row">
                                <span class="quick-help-desc">{isChinese() ? "呼出 / 关闭本快捷帮助窗口" : "Toggle this help overlay"}</span>
                                <div class="quick-help-keys">
                                    <kbd class="quick-help-kbd">?</kbd>
                                    <kbd class="quick-help-kbd">F1</kbd>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    {/if}
</div>
