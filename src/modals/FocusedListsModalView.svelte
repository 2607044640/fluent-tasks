<script lang="ts">
    import { onMount, tick } from "svelte";
    import type { App } from "obsidian";
    import { Notice } from "obsidian";
    import type { DataService } from "../DataService";
    import type { CategoryInfo, SidebarItem, GroupInfo } from "../types";
    import { STARRED_CATEGORY_PATH, STARRED_CATEGORY_NAME } from "../types";
    import { filterSidebarTree } from "../utils/sidebarTreeUtils";
    import { t, isChinese } from "../lang/helpers";

    export let app: App | undefined = undefined;
    void app;
    export let plugin: any = null;
    export let dataService: DataService;
    export let closeModal: () => void = () => {};

    let sidebarItems: SidebarItem[] = [];
    let categories: CategoryInfo[] = [];
    let taskCounts: Record<string, number> = {};
    let starredCount: number = 0;
    let searchQuery: string = "";
    let selectedFilepaths: Set<string> = new Set(plugin?.settings?.focusedLists || []);
    let searchInputEl: HTMLInputElement | null = null;
    let isLoaded: boolean = false;

    onMount(async () => {
        try {
            sidebarItems = await dataService.getSidebarItems();
            categories = await dataService.getCategories();
            starredCount = await dataService.getStarredCount();

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
        } catch (err) {
            console.error("[FocusedListsModal] Failed to load data:", err);
        } finally {
            isLoaded = true;
        }

        await tick();
        searchInputEl?.focus();
    });

    $: filteredItems = searchQuery.trim()
        ? filterSidebarTree(sidebarItems, searchQuery)
        : sidebarItems;

    $: rootCategories = filteredItems.filter(i => i.type === "category") as CategoryInfo[];
    $: groupItems = filteredItems.filter(i => i.type === "group") as GroupInfo[];

    $: isStarredMatching = starredCount > 0 && (
        !searchQuery.trim() ||
        STARRED_CATEGORY_NAME.toLowerCase().includes(searchQuery.toLowerCase())
    );

    function toggleSelect(filepath: string) {
        if (selectedFilepaths.has(filepath)) {
            selectedFilepaths.delete(filepath);
        } else {
            selectedFilepaths.add(filepath);
        }
        selectedFilepaths = new Set(selectedFilepaths);
    }

    function selectAll() {
        for (const cat of categories) {
            selectedFilepaths.add(cat.filepath);
        }
        if (starredCount > 0) {
            selectedFilepaths.add(STARRED_CATEGORY_PATH);
        }
        selectedFilepaths = new Set(selectedFilepaths);
    }

    function clearAll() {
        selectedFilepaths.clear();
        selectedFilepaths = new Set(selectedFilepaths);
    }

    async function handleSave() {
        if (!plugin?.settings) return;
        plugin.settings.focusedLists = Array.from(selectedFilepaths);
        await plugin.saveSettings();
        const noticeMsg = t("focused_lists_saved_notice") || "Focused lists saved";
        new Notice(noticeMsg);
        closeModal();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
            e.preventDefault();
            e.stopPropagation();
            void handleSave();
            return;
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="focused-modal-container" role="dialog" aria-modal="true">
    <!-- Header Bar -->
    <div class="focused-modal-header">
        <div class="focused-modal-search-wrap">
            <svg class="focused-modal-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
                type="text" 
                class="focused-modal-search-input"
                placeholder={t("focused_lists_search_placeholder") || "Search lists..."}
                bind:value={searchQuery}
                bind:this={searchInputEl}
            />
            {#if searchQuery.trim().length > 0}
                <button 
                    type="button" 
                    class="focused-modal-search-clear"
                    on:click={() => { searchQuery = ""; searchInputEl?.focus(); }}
                >
                    ✕
                </button>
            {/if}
        </div>

        <div class="focused-modal-header-actions">
            <span class="focused-modal-count-badge">
                {t("focused_lists_selected_count", selectedFilepaths.size) || `${selectedFilepaths.size} selected`}
            </span>

            <button type="button" class="focused-modal-text-btn" on:click={selectAll}>
                {t("focused_lists_select_all") || "Select all"}
            </button>
            <button type="button" class="focused-modal-text-btn" on:click={clearAll}>
                {t("focused_lists_clear_all") || "Clear all"}
            </button>

            <button type="button" class="focused-modal-save-btn" on:click={handleSave}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>{t("focused_lists_save_btn") || "Save"}</span>
            </button>

            <button type="button" class="focused-modal-close-btn" title="Close" on:click={closeModal}>
                ✕
            </button>
        </div>
    </div>

    <!-- Board with all expanded group cards (Figure 2 layout) -->
    <div class="focused-modal-board">
        {#if !isLoaded}
            <div class="focused-modal-loading">Loading lists...</div>
        {:else if filteredItems.length === 0 && !isStarredMatching}
            <div class="focused-modal-empty">
                {t("focused_lists_no_results") || "No matching lists found."}
            </div>
        {:else}
            <!-- Standalone Root Categories Card -->
            {#if rootCategories.length > 0 || isStarredMatching}
                <div class="focused-modal-card is-root-card">
                    <div class="focused-modal-card-header">
                        <div class="focused-modal-card-title-wrap">
                            <span class="focused-modal-card-icon">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                </svg>
                            </span>
                            <span class="focused-modal-card-title">Lists</span>
                        </div>
                        <span class="focused-modal-card-count">
                            {rootCategories.length + (isStarredMatching ? 1 : 0)}
                        </span>
                    </div>

                    <div class="focused-modal-card-items">
                        {#if isStarredMatching}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <div 
                                class="focused-modal-list-item"
                                class:is-checked={selectedFilepaths.has(STARRED_CATEGORY_PATH)}
                                on:click={() => toggleSelect(STARRED_CATEGORY_PATH)}
                                role="button"
                                tabindex="0"
                            >
                                <input 
                                    type="checkbox"
                                    class="focused-modal-checkbox"
                                    checked={selectedFilepaths.has(STARRED_CATEGORY_PATH)}
                                    on:click|stopPropagation={() => toggleSelect(STARRED_CATEGORY_PATH)}
                                />
                                <span class="focused-modal-list-icon" style="color: var(--todo-star, var(--todo-accent, #8b5cf6));">
                                    ★
                                </span>
                                <span class="focused-modal-list-name">{STARRED_CATEGORY_NAME}</span>
                                {#if starredCount > 0}
                                    <span class="focused-modal-badge">{starredCount}</span>
                                {/if}
                            </div>
                        {/if}

                        {#each rootCategories as cat (cat.id || cat.filepath)}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <div 
                                class="focused-modal-list-item"
                                class:is-checked={selectedFilepaths.has(cat.filepath)}
                                on:click={() => toggleSelect(cat.filepath)}
                                role="button"
                                tabindex="0"
                            >
                                <input 
                                    type="checkbox"
                                    class="focused-modal-checkbox"
                                    checked={selectedFilepaths.has(cat.filepath)}
                                    on:click|stopPropagation={() => toggleSelect(cat.filepath)}
                                />
                                <span class="focused-modal-list-icon">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                    </svg>
                                </span>
                                <span class="focused-modal-list-name" title={cat.name}>{cat.name}</span>
                                {#if (taskCounts[cat.filepath] ?? 0) > 0}
                                    <span class="focused-modal-badge">{taskCounts[cat.filepath]}</span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Group Cards: Fully expanded -->
            {#each groupItems as group (group.id)}
                <div class="focused-modal-card">
                    <div class="focused-modal-card-header">
                        <div class="focused-modal-card-title-wrap">
                            <span class="focused-modal-card-icon">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                </svg>
                            </span>
                            <span class="focused-modal-card-title" title={group.name}>{group.name}</span>
                        </div>
                        <span class="focused-modal-card-count">{group.items?.length || 0}</span>
                    </div>

                    <div class="focused-modal-card-items">
                        {#if !group.items || group.items.length === 0}
                            <div class="focused-modal-empty-group">Empty group</div>
                        {:else}
                            {#each group.items as cat (cat.id || cat.filepath)}
                                <!-- svelte-ignore a11y-click-events-have-key-events -->
                                <div 
                                    class="focused-modal-list-item"
                                    class:is-checked={selectedFilepaths.has(cat.filepath)}
                                    on:click={() => toggleSelect(cat.filepath)}
                                    role="button"
                                    tabindex="0"
                                >
                                    <input 
                                        type="checkbox"
                                        class="focused-modal-checkbox"
                                        checked={selectedFilepaths.has(cat.filepath)}
                                        on:click|stopPropagation={() => toggleSelect(cat.filepath)}
                                    />
                                    <span class="focused-modal-list-icon">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                                        </svg>
                                    </span>
                                    <span class="focused-modal-list-name" title={cat.name}>{cat.name}</span>
                                    {#if (taskCounts[cat.filepath] ?? 0) > 0}
                                        <span class="focused-modal-badge">{taskCounts[cat.filepath]}</span>
                                    {/if}
                                </div>
                            {/each}
                        {/if}
                    </div>
                </div>
            {/each}
        {/if}
    </div>
</div>
