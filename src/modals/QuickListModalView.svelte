<script lang="ts">
    import { onMount } from "svelte";
    import { DataService } from "../DataService";
    import { EventBus } from "../EventBus";
    import { EventName, VIEW_TYPE_MAIN, type CategoryInfo, type SidebarItem } from "../types";
    import type { App } from "obsidian";

    // =============================================
    // Props
    // =============================================
    export let app: App;
    export let dataService: DataService;
    export let showTip: boolean = false;
    export let remainingTips: number = 0;
    export let closeModal: () => void = () => {};

    // =============================================
    // State
    // =============================================
    let sidebarItems: SidebarItem[] = [];
    let categories: CategoryInfo[] = [];
    let taskCounts: Record<string, number> = {};
    let searchQuery: string = "";
    let focusedIndex: number = 0;

    let searchInputEl: HTMLInputElement;
    let modalContainerEl: HTMLElement;

    $: flatCategories = getFilteredCategories(sidebarItems, searchQuery);

    function getFilteredCategories(items: SidebarItem[], query: string): Array<{ item: CategoryInfo; groupName?: string }> {
        const q = query.trim().toLowerCase();
        const result: Array<{ item: CategoryInfo; groupName?: string }> = [];

        for (const item of items) {
            if (item.type === "category") {
                if (!q || item.name.toLowerCase().includes(q)) {
                    result.push({ item });
                }
            } else if (item.type === "group" && Array.isArray(item.items)) {
                for (const child of item.items) {
                    if (!q || child.name.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)) {
                        result.push({ item: child, groupName: item.name });
                    }
                }
            }
        }
        return result;
    }

    onMount(async () => {
        await loadData();
        setTimeout(() => {
            searchInputEl?.focus();
        }, 50);
    });

    async function loadData() {
        sidebarItems = await dataService.getSidebarItems();
        categories = await dataService.getCategories();

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

    async function openCategoryInCenterOnly(cat: CategoryInfo) {
        if (!cat) return;

        // 1. Reveal/Activate TaskMainView in center ONLY (do not touch left sidebar)
        const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_MAIN);
        let leaf = leaves[0];
        if (!leaf) {
            leaf = app.workspace.getLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_MAIN, active: true });
        }
        await app.workspace.revealLeaf(leaf);

        // 2. Select category in main view
        EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat, focusInput: false });

        // 3. Close modal
        closeModal();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.isComposing || e.keyCode === 229) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            if (flatCategories.length > 0) {
                focusedIndex = Math.min(flatCategories.length - 1, focusedIndex + 1);
                scrollFocusedIntoView();
            }
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            if (flatCategories.length > 0) {
                focusedIndex = Math.max(0, focusedIndex - 1);
                scrollFocusedIntoView();
            }
            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (flatCategories.length > 0 && flatCategories[focusedIndex]) {
                void openCategoryInCenterOnly(flatCategories[focusedIndex].item);
            }
            return;
        }

        if (e.key === "Escape") {
            if (searchQuery) {
                e.preventDefault();
                e.stopPropagation();
                searchQuery = "";
                return;
            }
            closeModal();
            return;
        }
    }

    function scrollFocusedIntoView() {
        setTimeout(() => {
            const el = modalContainerEl?.querySelector(".quick-list-item.is-focused") as HTMLElement | null;
            if (el) {
                el.scrollIntoView({ block: "nearest", behavior: "auto" });
            }
        }, 10);
    }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions a11y-no-noninteractive-tabindex a11y-click-events-have-key-events -->
<div 
    class="quick-modal-container quick-list-only-container"
    bind:this={modalContainerEl}
    on:keydown={handleKeydown}
    tabindex="0"
    role="region"
>
    {#if showTip}
        <div class="quick-modal-tip-banner">
            💡 提示: 在 <b>设置 → 快捷键</b> 中为 <code>Fluent Tasks: Open Quick List Modal</code> 设置快捷键 (剩余 {remainingTips} 次提醒)
        </div>
    {/if}

    <!-- Search Header -->
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
            placeholder="Type to filter lists (↑↓ navigate, Enter to open)..."
            bind:value={searchQuery}
            bind:this={searchInputEl}
        />
        {#if searchQuery}
            <button class="quick-modal-filter-clear" on:click={() => { searchQuery = ""; searchInputEl?.focus(); }}>✕</button>
        {/if}
    </div>

    <!-- Lists Grid / Scrollable -->
    <div class="quick-list-scrollable">
        {#if flatCategories.length === 0}
            <div class="quick-modal-empty">No matching lists found.</div>
        {:else}
            {#each flatCategories as entry, index (entry.item.filepath)}
                <div 
                    class="quick-list-item"
                    class:is-focused={focusedIndex === index}
                    role="button"
                    tabindex="0"
                    on:click={() => openCategoryInCenterOnly(entry.item)}
                >
                    <span class="quick-list-icon">📁</span>
                    <div class="quick-list-info">
                        <span class="quick-list-title">{entry.item.name}</span>
                        {#if entry.groupName}
                            <span class="quick-list-group-tag">{entry.groupName}</span>
                        {/if}
                    </div>
                    {#if (taskCounts[entry.item.filepath] ?? 0) > 0}
                        <span class="quick-modal-badge">{taskCounts[entry.item.filepath]}</span>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>

    <!-- Status Bar Footer -->
    <div class="quick-modal-status-bar">
        <span><b>↑↓</b> Navigate</span>
        <span><b>Enter</b> Open in Center View</span>
        <span><b>Esc</b> Close</span>
    </div>
</div>
