<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { dndzone, TRIGGERS, SHADOW_ITEM_MARKER_PROPERTY_NAME } from "svelte-dnd-action";
    import { flip } from "svelte/animate";
    import { EventBus } from "./EventBus";
    import { DataService } from "./DataService";
    import { EventName, VIEW_TYPE_MAIN, type CategoryInfo, type TaskItem, STARRED_CATEGORY_PATH, STARRED_CATEGORY_NAME } from "./types";
    import { killDndGhostElement, removeDndGhostShield, injectDndGhostShield } from "./utils/dndUtils";
    import { portal, autosize } from "./utils/domUtils";
    import { calculatePopoverPosition, type PopoverContentType } from "./utils/popoverUtils";
    import { getRelativeTime, getRecurrenceLabel } from "./utils/timeUtils";
    import { getTaskWeight, clampTaskWeight, applyWeightSort, isTaskEmpty } from "./utils/taskUtils";
    import { DISK_SYNC_DELAY_MS, ANTI_FLICKER_DURATION_MS, POPOVER_HIDE_DELAY_MS } from "./constants";
    import { Menu, setIcon, Platform, Notice, ItemView, type App } from "obsidian";
    import { TaskSearchModal } from "./TaskSearchModal";
    import { RecurrenceService } from "./services/RecurrenceService";
    import { LinkedNoteService } from "./services/LinkedNoteService";
    import { promptDeleteTaskWithLinkedNote } from "./modals/ConfirmDeleteLinkedNoteModal";
    import { TaskStepsModal } from "./modals/TaskStepsModal";
    import { FocusedListsModal } from "./modals/FocusedListsModal";
    import { BackupModal } from "./modals/BackupModal";
    import { MoveToSuggestModal } from "./modals/MoveToSuggestModal";
    import { t, isChinese } from "./lang/helpers";
    import { Logger } from "./Logger";
    import { isQuickListHotkeyAssigned, openHotkeySettingsForQuickList } from "./utils/hotkeyUtils";
    import TaskImageStrip from "./components/TaskImageStrip.svelte";
    import {
        getTitleImages,
        cleanDisplayTitle,
        removeImageFromTaskTitle,
        copyImageToClipboard,
        getImagesFromClipboard,
        saveImageAttachment,
        getAllImagesInTask,
        cleanupOrphanImages,
        cleanupOrphanImageAttachment,
        isSameImageRef,
    } from "./utils/imageAttachmentUtils";
    import { ImagePreviewModal } from "./modals/ImagePreviewModal";
    import type { TrashedImageBackup } from "./types";

    let hoveredThumbnail: { task: TaskItem; imageRef: string } | null = null;
    let currentHoveredTask: TaskItem | null = null;
    $: actualApp = (dataService?.app || plugin?.app || (window as any).app) as App;

    // =============================================
    // Props
    // =============================================
    export let dataService: DataService;
    export let plugin: any;

    // =============================================
    // State
    // =============================================
    let currentCategory: CategoryInfo | null = null;
    let rawIncompleteTasks: TaskItem[] = [];
    let rawCompletedTasks: TaskItem[] = [];
    let incompleteTasks: TaskItem[] = [];
    let completedTasks: TaskItem[] = [];
    let newTaskTitle: string = "";
    let showCompleted: boolean = false;
    let selectedTaskId: string = "";
    let addTaskInputEl: HTMLTextAreaElement;
    let wrapTaskTitles: boolean = plugin?.settings?.wrapTaskTitles ?? true;
    let mainListTitleSize: "small" | "medium" | "large" = plugin?.settings?.mainListTitleSize ?? "medium";
    let showListTitleInHeader: boolean = plugin?.settings?.showListTitleInHeader ?? false;
    let isAddTaskFocused: boolean = false;
    let justCreatedTaskId: string | null = null;
    let justCreatedTimeout: any = null;
    let enableTaskWeightMode: boolean = plugin?.settings?.enableTaskWeightMode ?? false;
    let centerAlignTasks: boolean = plugin?.settings?.centerAlignTasks ?? true;
    let hiddenStarMode: boolean = plugin?.settings?.hiddenStarMode ?? plugin?.settings?.disableStars ?? false;
    let disableStars: boolean = hiddenStarMode;
    let hideLeftSidebar: boolean = plugin?.settings?.hideLeftSidebar ?? false;
    let hasFloatingModalHotkey: boolean = true;
    $: showNoHotkeyWarning = hideLeftSidebar && !hasFloatingModalHotkey;

    // Focused Lists State
    let enableFocusedLists: boolean = plugin?.settings?.enableFocusedLists ?? false;
    let focusedCategories: CategoryInfo[] = [];
    let dragOverFocusedPath: string = "";
    let lastFocusedDropTime: number = 0;
    let isDraggingFocusedPills: boolean = false;
    let lastFocusedPillDragTime: number = 0;
    let preDragFocusedCategories: CategoryInfo[] = [];

    function isShadowPill(cat: CategoryInfo): boolean {
        return Boolean((cat as any)[SHADOW_ITEM_MARKER_PROPERTY_NAME]);
    }

    async function updateFocusedCategories() {
        enableFocusedLists = plugin?.settings?.enableFocusedLists ?? false;
        if (!enableFocusedLists) {
            focusedCategories = [];
            return;
        }
        const paths: string[] = plugin?.settings?.focusedLists || [];
        if (paths.length === 0) {
            focusedCategories = [];
            return;
        }
        try {
            const allCats = await dataService.getCategories();
            const map = new Map<string, CategoryInfo>();
            for (const c of allCats) {
                map.set(c.filepath, c);
            }
            map.set(STARRED_CATEGORY_PATH, {
                id: STARRED_CATEGORY_PATH,
                name: STARRED_CATEGORY_NAME,
                filepath: STARRED_CATEGORY_PATH,
                type: "category",
                isSmartList: true
            });
            const list: CategoryInfo[] = [];
            for (const p of paths) {
                const found = map.get(p);
                if (found) {
                    list.push({ ...found, id: found.id || found.filepath });
                }
            }
            focusedCategories = list;
        } catch (err) {
            console.error("[TaskMainView] Error updating focused categories:", err);
        }
    }

    function openFocusedListsModal() {
        new FocusedListsModal(actualApp, plugin, dataService).open();
    }

    function handleFocusedPillsConsider(e: CustomEvent<{ items: CategoryInfo[]; info: any }>) {
        if (!isDraggingFocusedPills) {
            isDraggingFocusedPills = true;
            preDragFocusedCategories = [...focusedCategories];
        }
        focusedCategories = e.detail.items;
    }

    async function handleFocusedPillsFinalize(e: CustomEvent<{ items: CategoryInfo[]; info: any }>) {
        isDraggingFocusedPills = false;
        lastFocusedPillDragTime = Date.now();
        lastFocusedDropTime = Date.now();

        if (e.detail.info?.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) {
            if (preDragFocusedCategories.length > 0) {
                focusedCategories = [...preDragFocusedCategories];
            }
            preDragFocusedCategories = [];
            return;
        }

        const cleanItems = (e.detail.items || []).filter(cat => !isShadowPill(cat));
        focusedCategories = cleanItems;
        preDragFocusedCategories = [];

        if (plugin?.settings) {
            const reorderedPaths: string[] = cleanItems.map(c => c.filepath).filter(Boolean);
            const originalPaths: string[] = plugin.settings.focusedLists || [];
            const missingPaths: string[] = originalPaths.filter((p: string) => !reorderedPaths.includes(p));
            const newFocusedLists: string[] = [...reorderedPaths, ...missingPaths];

            const hasChanged = originalPaths.length !== newFocusedLists.length ||
                originalPaths.some((p: string, i: number) => p !== newFocusedLists[i]);

            if (hasChanged) {
                plugin.settings.focusedLists = newFocusedLists;
                await plugin.saveSettings();
            }
        }
    }

    function handleSelectFocusedCategory(cat: CategoryInfo) {
        if (isDraggingFocusedPills) return;
        if (Date.now() - lastFocusedPillDragTime < 300) return;
        if (Date.now() - lastFocusedDropTime < 300) return;
        if (!cat || currentCategory?.filepath === cat.filepath) return;
        EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat });
    }

    // Inline Category Rename State
    let isEditingCategoryName: boolean = false;
    let editingCategoryName: string = "";
    let categoryRenameInputEl: HTMLInputElement | null = null;
    let isCommittingCategoryRename: boolean = false;
    let isCategoryTitleHovered: boolean = false;
    let isComposingCategoryTitle: boolean = false;

    function checkHotkeyStatus() {
        hideLeftSidebar = plugin?.settings?.hideLeftSidebar ?? false;
        if (plugin?.app) {
            hasFloatingModalHotkey = isQuickListHotkeyAssigned(plugin.app);
        }
    }

    function handleOpenHotkeySettings() {
        if (plugin?.app) {
            openHotkeySettingsForQuickList(plugin.app);
        }
    }

    // In-List Search State (Ctrl+F)
    let isSearchOpen: boolean = false;
    let searchQuery: string = "";
    let taskSearchResults: Array<{ task: TaskItem; category: CategoryInfo; matchField: string }> = [];
    let isSearchingTasks: boolean = false;
    let taskFocusedIndex: number = 0;
    let hideCompleted: boolean = plugin?.settings?.searchHideCompleted ?? false;
    let searchInputEl: HTMLInputElement | null = null;
    let taskResultsContainerEl: HTMLElement | null = null;
    let mainContainerEl: HTMLElement | null = null;
    let searchDebounceTimer: any = null;
    let isSearchComposing: boolean = false;

    // Multi-Select Mode State
    let isMultiSelectMode: boolean = false;
    let selectedTaskIds: Set<string> = new Set();

    // Weight Mode State
    let editingWeightTaskId: string | null = null;
    let editingWeightValue: string = "";
    let pendingWeightReSort: boolean = false;

    // DND requires items to have an `id` field — our TaskItem already has it
    const DND_FLIP_DURATION = 200;

    // Custom auto-scroll state (replaces laggy built-in svelte-dnd-action scroller)
    let scrollAnimId: number | null = null;
    let scrollSpeed = 0;
    let scrollContainerEl: HTMLElement | null = null;
    let isDndActive = false;
    let preDragIncompleteTasks: TaskItem[] = [];
    let preDragCompletedTasks: TaskItem[] = [];
    const AUTO_SCROLL_EDGE_ZONE = 60;
    const AUTO_SCROLL_MAX_SPEED = 12;
    const AUTO_SCROLL_MIN_SPEED = 2;

    // =============================================
    // Meta Badge Hover Popover
    // =============================================
    let popoverTask: TaskItem | null = null;
    let popoverType: 'why' | 'svg' | 'custom' | 'title' | 'guide' | 'steps' | null = null;
    let popoverSvgIndex: number = 0;
    let popoverX: number = 0;
    let popoverY: number = 0;
    let popoverVisible: boolean = false;
    let popoverTimeout: any = null;
    let showHintsModal: boolean = false;

    // Lightbox modal state for full-screen / zoom SVG view
    let lightboxData: { isInline: boolean; content: string; srcUrl: string; title: string; cleanPath: string } | null = null;
    let showSvgSaveConfirmModal: boolean = false;
    let showSvgDeleteConfirmModal: boolean = false;
    let svgLinkedTaskCount: number = 0;
    let svgLinkedTaskTitles: string[] = [];
    let showPluginDownloadModal: boolean = false;
    let nameCopiedHint: boolean = false;
    let nameCopiedTimer: any = null;
    let isAutoAlignActive: boolean = true;

    function toggleAutoAlign() {
        isAutoAlignActive = !isAutoAlignActive;
        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        if (quickEditor?.setAutoAlign) {
            quickEditor.setAutoAlign(isAutoAlignActive);
        } else if (quickEditor) {
            quickEditor.autoAlign = isAutoAlignActive;
        }
    }

    function applySmartLayout() {
        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        const svgEl = document.querySelector('.svg-lightbox-content svg') as SVGSVGElement | null;
        if (quickEditor?.smartLayout) {
            quickEditor.smartLayout(svgEl);
        }
    }
    const svgResolveCache = new Map<string, { isInline: boolean; content: string; srcUrl: string; cleanPath: string }>();

    function resolveSvgItem(svgStr: string): { isInline: boolean; content: string; srcUrl: string; cleanPath: string } {
        if (!svgStr) return { isInline: false, content: "", srcUrl: "", cleanPath: "" };
        const cached = svgResolveCache.get(svgStr);
        if (cached) return cached;

        const trimmed = svgStr.trim();
        if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml") || trimmed.includes("</svg>")) {
            const processed = stampLightboxSvgMarkup(trimmed);
            const res = { isInline: true, content: processed, srcUrl: "", cleanPath: "" };
            svgResolveCache.set(svgStr, res);
            return res;
        }
        // It's a vault file path or wikilink (e.g. OneNote/.../assets/eye_of_knowledge_sea_circular.svg)
        const cleanPath = trimmed.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        let file: any = null;
        if (plugin?.app?.metadataCache) {
            file = plugin.app.metadataCache.getFirstLinkpathDest(cleanPath, currentCategory?.filepath || "");
        }
        if (!file && plugin?.app?.vault) {
            file = plugin.app.vault.getAbstractFileByPath(cleanPath);
        }
        const rawSrc = file && plugin?.app?.vault?.adapter ? plugin.app.vault.adapter.getResourcePath(file.path) : cleanPath;
        const srcUrl = rawSrc ? (rawSrc.includes("?") ? `${rawSrc}&t=${Date.now()}` : `${rawSrc}?t=${Date.now()}`) : "";
        const res = {
            isInline: false,
            content: trimmed,
            srcUrl: srcUrl || cleanPath,
            cleanPath: file?.path || cleanPath,
        };
        svgResolveCache.set(svgStr, res);
        return res;
    }

    function stampLightboxSvgMarkup(rawSvg: string, cleanPath?: string): string {
        let processed = (rawSvg || "").trim();
        processed = processed.replace(/(<svg\b[^>]*?)\s+data-a1-svg-path="[^"]*"/gi, "$1");
        const svgTagMatch = processed.match(/<svg\b[^>]*>/i);
        if (svgTagMatch && !/\bviewBox\s*=/i.test(svgTagMatch[0])) {
            const widthMatch = svgTagMatch[0].match(/\bwidth=["']?(\d+(?:\.\d+)?)(?:px)?["']?/i);
            const heightMatch = svgTagMatch[0].match(/\bheight=["']?(\d+(?:\.\d+)?)(?:px)?["']?/i);
            if (widthMatch && heightMatch) {
                processed = processed.replace(/<svg\b/i, `<svg viewBox="0 0 ${widthMatch[1]} ${heightMatch[1]}"`);
            }
        }
        if (cleanPath) {
            const safePath = cleanPath.replace(/"/g, "&quot;");
            processed = processed.replace(/<svg\b/i, `<svg data-a1-svg-path="${safePath}"`);
        }
        return processed;
    }

    async function refreshActiveLightboxFromDisk(targetPath?: string) {
        if (!lightboxData || !lightboxData.cleanPath || !plugin?.app) return;
        const targetClean = targetPath ? targetPath.replace(/\\/g, "/") : "";
        const currentClean = lightboxData.cleanPath.replace(/\\/g, "/");

        if (targetClean && !currentClean.endsWith(targetClean) && !targetClean.endsWith(currentClean)) {
            return;
        }

        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        if (quickEditor?.isRecentSelfSave && quickEditor.isRecentSelfSave(targetClean || currentClean)) {
            return;
        }
        if (quickEditor?.isSvgDirty && quickEditor.isSvgDirty()) {
            return;
        }

        let file: any = null;
        if (plugin.app.metadataCache) {
            file = plugin.app.metadataCache.getFirstLinkpathDest(lightboxData.cleanPath, currentCategory?.filepath || "");
        }
        if (!file && plugin.app.vault) {
            file = plugin.app.vault.getAbstractFileByPath(lightboxData.cleanPath);
        }
        if (!file && plugin.app.vault) {
            const all = plugin.app.vault.getFiles();
            file = all.find((f: any) => f.path === lightboxData!.cleanPath || f.name === lightboxData!.cleanPath || f.path.endsWith("/" + lightboxData!.cleanPath)) || null;
        }

        if (file) {
            try {
                let rawXml = "";
                if (await plugin.app.vault.adapter.exists(file.path)) {
                    rawXml = await plugin.app.vault.adapter.read(file.path);
                } else {
                    rawXml = await plugin.app.vault.read(file);
                }
                if (quickEditor?.isRecentSelfSave && quickEditor.isRecentSelfSave(file.path, rawXml)) {
                    return;
                }
                const processed = stampLightboxSvgMarkup(rawXml, file.path);

                if (lightboxData && lightboxData.content !== processed) {
                    lightboxData = {
                        ...lightboxData,
                        isInline: true,
                        cleanPath: file.path,
                        content: processed,
                    };
                    svgResolveCache.clear();
                    await tick();
                    const svgEl = document.querySelector('.svg-lightbox-content svg') as SVGSVGElement | null;
                    if (svgEl) {
                        svgEl.setAttribute('data-a1-svg-path', file.path);
                        quickEditor?.registerActiveSvg?.(svgEl);
                    }
                }
            } catch (err) {
                console.error("Failed to hot-reload active SVG lightbox:", err);
            }
        }
    }

    function openSvgLightbox(e: MouseEvent | KeyboardEvent, svgStr: string, title: string = "Visual Memory Aid") {
        e.stopPropagation();
        if (popoverTimeout) clearTimeout(popoverTimeout);
        popoverVisible = false;
        showSvgDeleteConfirmModal = false;
        // Invalidate resolve cache for this SVG item so any external edits are loaded fresh
        svgResolveCache.delete(svgStr);
        const res = resolveSvgItem(svgStr);
        let content = res.content;
        if (res.cleanPath && content.includes("<svg")) {
            content = stampLightboxSvgMarkup(content, res.cleanPath);
        }
        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        if (quickEditor?.getAutoAlign) {
            isAutoAlignActive = quickEditor.getAutoAlign();
        } else if (quickEditor?.autoAlign !== undefined) {
            isAutoAlignActive = !!quickEditor.autoAlign;
        } else {
            isAutoAlignActive = true;
        }

        lightboxData = {
            isInline: res.isInline,
            content,
            srcUrl: res.srcUrl,
            title,
            cleanPath: res.cleanPath,
        };

        void tick().then(() => {
            const modalEl = document.querySelector('.svg-lightbox-modal') as HTMLElement | null;
            modalEl?.focus();
            const svgEl = document.querySelector('.svg-lightbox-content svg') as SVGSVGElement | null;
            if (svgEl) {
                if (res.cleanPath) {
                    svgEl.setAttribute('data-a1-svg-path', res.cleanPath);
                }
                const editor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
                editor?.registerActiveSvg?.(svgEl);
            }
        });

        // Always read fresh markup from disk if it's an .svg vault file
        if (res.cleanPath && res.cleanPath.toLowerCase().endsWith('.svg') && plugin?.app) {
            let file: any = null;
            if (plugin.app.metadataCache) {
                file = plugin.app.metadataCache.getFirstLinkpathDest(res.cleanPath, currentCategory?.filepath || "");
            }
            if (!file && plugin.app.vault) {
                file = plugin.app.vault.getAbstractFileByPath(res.cleanPath);
            }
            if (!file && plugin.app.vault) {
                const all = plugin.app.vault.getFiles();
                file = all.find((f: any) => f.path === res.cleanPath || f.name === res.cleanPath || f.path.endsWith("/" + res.cleanPath)) || null;
            }
            if (file) {
                const readPromise = plugin.app.vault.adapter.exists(file.path)
                    ? plugin.app.vault.adapter.read(file.path)
                    : plugin.app.vault.read(file);
                readPromise.then((rawXml: string) => {
                    const processed = stampLightboxSvgMarkup(rawXml, file.path);
                    if (lightboxData && (lightboxData.cleanPath === res.cleanPath || lightboxData.cleanPath === file.path)) {
                        lightboxData = {
                            ...lightboxData,
                            isInline: true,
                            cleanPath: file.path,
                            content: processed,
                        };
                        svgResolveCache.set(svgStr, {
                            isInline: true,
                            content: processed,
                            srcUrl: res.srcUrl,
                            cleanPath: file.path,
                        });
                        void tick().then(() => {
                            const svgEl = document.querySelector('.svg-lightbox-content svg') as SVGSVGElement | null;
                            if (svgEl) {
                                svgEl.setAttribute('data-a1-svg-path', file.path);
                                const editor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
                                editor?.registerActiveSvg?.(svgEl);
                            }
                        });
                    }
                }).catch((err: any) => console.error("Failed to read SVG file for lightbox:", err));
            }
        }
    }

    function isSvgQuickEditorInstalled(): boolean {
        return !!(window as any).svgQuickEditor ||
               !!(window as any).a1SvgQuickEditor ||
               !!(plugin?.app as any)?.plugins?.getPlugin?.("svg-quick-editor") ||
               !!(plugin?.app as any)?.plugins?.getPlugin?.("a1-svg-quick-editor");
    }

    function openObsidianPluginSettings() {
        const appAny = plugin?.app as any;
        if (appAny?.setting) {
            appAny.setting.open();
            appAny.setting.openTabById("community-plugins");
        }
        copyPluginName();
        const NoticeCtor = (window as any).Notice || Notice;
        new NoticeCtor(isChinese()
            ? "已打开社区插件设置，并已复制「SVG Quick Editor」到剪贴板，请点击“浏览”直接粘贴搜索！"
            : "Opened Community Plugins settings and copied 'SVG Quick Editor' to clipboard. Click 'Browse' and paste to search!");
        showPluginDownloadModal = false;
    }

    function openPluginGithub() {
        const url = "https://github.com/2607044640/svg-quick-editor";
        window.open(url, "_blank");
        showPluginDownloadModal = false;
    }

    function copyPluginName() {
        const name = "SVG Quick Editor";
        try {
            navigator.clipboard.writeText(name);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = name;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
        }
        nameCopiedHint = true;
        if (nameCopiedTimer) clearTimeout(nameCopiedTimer);
        nameCopiedTimer = setTimeout(() => {
            nameCopiedHint = false;
        }, 6000);
    }

    function closeSvgLightbox() {
        lightboxData = null;
        showSvgSaveConfirmModal = false;
        showSvgDeleteConfirmModal = false;
        svgLinkedTaskCount = 0;
        svgLinkedTaskTitles = [];
        showPluginDownloadModal = false;
        nameCopiedHint = false;
        if (nameCopiedTimer) clearTimeout(nameCopiedTimer);
        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        quickEditor?.clearSvgHistory?.();
    }

    let showSaveToast: boolean = false;
    let saveToastText: string = "";
    let saveToastTimer: any = null;

    function triggerSaveToast(msg: string) {
        saveToastText = msg;
        showSaveToast = true;
        if (saveToastTimer) clearTimeout(saveToastTimer);
        saveToastTimer = setTimeout(() => {
            showSaveToast = false;
        }, 3000);
    }

    function requestCloseSvgLightbox() {
        if (showPluginDownloadModal) {
            showPluginDownloadModal = false;
            return;
        }
        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        quickEditor?.commitActiveOverlay?.();
        quickEditor?.clearHover?.();
        const svgEl = document.querySelector('.svg-lightbox-content svg') as SVGSVGElement | null;
        const isDirty = quickEditor?.isSvgDirty ? quickEditor.isSvgDirty(svgEl) : false;
        if (isDirty) {
            showSvgSaveConfirmModal = true;
            return;
        }
        showSvgSaveConfirmModal = false;
        closeSvgLightbox();
    }

    async function saveAndCloseSvgLightbox() {
        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        quickEditor?.commitActiveOverlay?.();
        quickEditor?.clearHover?.();
        const svgEl = document.querySelector('.svg-lightbox-content svg') as SVGSVGElement | null;
        if (svgEl && lightboxData?.cleanPath) {
            svgEl.setAttribute('data-a1-svg-path', lightboxData.cleanPath);
        }
        if (quickEditor?.saveCurrentSvg) {
            const ok = await quickEditor.saveCurrentSvg(svgEl, false);
            if (ok === false) {
                return;
            }
        } else if (lightboxData?.cleanPath && plugin?.app?.vault) {
            const contentToSave = svgEl ? svgEl.outerHTML : lightboxData.content;
            try {
                if (await plugin.app.vault.adapter.exists(lightboxData.cleanPath)) {
                    await plugin.app.vault.adapter.write(lightboxData.cleanPath, contentToSave);
                } else {
                    const file = plugin.app.vault.getAbstractFileByPath(lightboxData.cleanPath);
                    if (file) await plugin.app.vault.modify(file, contentToSave);
                }
            } catch (e) {
                console.error("Failed to save SVG in lightbox:", e);
            }
        }
        showSvgSaveConfirmModal = false;
        closeSvgLightbox();
    }

    function discardAndCloseSvgLightbox() {
        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        quickEditor?.cancelActiveOverlay?.();
        const svgEl = document.querySelector('.svg-lightbox-content svg') as SVGSVGElement | null;
        if (quickEditor?.discardCurrentSvg) {
            quickEditor.discardCurrentSvg(svgEl);
        }
        showSvgSaveConfirmModal = false;
        closeSvgLightbox();
    }

    function cancelSvgSavePrompt() {
        showSvgSaveConfirmModal = false;
        const modalEl = document.querySelector('.svg-lightbox-modal') as HTMLElement | null;
        modalEl?.focus();
    }

    async function saveSvgLightboxInPlace() {
        if (!lightboxData) return;
        const name = lightboxData.cleanPath ? (lightboxData.cleanPath.split("/").pop() || "SVG") : "SVG";
        const msg = isChinese() ? `SVG 已保存: ${name}` : `SVG saved: ${name}`;

        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        quickEditor?.commitActiveOverlay?.();
        quickEditor?.clearHover?.();
        const svgEl = document.querySelector('.svg-lightbox-content svg') as SVGSVGElement | null;
        if (svgEl && lightboxData.cleanPath) {
            svgEl.setAttribute('data-a1-svg-path', lightboxData.cleanPath);
        }

        if (quickEditor?.saveCurrentSvg) {
            await quickEditor.saveCurrentSvg(svgEl, true);
        } else if (lightboxData.cleanPath && plugin?.app?.vault) {
            const contentToSave = svgEl ? svgEl.outerHTML : lightboxData.content;
            try {
                if (await plugin.app.vault.adapter.exists(lightboxData.cleanPath)) {
                    await plugin.app.vault.adapter.write(lightboxData.cleanPath, contentToSave);
                } else {
                    const file = plugin.app.vault.getAbstractFileByPath(lightboxData.cleanPath);
                    if (file) await plugin.app.vault.modify(file, contentToSave);
                }
                triggerSaveToast(msg);
            } catch (err) {
                console.error("Failed to save SVG in place:", err);
            }
        } else {
            triggerSaveToast(msg);
        }
    }

    async function promptDeleteSvgLightbox() {
        if (!lightboxData) return;
        const cleanPath = lightboxData.cleanPath || "";
        const res = await countLinkedTasksForSvg(cleanPath);
        svgLinkedTaskCount = res.count;
        svgLinkedTaskTitles = res.titles;
        showSvgDeleteConfirmModal = true;
    }

    async function countLinkedTasksForSvg(cleanPath: string): Promise<{ count: number; titles: string[] }> {
        if (!cleanPath) return { count: 0, titles: [] };
        const cleanTarget = cleanPath.replace(/\\/g, "/").trim();
        const fname = cleanTarget.split("/").pop() || "";
        if (!fname) return { count: 0, titles: [] };

        const matchesSvg = (s: string) => {
            if (!s) return false;
            const c = s.replace(/\\/g, "/").replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
            if (cleanTarget && c === cleanTarget) return true;
            if (fname && (c.endsWith("/" + fname) || (cleanTarget && cleanTarget.endsWith("/" + c)))) return true;
            if (fname && c.split("/").pop() === fname) return true;
            return false;
        };

        const titles: string[] = [];
        // 1. Check in-memory tasks of current category
        for (const t of [...rawIncompleteTasks, ...rawCompletedTasks]) {
            if (t.svgs && t.svgs.some(matchesSvg)) {
                titles.push(t.title || "Untitled task");
            }
        }

        // 2. Scan other TodoData category files in vault
        try {
            if (plugin?.app?.vault) {
                const files = plugin.app.vault.getFiles();
                const todoFiles = files.filter((f: any) =>
                    f.extension === "md" &&
                    (f.path.startsWith("TodoData/") || f.path.includes("TodoData")) &&
                    (!currentCategory || f.path !== currentCategory.filepath)
                );
                for (const file of todoFiles) {
                    const content = await plugin.app.vault.read(file);
                    if (!content.includes("%%{") || !content.includes("svgs")) continue;
                    const lines = content.split("\n");
                    for (const line of lines) {
                        const match = line.match(/%%(\{.*?\})%%/);
                        if (!match) continue;
                        try {
                            const meta = JSON.parse(match[1]);
                            if (Array.isArray(meta.svgs) && meta.svgs.some(matchesSvg)) {
                                const rawTitle = line.replace(/^- \[([ x])\]\s*/, "").replace(/\s*%%\{.*?\}%%/, "").trim();
                                titles.push(rawTitle || "Untitled task");
                            }
                        } catch {}
                    }
                }
            }
        } catch (e) {
            console.error("Error detecting linked tasks for SVG in lightbox:", e);
        }

        return { count: titles.length, titles };
    }

    async function confirmDeleteSvgFromLightbox() {
        if (!lightboxData) return;
        const cleanPath = lightboxData.cleanPath;
        const filename = cleanPath ? (cleanPath.split("/").pop() || "SVG") : "SVG";

        // 1. Delete physical file from vault
        if (cleanPath && plugin?.app) {
            try {
                let file: any = null;
                if (plugin.app.metadataCache) {
                    file = plugin.app.metadataCache.getFirstLinkpathDest(cleanPath, currentCategory?.filepath || "");
                }
                if (!file && plugin.app.vault) {
                    file = plugin.app.vault.getAbstractFileByPath(cleanPath);
                }
                if (!file && plugin.app.vault) {
                    const all = plugin.app.vault.getFiles();
                    file = all.find((f: any) => f.path === cleanPath || f.name === cleanPath || f.path.endsWith("/" + cleanPath)) || null;
                }
                if (file) {
                    await plugin.app.vault.trash(file, true);
                } else if (await plugin.app.vault.adapter.exists(cleanPath)) {
                    await plugin.app.vault.adapter.remove(cleanPath);
                }
            } catch (err) {
                console.error("Failed to trash SVG file:", err);
            }
        }

        // 2. Unlink from tasks in current category and all TodoData files
        await unlinkSvgFromTasks(cleanPath, filename);

        // 3. Clean up any broken markdown embeds in notes so no missing link box is left
        await cleanupSvgEmbedsInNotes(cleanPath);

        // 4. Close modals
        showSvgDeleteConfirmModal = false;
        closeSvgLightbox();

        // 5. Notify
        const NoticeCtor = (window as any).Notice || Notice;
        if (svgLinkedTaskCount > 0) {
            new NoticeCtor(isChinese() ? `SVG 已删除并解绑任务: ${filename}` : `Deleted SVG and unlinked: ${filename}`);
        } else {
            new NoticeCtor(isChinese() ? `SVG 已删除: ${filename}` : `Deleted SVG: ${filename}`);
        }

        // 6. Notify window listeners
        window.dispatchEvent(new CustomEvent("a1-svg-updated", { detail: { path: cleanPath, deleted: true } }));
        window.dispatchEvent(new CustomEvent("fluent-tasks-svg-deleted", { detail: { path: cleanPath } }));
    }

    async function cleanupSvgEmbedsInNotes(targetPath: string) {
        if (!targetPath || !plugin?.app?.vault) return;
        const cleanTarget = targetPath.replace(/\\/g, "/").trim();
        const fname = cleanTarget.split("/").pop() || "";
        if (!fname) return;

        const escapedName = fname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const embedRegexes = [
            new RegExp(`!?\\[\\[(?:[^\\]]*\\/)?${escapedName}(?:\\|[^\\]]*)?\\]\\]`, "gi"),
            new RegExp(`!?\\[[^\\]]*\\]\\([^)]*${escapedName}[^)]*\\)`, "gi"),
        ];

        try {
            const files = plugin.app.vault.getFiles().filter((f: any) => f.extension === "md");
            for (const file of files) {
                const content = await plugin.app.vault.read(file);
                if (!content.includes(fname)) continue;

                let modified = false;
                const lines = content.split("\n");
                const newLines: string[] = [];

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    let isPureEmbed = false;
                    for (const rx of embedRegexes) {
                        rx.lastIndex = 0;
                        const match = rx.exec(line.trim());
                        if (match && match[0] === line.trim()) {
                            isPureEmbed = true;
                            break;
                        }
                    }

                    if (isPureEmbed) {
                        modified = true;
                        continue;
                    }

                    let newLine = line;
                    for (const rx of embedRegexes) {
                        rx.lastIndex = 0;
                        if (rx.test(newLine)) {
                            newLine = newLine.replace(rx, "").trimEnd();
                            modified = true;
                        }
                    }
                    newLines.push(newLine);
                }

                if (modified) {
                    await plugin.app.vault.modify(file, newLines.join("\n"));
                }
            }
        } catch (e) {
            console.error("Failed to clean up SVG embeds in notes:", e);
        }
    }

    async function unlinkSvgFromTasks(cleanPath: string, filename: string) {
        if (!cleanPath && !filename) return;
        const cleanTarget = (cleanPath || "").replace(/\\/g, "/").trim();
        const fname = filename || cleanTarget.split("/").pop() || "";

        const matchesSvg = (s: string) => {
            if (!s) return false;
            const c = s.replace(/\\/g, "/").trim();
            if (cleanTarget && c === cleanTarget) return true;
            if (fname && (c.endsWith("/" + fname) || (cleanTarget && cleanTarget.endsWith("/" + c)))) return true;
            if (fname && c.split("/").pop() === fname) return true;
            return false;
        };

        // Synchronously update in-memory tasks for immediate UI response (Anti-Flicker Optimistic UI)
        let anyModified = false;
        rawIncompleteTasks = rawIncompleteTasks.map(t => {
            if (t.svgs && t.svgs.length > 0) {
                const remaining = t.svgs.filter(s => !matchesSvg(s));
                if (remaining.length !== t.svgs.length) {
                    anyModified = true;
                    return {
                        ...t,
                        svgs: remaining.length > 0 ? remaining : undefined
                    };
                }
            }
            return t;
        });

        rawCompletedTasks = rawCompletedTasks.map(t => {
            if (t.svgs && t.svgs.length > 0) {
                const remaining = t.svgs.filter(s => !matchesSvg(s));
                if (remaining.length !== t.svgs.length) {
                    anyModified = true;
                    return {
                        ...t,
                        svgs: remaining.length > 0 ? remaining : undefined
                    };
                }
            }
            return t;
        });

        if (anyModified) {
            incompleteTasks = applyWeightSort(rawIncompleteTasks, !!plugin?.settings?.enableTaskWeightMode);
            completedTasks = applyWeightSort(rawCompletedTasks, !!plugin?.settings?.enableTaskWeightMode);
            if (currentCategory) {
                const allCurrent = [...rawIncompleteTasks, ...rawCompletedTasks];
                await dataService.saveTasks(currentCategory.filepath, allCurrent);
            }
        }

        // Also clean up across other categories in TodoData
        try {
            const categories = await dataService.getCategories();
            for (const cat of categories) {
                if (currentCategory && cat.filepath === currentCategory.filepath) continue;
                const tasks = await dataService.getTasks(cat.filepath);
                let catModified = false;
                const updatedTasks = tasks.map(t => {
                    if (t.svgs && t.svgs.length > 0) {
                        const remaining = t.svgs.filter(s => !matchesSvg(s));
                        if (remaining.length !== t.svgs.length) {
                            catModified = true;
                            return {
                                ...t,
                                svgs: remaining.length > 0 ? remaining : undefined
                            };
                        }
                    }
                    return t;
                });
                if (catModified) {
                    await dataService.saveTasks(cat.filepath, updatedTasks);
                }
            }
        } catch (e) {
            console.error("Error unlinking SVG across other categories:", e);
        }
    }

    function handleLightboxKeydown(e: KeyboardEvent) {
        if (!lightboxData) return;

        if (showPluginDownloadModal) {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                showPluginDownloadModal = false;
                const modalEl = document.querySelector('.svg-lightbox-modal') as HTMLElement | null;
                modalEl?.focus();
                return;
            }
        }

        if (showSvgDeleteConfirmModal) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void confirmDeleteSvgFromLightbox();
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                showSvgDeleteConfirmModal = false;
                const modalEl = document.querySelector('.svg-lightbox-modal') as HTMLElement | null;
                modalEl?.focus();
                return;
            }
            return;
        }

        if (showSvgSaveConfirmModal) {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void saveAndCloseSvgLightbox();
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelSvgSavePrompt();
                return;
            }
            return;
        }

        // Check if user is actively editing text in the SVG overlay
        const isEditing = !!(
            (window as any).a1SvgQuickEditor?.overlay ||
            (window as any).svgQuickEditor?.overlay ||
            document.querySelector(".a1-svg-text-overlay") ||
            (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA"))
        );
        if (isEditing) {
            // When editing text, the overlay input itself handles Escape / Enter / typing.
            // Do NOT intercept Escape to close the lightbox here!
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            requestCloseSvgLightbox();
            return;
        }

        const quickEditor = (window as any).a1SvgQuickEditor || (window as any).svgQuickEditor;

        // Delete SVG hotkey check: Ctrl+Delete / Mod+Delete or custom configured delete hotkey
        const isDeleteHotkey = ((e.ctrlKey || e.metaKey) && (e.key === "Delete" || e.code === "Delete")) ||
            (quickEditor?.isDeleteSvgHotkey && quickEditor.isDeleteSvgHotkey(e));
        if (isDeleteHotkey) {
            e.preventDefault();
            e.stopPropagation();
            void promptDeleteSvgLightbox();
            return;
        }

        // Save in-place (Ctrl+S / Cmd+S): directly overwrite local file, keeping Ctrl+Z/Y history
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {
            e.preventDefault();
            e.stopPropagation();
            void saveSvgLightboxInPlace();
            return;
        }

        // Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            if (e.key === "z" || e.key === "Z") {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    quickEditor?.redo?.();
                } else {
                    quickEditor?.undo?.();
                }
                return;
            }
            if (e.key === "y" || e.key === "Y") {
                e.preventDefault();
                e.stopPropagation();
                quickEditor?.redo?.();
                return;
            }
        }

        // Delete key: Directly delete hovered UI box
        if ((e.key === "Delete" || e.code === "Delete") && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            const activeTag = document.activeElement?.tagName?.toLowerCase();
            if (activeTag === "input" || activeTag === "textarea") return;
            if (isSvgQuickEditorInstalled()) {
                if (quickEditor?.deleteHoveredBox) {
                    e.preventDefault();
                    e.stopPropagation();
                    quickEditor.deleteHoveredBox();
                    return;
                }
            }
        }

        const isMatch = e.key === "F2" ||
            (quickEditor?.isSvgEditHotkey && quickEditor.isSvgEditHotkey(e)) ||
            (e.ctrlKey && e.altKey && e.shiftKey && (e.key.toLowerCase() === "i" || e.code === "KeyI"));
        if (isMatch) {
            e.preventDefault();
            e.stopPropagation();
            if (isSvgQuickEditorInstalled()) {
                if (quickEditor?.executeEditSvgText) {
                    void quickEditor.executeEditSvgText();
                }
            } else {
                showPluginDownloadModal = true;
            }
        }
    }

    function handleLightboxWheel(e: WheelEvent) {
        if (!lightboxData || (!e.ctrlKey && !e.metaKey)) return;
        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        if (quickEditor?.scaleHoveredBox) {
            e.preventDefault();
            e.stopPropagation();
            const factor = e.deltaY < 0 ? 1.08 : 0.92;
            quickEditor.scaleHoveredBox(factor);
        }
    }

    function handleLightboxDblClick() {
        if (isSvgQuickEditorInstalled()) {
            const quickEditor = (window as any).a1SvgQuickEditor;
            if (quickEditor?.executeEditSvgText) {
                void quickEditor.executeEditSvgText();
            }
        } else {
            showPluginDownloadModal = true;
        }
    }

    function handleLightboxClick(e: MouseEvent) {
        if (showSvgSaveConfirmModal || showPluginDownloadModal) return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        // Do not close if clicking inside the dialog, inside the SVG DOM, or inside the text edit overlay
        if (target.closest('.svg-lightbox-modal, .a1-svg-edit, svg, .svg-confirm-modal')) return;
        requestCloseSvgLightbox();
    }

    function openSvgInVault(cleanPath: string) {
        if (!cleanPath || !plugin?.app) return;
        plugin.app.workspace.openLinkText(cleanPath, currentCategory?.filepath || "", false);
        requestCloseSvgLightbox();
    }

    let popoverPlacement: 'top' | 'bottom' = 'top';

    function dismissPopover(e?: MouseEvent) {
        if (e) e.preventDefault();
        if (popoverTimeout) clearTimeout(popoverTimeout);
        popoverVisible = false;
        popoverTask = null;
        popoverType = null;
    }

    function showPopover(e: MouseEvent | { currentTarget: HTMLElement }, task: TaskItem | null, type: PopoverContentType, svgIndex: number = 0) {
        if (popoverTimeout) clearTimeout(popoverTimeout);
        const target = e.currentTarget as HTMLElement;
        if (!target) return;

        const pos = calculatePopoverPosition(target, type);
        popoverPlacement = pos.placement;
        popoverX = pos.x;
        popoverY = pos.y;

        popoverTask = task;
        popoverType = type;
        popoverSvgIndex = svgIndex;
        popoverVisible = true;
    }

    function openStepsModal(task: TaskItem | null) {
        if (!task) return;
        dismissPopover();
        if (!currentCategory || !plugin?.app) return;
        const catPath = (currentCategory.filepath === STARRED_CATEGORY_PATH && task.sourceFilepath)
            ? task.sourceFilepath
            : currentCategory.filepath;
        new TaskStepsModal(plugin.app, plugin, dataService, task, catPath).open();
    }

    // Dedicated keyboard state tracking to ensure Quick Peek activates ONLY on standalone Ctrl
    let isCtrlPressed = false;
    let hasComboModifierOrKey = false;
    let hoveredTitleTarget: { element: HTMLElement; task: TaskItem } | null = null;

    function isControlKey(e: KeyboardEvent): boolean {
        return Platform.isMacOS ? (e.key === "Meta" || e.key === "Control") : (e.key === "Control");
    }

    function isQuickPeekModifierPressed(e: MouseEvent): boolean {
        // Reject if any combo key (like C in Ctrl+C, Shift, Alt, etc.) is active
        if (hasComboModifierOrKey || e.shiftKey || e.altKey) {
            return false;
        }
        if (Platform.isMacOS) {
            return (e.metaKey || e.ctrlKey);
        }
        // On Windows and Linux: e.metaKey is the Windows (Super) key!
        // Never allow Win key combinations (Win+4, Win+Tab, Win+D, etc.) to falsely trigger Ctrl-hover Quick Peek.
        return e.ctrlKey && !e.metaKey;
    }

    function handleGlobalKeyDown(e: KeyboardEvent) {
        if (ImagePreviewModal.isImagePreviewActive()) {
            return;
        }

        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && hoveredThumbnail) {
            const { task, imageRef } = hoveredThumbnail;
            if (e.key === "c" || e.key === "C") {
                e.preventDefault();
                e.stopPropagation();
                void copyImageToClipboard(imageRef, actualApp, t("image_copied") || "Image copied to clipboard / 图片已复制到剪贴板");
                return;
            }
            if (e.key === "x" || e.key === "X") {
                e.preventDefault();
                e.stopPropagation();
                void cutImageFromMainTaskTitle(task, imageRef);
                return;
            }
        }

        // List navigation history shortcuts (Alt + Left / Alt + Right)
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            if (e.repeat) return;
            if (e.key === "ArrowLeft") {
                const activeType = plugin?.app?.workspace?.getActiveViewOfType(ItemView)?.getViewType();
                const isInsideMain = mainContainerEl && (mainContainerEl.contains(document.activeElement) || activeType === VIEW_TYPE_MAIN);
                if (isInsideMain) {
                    e.preventDefault();
                    e.stopPropagation();
                    void navigateBack();
                    return;
                }
            } else if (e.key === "ArrowRight") {
                const activeType = plugin?.app?.workspace?.getActiveViewOfType(ItemView)?.getViewType();
                const isInsideMain = mainContainerEl && (mainContainerEl.contains(document.activeElement) || activeType === VIEW_TYPE_MAIN);
                if (isInsideMain) {
                    e.preventDefault();
                    e.stopPropagation();
                    void navigateForward();
                    return;
                }
            }
        }

        // Ctrl+F / Cmd+F handler for in-list search
        const isF = e.key === "f" || e.key === "F" || e.code === "KeyF";
        const isMod = Platform.isMacOS ? (e.metaKey || e.ctrlKey) : (e.ctrlKey && !e.metaKey);
        if (isMod && !e.shiftKey && !e.altKey && isF) {
            const activeType = plugin?.app?.workspace?.getActiveViewOfType(ItemView)?.getViewType();
            const isInsideMain = mainContainerEl && (mainContainerEl.contains(document.activeElement) || activeType === VIEW_TYPE_MAIN);
            if (isInsideMain) {
                e.preventDefault();
                e.stopPropagation();
                void openSearch();
                return;
            }
        }

        if (e.key === "F2") {
            if (isEditingCategoryName) return;
            if (isCategoryTitleHovered || document.activeElement?.classList.contains("category-title")) {
                e.preventDefault();
                e.stopPropagation();
                startRenameCategory();
                return;
            }
        }

        if (isControlKey(e)) {
            isCtrlPressed = true;
            // If standalone Ctrl was pressed while cursor is currently hovering over a task title
            if (!hasComboModifierOrKey && !e.shiftKey && !e.altKey && !e.repeat && hoveredTitleTarget) {
                showPopover({ currentTarget: hoveredTitleTarget.element }, hoveredTitleTarget.task, 'title');
            }
        } else {
            // Any other key pressed (e.g. C, V, X, A, Shift, Alt, etc.)
            hasComboModifierOrKey = true;
            // Immediately dismiss Quick Peek popover to prevent shortcut interference
            if (popoverType === 'title') {
                dismissPopover();
            }
        }
    }

    function handleGlobalKeyUp(e: KeyboardEvent) {
        if (isControlKey(e)) {
            isCtrlPressed = false;
            hasComboModifierOrKey = false;
        } else {
            if (!e.ctrlKey && !e.metaKey) {
                hasComboModifierOrKey = false;
            }
        }
    }

    function handleWindowBlur() {
        isCtrlPressed = false;
        hasComboModifierOrKey = false;
        hoveredTitleTarget = null;
        isDndActive = false;
        (window as any).__mstodo_drag_data = null;
        stopAutoScroll();
        if (newTaskTitle.trim() && currentCategory) {
            void addTask();
        }
        if (pendingWeightReSort && !editingWeightTaskId) {
            pendingWeightReSort = false;
            incompleteTasks = applyWeightSort(rawIncompleteTasks, !!plugin?.settings?.enableTaskWeightMode);
            completedTasks = applyWeightSort(rawCompletedTasks, !!plugin?.settings?.enableTaskWeightMode);
        }
    }

    function handleTitleHover(e: MouseEvent, task: TaskItem) {
        hoveredTitleTarget = { element: e.currentTarget as HTMLElement, task };
        if (isQuickPeekModifierPressed(e)) {
            showPopover(e, task, 'title');
        }
    }

    function handleTitleMouseMove(e: MouseEvent, task: TaskItem) {
        hoveredTitleTarget = { element: e.currentTarget as HTMLElement, task };
        if (isQuickPeekModifierPressed(e)) {
            if (!popoverVisible || popoverTask?.id !== task.id || popoverType !== 'title') {
                showPopover(e, task, 'title');
            }
        }
        // Sticky Task Quick Peek: do NOT dismiss when Ctrl is released.
        // The popover remains floating until the user right-clicks anywhere or Ctrl-hovers another task.
    }

    function handleTitleMouseLeave() {
        hoveredTitleTarget = null;
        scheduleHidePopover();
    }

    function scheduleHidePopover() {
        // Sticky Task Quick Peek: do not auto-hide on mouseleave when popoverType is 'title'
        if (popoverType === 'title') return;

        if (popoverTimeout) clearTimeout(popoverTimeout);
        popoverTimeout = setTimeout(() => {
            popoverVisible = false;
            popoverTask = null;
            popoverType = null;
        }, POPOVER_HIDE_DELAY_MS);
    }

    function cancelHidePopover() {
        if (popoverTimeout) clearTimeout(popoverTimeout);
    }

    function handleNoteLinkHover(e: MouseEvent, noteLink?: string) {
        if (!noteLink || !plugin?.app) return;
        const file = LinkedNoteService.resolveLinkedNoteFile(plugin.app, noteLink, currentCategory?.filepath);
        const linktext = file ? file.path.replace(/\.md$/, "") : LinkedNoteService.sanitizeLinkpath(noteLink);
        if (!linktext || linktext.includes(":")) return;

        // Create a proxied MouseEvent where ctrlKey / metaKey always returns true
        // This guarantees Obsidian's Page Preview triggers directly on hover in all view modes (Reading & Live Preview)
        const proxiedEvent = new Proxy(e, {
            get(target, prop) {
                if (prop === "ctrlKey" || prop === "metaKey") return true;
                const val = (target as any)[prop];
                return typeof val === "function" ? val.bind(target) : val;
            }
        });

        plugin.app.workspace.trigger("hover-link", {
            event: proxiedEvent,
            source: "fluent-tasks",
            hoverParent: e.currentTarget as HTMLElement,
            targetEl: e.currentTarget as HTMLElement,
            linktext: linktext,
            sourcePath: currentCategory?.filepath || "",
        });
    }

    async function handleNoteLinkClick(e: MouseEvent | KeyboardEvent, noteLink?: string, taskId?: string) {
        e.stopPropagation();
        if ((!noteLink && !taskId) || !plugin?.app) return;
        let file = LinkedNoteService.resolveLinkedNoteFile(plugin.app, noteLink, currentCategory?.filepath, taskId);
        if (!file && taskId) {
            file = await LinkedNoteService.findFileByTaskIdAsync(plugin.app, taskId, currentCategory?.filepath);
        }
        if (file) {
            await LinkedNoteService.openLinkedNoteFile(plugin.app, file);
        } else if (noteLink) {
            const cleanLink = LinkedNoteService.sanitizeLinkpath(noteLink);
            if (cleanLink && !cleanLink.includes(":")) {
                try {
                    plugin.app.workspace.openLinkText(
                        cleanLink,
                        currentCategory?.filepath || "",
                        "tab"
                    );
                } catch (err) {
                    void Logger.log("[TaskMainView] openLinkText failed:", err);
                }
            } else {
                new Notice(`Cannot find note in vault matching "${noteLink}"`);
            }
        }
    }

    export function applySettingsUpdate(settings?: any) {
        const s = settings || plugin?.settings;
        if (!s) return;
        wrapTaskTitles = s.wrapTaskTitles ?? true;
        mainListTitleSize = s.mainListTitleSize ?? "medium";
        showListTitleInHeader = s.showListTitleInHeader ?? false;
        enableTaskWeightMode = s.enableTaskWeightMode ?? false;
        centerAlignTasks = s.centerAlignTasks ?? true;
        hiddenStarMode = s.hiddenStarMode !== undefined ? s.hiddenStarMode : (s.disableStars ?? false);
        disableStars = hiddenStarMode;
        checkHotkeyStatus();
        void updateFocusedCategories();
        refreshHeaderTitle();
        incompleteTasks = applyWeightSort(rawIncompleteTasks, enableTaskWeightMode);
        completedTasks = applyWeightSort(rawCompletedTasks, enableTaskWeightMode);
        if (enableTaskWeightMode) {
            rawIncompleteTasks = [...incompleteTasks];
            rawCompletedTasks = [...completedTasks];
        }
        incompleteTasks = [...incompleteTasks];
        completedTasks = [...completedTasks];
    }

    function handleSettingsChanged(payload?: any) {
        applySettingsUpdate(payload?.settings);
    }

    interface TaskMetaBadgeItem {
        id: string;
        type: 'why' | 'svg' | 'note' | 'custom';
        index?: number;
        whyVal?: string;
        svgContent?: string;
        noteLink?: string;
        customMeta?: Record<string, any>;
    }

    function getTaskBadges(task: TaskItem): { visibleBadges: TaskMetaBadgeItem[]; overflowBadges: TaskMetaBadgeItem[] } {
        const badges: TaskMetaBadgeItem[] = [];

        // 1. Whys
        const whys = (task.whys && task.whys.length > 0) ? task.whys : (task.why ? [task.why] : []);
        whys.forEach((whyVal, idx) => {
            if (whyVal) {
                badges.push({
                    id: `why-${idx}`,
                    type: 'why',
                    index: idx,
                    whyVal
                });
            }
        });

        // 2. SVGs
        if (task.svgs && task.svgs.length > 0) {
            task.svgs.forEach((svgContent, idx) => {
                if (svgContent) {
                    badges.push({
                        id: `svg-${idx}`,
                        type: 'svg',
                        index: idx,
                        svgContent
                    });
                }
            });
        }

        // 3. Note Badges (Dedicated task_note & external note_links)
        const dedicatedNote = task.task_note || (task.note_link && LinkedNoteService.isHardBoundNote(task.note_link) ? task.note_link : undefined);
        if (dedicatedNote) {
            badges.push({
                id: 'task-note',
                type: 'note',
                noteLink: dedicatedNote
            });
        }

        const externalNotes = (task.note_links && Array.isArray(task.note_links) && task.note_links.length > 0)
            ? task.note_links
            : (task.note_link && !LinkedNoteService.isHardBoundNote(task.note_link) ? [task.note_link] : []);
        externalNotes.forEach((nl, idx) => {
            if (nl) {
                badges.push({
                    id: `note-link-${idx}`,
                    type: 'note',
                    index: idx,
                    noteLink: nl
                });
            }
        });

        // 4. Custom Meta
        if (task.customMeta && Object.keys(task.customMeta).length > 0) {
            badges.push({
                id: 'custom-meta',
                type: 'custom',
                customMeta: task.customMeta
            });
        }

        // Count right-side interactive controls (star & priority weight)
        const controlsCount = (!hiddenStarMode ? 1 : 0) + (enableTaskWeightMode ? 1 : 0);
        const totalIcons = badges.length + controlsCount;

        if (totalIcons > 9) {
            // Capped at 9 visible icons: max badges = 9 - controlsCount (at least 1 badge slot)
            const maxVisibleBadges = Math.max(1, 9 - controlsCount);
            return {
                visibleBadges: badges.slice(0, maxVisibleBadges),
                overflowBadges: badges.slice(maxVisibleBadges)
            };
        } else {
            return {
                visibleBadges: badges,
                overflowBadges: []
            };
        }
    }

    function openBadgesOverflowMenu(e: MouseEvent | KeyboardEvent, task: TaskItem, overflowBadges: TaskMetaBadgeItem[]) {
        e.stopPropagation();
        e.preventDefault();

        const triggerEl = e.currentTarget as HTMLElement;
        const menu = new Menu();

        for (const badge of overflowBadges) {
            if (badge.type === 'why') {
                const whyIdx = badge.index ?? 0;
                const previewText = badge.whyVal ? (badge.whyVal.length > 25 ? badge.whyVal.slice(0, 25) + '...' : badge.whyVal) : '';
                menu.addItem((item) => {
                    item.setTitle(`Why #${whyIdx + 1}: ${previewText || 'View rationale'}`)
                        .setIcon("help-circle")
                        .onClick(() => {
                            if (triggerEl) {
                                showPopover({ currentTarget: triggerEl }, task, 'why', whyIdx);
                            }
                        });
                });
            } else if (badge.type === 'svg') {
                const svgIdx = badge.index ?? 0;
                menu.addItem((item) => {
                    item.setTitle(`Image #${svgIdx + 1}: View visual memory`)
                        .setIcon("image")
                        .onClick((clickEvent) => {
                            if (badge.svgContent) {
                                openSvgLightbox(clickEvent as any, badge.svgContent, task.title);
                            }
                        });
                });
            } else if (badge.type === 'note' && badge.noteLink) {
                const isHard = LinkedNoteService.isHardBoundNote(badge.noteLink);
                const title = isHard 
                    ? `Task Note: ${badge.noteLink}` 
                    : (typeof badge.index === "number" ? `Note #${badge.index + 1}: ${badge.noteLink}` : `Note: ${badge.noteLink}`);
                menu.addItem((item) => {
                    item.setTitle(title)
                        .setIcon(isHard ? "file-text" : "link")
                        .onClick((clickEvent) => {
                            handleNoteLinkClick(clickEvent as any, badge.noteLink, badge.id === 'task-note' ? task.id : undefined);
                        });
                });
            } else if (badge.type === 'custom') {
                const keys = badge.customMeta ? Object.keys(badge.customMeta).join(", ") : "";
                menu.addItem((item) => {
                    item.setTitle(`Custom: ${keys || 'View properties'}`)
                        .setIcon("tag")
                        .onClick(() => {
                            if (triggerEl) {
                                showPopover({ currentTarget: triggerEl }, task, 'custom');
                            }
                        });
                });
            }
        }

        if (e instanceof MouseEvent) {
            menu.showAtMouseEvent(e);
        } else if (triggerEl) {
            const rect = triggerEl.getBoundingClientRect();
            menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
        }
    }

    function handleSvgUpdated(e: any) {
        const { path, content, deleted, source } = e?.detail || {};
        svgResolveCache.clear();
        if (deleted && path) {
            const filename = path.split("/").pop() || "";
            void unlinkSvgFromTasks(path, filename);
            if (lightboxData && (lightboxData.cleanPath === path || lightboxData.cleanPath.endsWith(filename))) {
                closeSvgLightbox();
            }
            return;
        }
        // Do NOT replace lightboxData.content on in-place self-saves, because replacing {@html lightboxData.content}
        // destroys the live <svg> DOM element and its WeakMap undo/redo history!
        if (source === "self-save") {
            return;
        }
        const quickEditor = (window as any).svgQuickEditor || (window as any).a1SvgQuickEditor;
        if (path && quickEditor?.isRecentSelfSave && quickEditor.isRecentSelfSave(path, content)) {
            return;
        }
        if (path) {
            if (content) {
                if (lightboxData && (lightboxData.cleanPath === path || lightboxData.cleanPath.endsWith(path))) {
                    const stamped = stampLightboxSvgMarkup(content, lightboxData.cleanPath || path);
                    lightboxData = {
                        ...lightboxData,
                        content: stamped,
                    };
                    void tick().then(() => {
                        const svgEl = document.querySelector('.svg-lightbox-content svg') as SVGSVGElement | null;
                        if (svgEl) {
                            svgEl.setAttribute('data-a1-svg-path', lightboxData?.cleanPath || path);
                            quickEditor?.registerActiveSvg?.(svgEl);
                        }
                    });
                }
            } else {
                void refreshActiveLightboxFromDisk(path);
            }
        } else {
            void refreshActiveLightboxFromDisk();
        }
    }

    function handleExternalSvgDeleted(e: any) {
        const path = e?.detail?.path;
        if (!path) return;
        const filename = path.split("/").pop() || "";
        void unlinkSvgFromTasks(path, filename);
        if (lightboxData && (lightboxData.cleanPath === path || lightboxData.cleanPath.endsWith(filename))) {
            closeSvgLightbox();
        }
    }

    let vaultModifyRef: any = null;

    function handleWindowFocusOrVisibility() {
        if (document.visibilityState === "visible") {
            svgResolveCache.clear();
            void refreshActiveLightboxFromDisk();
        }
        checkHotkeyStatus();
    }

    // =============================================
    // Lifecycle
    // =============================================
    onMount(() => {
        checkHotkeyStatus();
        void updateFocusedCategories();
        refreshHeaderTitle();
        EventBus.on(EventName.CATEGORY_SELECTED, handleCategorySelected);
        EventBus.on(EventName.CATEGORY_RENAMED, handleCategoryRenamed);
        EventBus.on(EventName.CATEGORY_LIST_CHANGED, updateFocusedCategories);
        EventBus.on(EventName.TASK_UPDATED, handleTaskUpdated);
        EventBus.on(EventName.TASK_MOVED, handleTaskMoved);
        EventBus.on(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.on(EventName.TASK_NAVIGATE, handleTaskNavigate);
        EventBus.on(EventName.SETTINGS_CHANGED, handleSettingsChanged);
        window.addEventListener('pointermove', handleDragPointerMove);
        window.addEventListener('pointerup', handleGlobalPointerUp, true);
        window.addEventListener('pointercancel', handleGlobalPointerUp, true);
        window.addEventListener('wheel', handleWheelDuringDnd, { passive: false, capture: true });
        window.addEventListener('keydown', handleGlobalKeyDown, true);
        window.addEventListener('keyup', handleGlobalKeyUp, true);
        window.addEventListener('blur', handleWindowBlur);
        window.addEventListener('paste', handleGlobalPaste);
        window.addEventListener('a1-svg-updated', handleSvgUpdated);
        window.addEventListener('fluent-tasks-svg-deleted', handleExternalSvgDeleted);

        if (plugin?.app?.vault) {
            vaultModifyRef = plugin.app.vault.on("modify", (file: any) => {
                if (file?.path?.toLowerCase().endsWith(".svg")) {
                    svgResolveCache.clear();
                    void refreshActiveLightboxFromDisk(file.path);
                }
            });
        }
        window.addEventListener('focus', handleWindowFocusOrVisibility);
        document.addEventListener('visibilitychange', handleWindowFocusOrVisibility);
        window.addEventListener('beforeunload', handleBeforeUnload);
        void tick().then(() => {
            refreshHeaderTitle();
        });
    });

    function handleBeforeUnload() {
        if (newTaskTitle.trim() && currentCategory) {
            void addTask();
        }
    }

    onDestroy(() => {
        if (newTaskTitle.trim() && currentCategory) {
            void addTask();
        }
        if (justCreatedTimeout) {
            clearTimeout(justCreatedTimeout);
            justCreatedTimeout = null;
        }
        stopAutoScroll();
        if (popoverTimeout) clearTimeout(popoverTimeout);
        window.removeEventListener('pointermove', handleDragPointerMove);
        window.removeEventListener('pointerup', handleGlobalPointerUp, true);
        window.removeEventListener('pointercancel', handleGlobalPointerUp, true);
        window.removeEventListener('wheel', handleWheelDuringDnd, { capture: true });
        window.removeEventListener('keydown', handleGlobalKeyDown, true);
        window.removeEventListener('keyup', handleGlobalKeyUp, true);
        window.removeEventListener('blur', handleWindowBlur);
        window.removeEventListener('beforeunload', handleBeforeUnload);
        window.removeEventListener('paste', handleGlobalPaste);
        window.removeEventListener('a1-svg-updated', handleSvgUpdated);
        window.removeEventListener('fluent-tasks-svg-deleted', handleExternalSvgDeleted);
        if (vaultModifyRef && plugin?.app?.vault) {
            plugin.app.vault.offref(vaultModifyRef);
            vaultModifyRef = null;
        }
        window.removeEventListener('focus', handleWindowFocusOrVisibility);
        document.removeEventListener('visibilitychange', handleWindowFocusOrVisibility);
        EventBus.off(EventName.CATEGORY_SELECTED, handleCategorySelected);
        EventBus.off(EventName.CATEGORY_RENAMED, handleCategoryRenamed);
        EventBus.off(EventName.CATEGORY_LIST_CHANGED, updateFocusedCategories);
        EventBus.off(EventName.TASK_UPDATED, handleTaskUpdated);
        EventBus.off(EventName.TASK_MOVED, handleTaskMoved);
        EventBus.off(EventName.TASK_DELETED, handleTaskDeleted);
        EventBus.off(EventName.TASK_NAVIGATE, handleTaskNavigate);
        EventBus.off(EventName.SETTINGS_CHANGED, handleSettingsChanged);
    });

    // =============================================
    // Weight Mode (Priority 1-9)
    // =============================================
    function sortTasksByWeight(items: TaskItem[]): TaskItem[] {
        return applyWeightSort(items, enableTaskWeightMode);
    }

    async function handleWeightWheel(e: WheelEvent, task: TaskItem) {
        e.preventDefault();
        e.stopPropagation();
        if (!currentCategory) return;

        // Dismiss text editing if wheel is scrolled
        if (editingWeightTaskId === task.id) {
            editingWeightTaskId = null;
        }

        const delta = e.deltaY < 0 ? 1 : -1;
        const currentWeight = getTaskWeight(task);
        const newWeight = clampTaskWeight(currentWeight + delta);
        if (newWeight === currentWeight) return;

        task.weight = newWeight;
        const rawInc = rawIncompleteTasks.find(t => t.id === task.id);
        if (rawInc) rawInc.weight = newWeight;
        const rawComp = rawCompletedTasks.find(t => t.id === task.id);
        if (rawComp) rawComp.weight = newWeight;

        // Trigger Svelte reactive re-render without reordering the list while hovering
        incompleteTasks = [...incompleteTasks];
        completedTasks = [...completedTasks];
        pendingWeightReSort = true;

        // Persist to disk without triggering local list reload
        await dataService.updateTask(currentCategory.filepath, task);
        EventBus.emit(EventName.TASK_UPDATED, {
            task,
            categoryFilepath: currentCategory.filepath,
            source: 'main-view-weight-wheel',
        });
    }

    function handleWeightMouseLeave() {
        if (editingWeightTaskId) return;
        if (pendingWeightReSort) {
            pendingWeightReSort = false;
            incompleteTasks = applyWeightSort(rawIncompleteTasks, enableTaskWeightMode);
            completedTasks = applyWeightSort(rawCompletedTasks, enableTaskWeightMode);
            if (enableTaskWeightMode) {
                rawIncompleteTasks = [...incompleteTasks];
                rawCompletedTasks = [...completedTasks];
            }
        }
    }

    async function startEditingWeight(task: TaskItem) {
        editingWeightTaskId = task.id;
        editingWeightValue = "";
        await tick();
        const inputEl = document.querySelector(`.task-weight-input[data-task-id="${task.id}"]`) as HTMLInputElement | null;
        if (inputEl) {
            inputEl.focus();
            inputEl.select();
        }
    }

    async function commitWeightEdit(task: TaskItem, explicitWeight?: number) {
        if (editingWeightTaskId !== task.id) return;
        editingWeightTaskId = null;

        let newWeight: number;
        if (explicitWeight !== undefined) {
            newWeight = clampTaskWeight(explicitWeight);
        } else {
            const parsed = parseInt(editingWeightValue.trim(), 10);
            newWeight = isNaN(parsed) ? getTaskWeight(task) : clampTaskWeight(parsed);
        }

        if (task.weight !== newWeight) {
            task.weight = newWeight;
            const rawInc = rawIncompleteTasks.find(t => t.id === task.id);
            if (rawInc) rawInc.weight = newWeight;
            const rawComp = rawCompletedTasks.find(t => t.id === task.id);
            if (rawComp) rawComp.weight = newWeight;

            if (currentCategory) {
                await dataService.updateTask(currentCategory.filepath, task);
                EventBus.emit(EventName.TASK_UPDATED, {
                    task,
                    categoryFilepath: currentCategory.filepath,
                    source: 'main-view-weight-edit',
                });
            }
        }

        pendingWeightReSort = false;
        incompleteTasks = applyWeightSort(rawIncompleteTasks, enableTaskWeightMode);
        completedTasks = applyWeightSort(rawCompletedTasks, enableTaskWeightMode);
        if (enableTaskWeightMode) {
            rawIncompleteTasks = [...incompleteTasks];
            rawCompletedTasks = [...completedTasks];
        }
    }

    function handleWeightInputKeydown(e: KeyboardEvent, task: TaskItem) {
        // Direct single-digit press 1-9 immediately updates and saves
        if (e.key >= "1" && e.key <= "9") {
            e.preventDefault();
            e.stopPropagation();
            void commitWeightEdit(task, parseInt(e.key, 10));
            return;
        }

        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            void commitWeightEdit(task);
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            editingWeightTaskId = null;
            if (pendingWeightReSort) {
                pendingWeightReSort = false;
                incompleteTasks = applyWeightSort(rawIncompleteTasks, enableTaskWeightMode);
                completedTasks = applyWeightSort(rawCompletedTasks, enableTaskWeightMode);
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const cur = getTaskWeight(task);
            void commitWeightEdit(task, clampTaskWeight(cur + 1));
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const cur = getTaskWeight(task);
            void commitWeightEdit(task, clampTaskWeight(cur - 1));
        }
    }

    function handleWeightInput(e: Event, task: TaskItem) {
        const val = (e.target as HTMLInputElement).value;
        const digit = val.replace(/[^1-9]/g, "").slice(-1);
        if (digit) {
            void commitWeightEdit(task, parseInt(digit, 10));
        }
    }

    // =============================================
    // Data Loading
    // =============================================
    async function loadTasks() {
        if (!currentCategory) return;
        const tasks = await dataService.getTasks(currentCategory.filepath);
        
        rawIncompleteTasks = tasks.filter(t => !t.completed);
        rawCompletedTasks = tasks.filter(t => t.completed);
        if (enableTaskWeightMode) {
            rawIncompleteTasks = applyWeightSort(rawIncompleteTasks, true);
            rawCompletedTasks = applyWeightSort(rawCompletedTasks, true);
        }
        incompleteTasks = [...rawIncompleteTasks];
        completedTasks = [...rawCompletedTasks];
    }

    function refreshHeaderTitle() {
        const mainLeaves = plugin?.app?.workspace?.getLeavesOfType(VIEW_TYPE_MAIN) || [];
        for (const leaf of mainLeaves) {
            if ((leaf.view as any)?.updateHeaderTitle) {
                (leaf.view as any).updateHeaderTitle();
            } else {
                (leaf as any).updateHeader?.();
            }
        }
    }

    // Called from main.ts when the view is activated directly
    export async function loadCategory(cat: CategoryInfo) {
        currentCategory = cat;
        refreshHeaderTitle();
        selectedTaskId = "";
        showCompleted = false;
        enableTaskWeightMode = plugin?.settings?.enableTaskWeightMode ?? false;
        hiddenStarMode = plugin?.settings?.hiddenStarMode ?? plugin?.settings?.disableStars ?? false;
        disableStars = hiddenStarMode;
        if (!isNavigatingHistory) {
            pushListHistory(cat);
        }
        await loadTasks();
        refreshHeaderTitle();
        if (plugin?.app && cat?.filepath) {
            void LinkedNoteService.autoSyncCategoryLinkedNotes(plugin.app, dataService, cat.filepath);
        }
    }

    export function getCurrentCategory() {
        return currentCategory;
    }

    // =============================================
    // Category Inline Renaming
    // =============================================
    export function isHoveringOrFocusedCategoryTitle(): boolean {
        return Boolean(isCategoryTitleHovered || document.activeElement?.classList.contains("category-title"));
    }

    export function startRenameCategory() {
        if (!currentCategory || isEditingCategoryName) return;
        editingCategoryName = currentCategory.name;
        isEditingCategoryName = true;
        void tick().then(() => {
            categoryRenameInputEl?.focus();
            categoryRenameInputEl?.select();
        });
    }

    export function cancelRenameCategory() {
        isEditingCategoryName = false;
        editingCategoryName = "";
        isComposingCategoryTitle = false;
    }

    async function commitRenameCategory() {
        if (!isEditingCategoryName || isCommittingCategoryRename || !currentCategory) return;
        const newName = editingCategoryName.trim();
        const oldName = currentCategory.name;
        const oldPath = currentCategory.filepath;
        if (!newName || newName === oldName) {
            cancelRenameCategory();
            return;
        }
        isCommittingCategoryRename = true;
        try {
            const newCat = await dataService.renameCategory(oldPath, newName);
            currentCategory = newCat;
            refreshHeaderTitle();
            EventBus.emit(EventName.CATEGORY_SELECTED, { category: newCat });
        } catch (err: any) {
            console.error("[Fluent Tasks] Failed to rename list:", err);
            new Notice(`Failed to rename list: ${err?.message || err}`);
        } finally {
            isCommittingCategoryRename = false;
            isEditingCategoryName = false;
            editingCategoryName = "";
            isComposingCategoryTitle = false;
        }
    }

    function handleCategoryTitleKeydown(e: KeyboardEvent) {
        if (e.isComposing || isComposingCategoryTitle || e.keyCode === 229) return;
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            void commitRenameCategory();
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelRenameCategory();
        }
    }

    // =============================================
    // In-Memory List Navigation History Stack (Temporary / Session)
    // =============================================
    let listHistory: CategoryInfo[] = [];
    let historyIndex: number = -1;
    let isNavigatingHistory: boolean = false;
    const MAX_LIST_HISTORY = 50;

    function pushListHistory(cat: CategoryInfo) {
        if (!cat || !cat.filepath) return;
        // Skip consecutive duplicates
        if (historyIndex >= 0 && listHistory[historyIndex]?.filepath === cat.filepath) {
            return;
        }
        // Truncate forward history if user navigated back and then chose a new list
        if (historyIndex >= 0 && historyIndex < listHistory.length - 1) {
            listHistory = listHistory.slice(0, historyIndex + 1);
        }
        listHistory.push({
            id: cat.id || cat.filepath,
            name: cat.name,
            filepath: cat.filepath,
            type: cat.type || "category",
            isSmartList: cat.isSmartList,
        });
        if (listHistory.length > MAX_LIST_HISTORY) {
            listHistory.shift();
        }
        historyIndex = listHistory.length - 1;
    }

    let lastNavTime = 0;
    const NAV_DEBOUNCE_MS = 250;

    export async function navigateBack(): Promise<boolean> {
        const now = Date.now();
        if (now - lastNavTime < NAV_DEBOUNCE_MS) {
            return false;
        }
        lastNavTime = now;
        if (historyIndex > 0) {
            let targetIndex = historyIndex - 1;
            // Skip any deleted categories
            while (targetIndex >= 0) {
                const cat = listHistory[targetIndex];
                if (cat.filepath === STARRED_CATEGORY_PATH || (plugin?.app?.vault?.getAbstractFileByPath(cat.filepath))) {
                    break;
                }
                targetIndex--;
            }
            if (targetIndex >= 0) {
                historyIndex = targetIndex;
                const prevCat = listHistory[historyIndex];
                isNavigatingHistory = true;
                try {
                    EventBus.emit(EventName.CATEGORY_SELECTED, { category: prevCat, fromHistory: true });
                } finally {
                    isNavigatingHistory = false;
                }
                return true;
            }
        }
        return false;
    }

    export async function navigateForward(): Promise<boolean> {
        const now = Date.now();
        if (now - lastNavTime < NAV_DEBOUNCE_MS) {
            return false;
        }
        lastNavTime = now;
        if (historyIndex >= 0 && historyIndex < listHistory.length - 1) {
            let targetIndex = historyIndex + 1;
            // Skip any deleted categories
            while (targetIndex < listHistory.length) {
                const cat = listHistory[targetIndex];
                if (cat.filepath === STARRED_CATEGORY_PATH || (plugin?.app?.vault?.getAbstractFileByPath(cat.filepath))) {
                    break;
                }
                targetIndex++;
            }
            if (targetIndex < listHistory.length) {
                historyIndex = targetIndex;
                const nextCat = listHistory[historyIndex];
                isNavigatingHistory = true;
                try {
                    EventBus.emit(EventName.CATEGORY_SELECTED, { category: nextCat, fromHistory: true });
                } finally {
                    isNavigatingHistory = false;
                }
                return true;
            }
        }
        return false;
    }

    // =============================================
    // Event Handlers
    // =============================================
    async function handleCategorySelected(payload: any) {
        if (!payload.category) return;
        currentCategory = payload.category;
        refreshHeaderTitle();
        selectedTaskId = "";
        showCompleted = false;

        // Record history unless this is a history navigation traversal
        if (!payload.fromHistory && !isNavigatingHistory) {
            pushListHistory(payload.category);
        }

        await loadTasks();
        refreshHeaderTitle();
        if (plugin?.app && payload.category.filepath) {
            void LinkedNoteService.autoSyncCategoryLinkedNotes(plugin.app, dataService, payload.category.filepath);
        }

        // Auto-focus the "Add a task" input when triggered by a jump command
        if (payload.focusInput) {
            await tick();
            addTaskInputEl?.focus();
        }
    }

    async function handleCategoryRenamed(payload: any) {
        if (!payload?.category || !payload?.oldFilepath) return;
        const oldPath = payload.oldFilepath;

        // Update listHistory paths and names if a category was renamed
        listHistory = listHistory.map(item => {
            if (item.filepath === oldPath || item.id === oldPath) {
                return {
                    ...item,
                    filepath: payload.category.filepath,
                    name: payload.category.name,
                    id: payload.category.id || payload.category.filepath
                };
            }
            return item;
        });

        if (currentCategory && (currentCategory.filepath === oldPath || currentCategory.id === oldPath)) {
            currentCategory = payload.category;
            refreshHeaderTitle();
            await loadTasks();
            refreshHeaderTitle();
        }
        void updateFocusedCategories();
        if (taskSearchResults.length > 0) {
            taskSearchResults = taskSearchResults.map(res => {
                if (res.category && (res.category.filepath === oldPath || res.category.id === oldPath)) {
                    return { ...res, category: payload.category };
                }
                return res;
            });
        }
    }

    async function handleTaskUpdated(payload: any) {
        if (payload?.source === 'main-view-weight-wheel' || payload?.source === 'main-view-weight-edit') {
            return;
        }
        if (pendingWeightReSort || editingWeightTaskId) {
            return;
        }
        if (!payload.categoryFilepath || payload.categoryFilepath === currentCategory?.filepath) {
            await loadTasks();
            if (payload.isExternal && selectedTaskId && currentCategory) {
                if (!plugin?.isPluginPageActive || plugin.isPluginPageActive()) {
                    const freshTask = incompleteTasks.find(t => t.id === selectedTaskId) || completedTasks.find(t => t.id === selectedTaskId);
                    if (freshTask) {
                        EventBus.emit(EventName.TASK_SELECTED, {
                            task: freshTask,
                            categoryFilepath: currentCategory.filepath,
                            skipModal: true,
                        });
                    }
                }
            }
        }
    }

    async function handleTaskMoved(payload: any) {
        if (payload.targetPath === currentCategory?.filepath) {
            // Task moved TO this category. Add it optimistically.
            const existsInIncomplete = rawIncompleteTasks.find(t => t.id === payload.task.id);
            const existsInComplete = rawCompletedTasks.find(t => t.id === payload.task.id);
            if (!existsInIncomplete && !existsInComplete) {
                if (payload.task.completed) {
                    rawCompletedTasks = [...rawCompletedTasks, payload.task];
                } else {
                    rawIncompleteTasks = [...rawIncompleteTasks, payload.task];
                }
                incompleteTasks = applyWeightSort(rawIncompleteTasks, !!plugin?.settings?.enableTaskWeightMode);
                completedTasks = applyWeightSort(rawCompletedTasks, !!plugin?.settings?.enableTaskWeightMode);
            }
        } else if (payload.sourcePath === currentCategory?.filepath) {
            // Task moved FROM this category. Ensure it's removed optimistically.
            rawIncompleteTasks = rawIncompleteTasks.filter(t => t.id !== payload.task.id);
            rawCompletedTasks = rawCompletedTasks.filter(t => t.id !== payload.task.id);
            incompleteTasks = applyWeightSort(rawIncompleteTasks, !!plugin?.settings?.enableTaskWeightMode);
            completedTasks = applyWeightSort(rawCompletedTasks, !!plugin?.settings?.enableTaskWeightMode);
        }

        // Sync with disk after Obsidian has time to flush its cache
        setTimeout(async () => {
            if (currentCategory) await loadTasks();
        }, DISK_SYNC_DELAY_MS);
    }

    async function handleTaskDeleted(payload: any) {
        if (payload && payload.categoryFilepath === currentCategory?.filepath) {
            const idsToDelete = new Set(
                payload.tasks ? payload.tasks.map((t: any) => t.id) : (payload.task ? [payload.task.id] : [])
            );
            if (idsToDelete.size > 0) {
                rawIncompleteTasks = rawIncompleteTasks.filter(t => !idsToDelete.has(t.id));
                rawCompletedTasks = rawCompletedTasks.filter(t => !idsToDelete.has(t.id));
                incompleteTasks = applyWeightSort(rawIncompleteTasks, !!plugin?.settings?.enableTaskWeightMode);
                completedTasks = applyWeightSort(rawCompletedTasks, !!plugin?.settings?.enableTaskWeightMode);
                if (selectedTaskId && idsToDelete.has(selectedTaskId)) {
                    selectedTaskId = "";
                }
            }
        }
    }

    // =============================================
    // Task Actions
    // =============================================

    async function addTask() {
        const title = newTaskTitle.trim();
        if (!title || !currentCategory) return;

        const newTask = await dataService.addTask(currentCategory.filepath, title);
        newTaskTitle = "";

        // Optimistic UI: insert into local state immediately.
        // We do NOT call loadTasks() here because Obsidian's async I/O might cause a race condition.
        rawIncompleteTasks = [newTask, ...rawIncompleteTasks];
        incompleteTasks = applyWeightSort(rawIncompleteTasks, !!plugin?.settings?.enableTaskWeightMode);

        justCreatedTaskId = newTask.id;
        await tick();

        const el = document.getElementById('task-' + newTask.id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        if (justCreatedTimeout) clearTimeout(justCreatedTimeout);
        justCreatedTimeout = setTimeout(() => {
            if (justCreatedTaskId === newTask.id) {
                justCreatedTaskId = null;
            }
        }, 1000);
    }

    function handleAddTaskBlur() {
        if (newTaskTitle.trim() && currentCategory) {
            void addTask();
        }
    }

    function handleAddTaskKeydown(e: KeyboardEvent) {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void addTask();
        } else if (e.key === "Escape") {
            if (newTaskTitle.trim() && currentCategory) {
                e.preventDefault();
                void addTask();
            }
            addTaskInputEl?.blur();
        }
    }

    async function toggleComplete(task: TaskItem) {
        if (!currentCategory) return;

        task.completed = !task.completed;
        if (task.completed) {
            task.completedAt = new Date().toISOString();
            rawIncompleteTasks = rawIncompleteTasks.filter(t => t.id !== task.id);
            rawCompletedTasks = [task, ...rawCompletedTasks];
        } else {
            delete task.completedAt;
            rawCompletedTasks = rawCompletedTasks.filter(t => t.id !== task.id);
            rawIncompleteTasks = [task, ...rawIncompleteTasks];
        }

        incompleteTasks = applyWeightSort(rawIncompleteTasks, !!plugin?.settings?.enableTaskWeightMode);
        completedTasks = applyWeightSort(rawCompletedTasks, !!plugin?.settings?.enableTaskWeightMode);

        // Persist to disk
        await dataService.updateTask(currentCategory.filepath, task);
        EventBus.emit(EventName.TASK_UPDATED, {
            task,
            categoryFilepath: currentCategory.filepath,
            source: 'main-view',
        });
    }

    async function toggleStar(task: TaskItem, showNotice: boolean = true) {
        if (!currentCategory) return;
        task.starred = !task.starred;

        const rawInc = rawIncompleteTasks.find(t => t.id === task.id);
        if (rawInc) rawInc.starred = task.starred;
        const rawComp = rawCompletedTasks.find(t => t.id === task.id);
        if (rawComp) rawComp.starred = task.starred;

        const targetCatPath = (currentCategory.filepath === STARRED_CATEGORY_PATH && task.sourceFilepath)
            ? task.sourceFilepath
            : currentCategory.filepath;

        // If currently in Starred list and task was unstarred, remove it from view
        if (currentCategory.filepath === STARRED_CATEGORY_PATH && !task.starred) {
            incompleteTasks = incompleteTasks.filter(t => t.id !== task.id);
            completedTasks = completedTasks.filter(t => t.id !== task.id);
            rawIncompleteTasks = rawIncompleteTasks.filter(t => t.id !== task.id);
            rawCompletedTasks = rawCompletedTasks.filter(t => t.id !== task.id);
        } else {
            // Update local arrays to trigger reactivity
            incompleteTasks = [...incompleteTasks];
            completedTasks = [...completedTasks];
        }

        await dataService.updateTask(targetCatPath, task);
        EventBus.emit(EventName.TASK_UPDATED, {
            task,
            categoryFilepath: targetCatPath,
            source: 'main-view',
        });

        if (showNotice) {
            new Notice(task.starred ? `Starred task: "${task.title}"` : `Removed star from: "${task.title}"`);
        }
    }

    export async function toggleStarByTaskId(taskId: string): Promise<void> {
        const task = incompleteTasks.find(t => t.id === taskId) || completedTasks.find(t => t.id === taskId);
        if (task) {
            await toggleStar(task, true);
        }
    }

    function handleTaskMouseEnter(task: TaskItem) {
        currentHoveredTask = task;
        (window as any).__fluent_tasks_hovered_task = {
            task,
            categoryFilepath: currentCategory?.filepath || "",
            toggle: () => toggleStar(task, true)
        };
    }

    function handleTaskMouseLeave(task: TaskItem) {
        if (currentHoveredTask?.id === task.id) {
            currentHoveredTask = null;
        }
        if ((window as any).__fluent_tasks_hovered_task?.task?.id === task.id) {
            (window as any).__fluent_tasks_hovered_task = null;
        }
    }

    function handleThumbnailHover(task: TaskItem, imageRef: string, isHovered: boolean) {
        if (isHovered) {
            hoveredThumbnail = { task, imageRef };
        } else if (hoveredThumbnail?.imageRef === imageRef) {
            hoveredThumbnail = null;
        }
    }

    async function removeImageFromMainTaskTitle(task: TaskItem, imageRef: string) {
        removeImageFromTaskTitle(task, imageRef);
        if (hoveredThumbnail?.imageRef === imageRef) hoveredThumbnail = null;
        const targetCatPath = (currentCategory?.filepath === STARRED_CATEGORY_PATH && task.sourceFilepath)
            ? task.sourceFilepath
            : (currentCategory?.filepath || task.sourceFilepath || "");
        if (isTaskEmpty(task)) {
            incompleteTasks = incompleteTasks.filter(t => t.id !== task.id);
            completedTasks = completedTasks.filter(t => t.id !== task.id);
            rawIncompleteTasks = rawIncompleteTasks.filter(t => t.id !== task.id);
            rawCompletedTasks = rawCompletedTasks.filter(t => t.id !== task.id);
            if (targetCatPath) {
                await dataService.deleteTask(targetCatPath, task);
                EventBus.emit(EventName.TASK_DELETED, { task, categoryFilepath: targetCatPath });
            }
            return;
        }
        incompleteTasks = [...incompleteTasks];
        completedTasks = [...completedTasks];
        if (targetCatPath) {
            await dataService.updateTask(targetCatPath, task);
            EventBus.emit(EventName.TASK_UPDATED, {
                task,
                categoryFilepath: targetCatPath,
                source: 'main-view',
            });
        }
        if (actualApp && dataService) {
            await cleanupOrphanImageAttachment(imageRef, actualApp, dataService, task.id);
        }
    }

    async function cutImageFromMainTaskTitle(task: TaskItem, imageRef: string) {
        await copyImageToClipboard(imageRef, actualApp, t("image_cut") || "Image cut to clipboard / 图片已剪切至剪贴板");
        await removeImageFromMainTaskTitle(task, imageRef);
    }

    function handleGlobalPaste(e: ClipboardEvent) {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || (activeEl as HTMLElement).isContentEditable)) {
            return;
        }
        const activeType = plugin?.app?.workspace?.getActiveViewOfType(ItemView)?.getViewType();
        const isInsideMain = mainContainerEl && (mainContainerEl.contains(activeEl) || activeType === VIEW_TYPE_MAIN);
        if (!isInsideMain) return;

        const files = getImagesFromClipboard(e);
        if (!files || files.length === 0) return;

        const targetTask = currentHoveredTask || (selectedTaskId ? incompleteTasks.concat(completedTasks).find(t => t.id === selectedTaskId) : null);
        if (!targetTask) return;

        e.preventDefault();
        e.stopPropagation();

        void (async () => {
            const targetCatPath = (currentCategory?.filepath === STARRED_CATEGORY_PATH && targetTask.sourceFilepath)
                ? targetTask.sourceFilepath
                : (currentCategory?.filepath || targetTask.sourceFilepath || "");
            for (const file of files) {
                const savedPath = await saveImageAttachment(file, actualApp, targetCatPath);
                if (!savedPath) continue;
                targetTask.titleImages = [...(targetTask.titleImages || []), savedPath];
                incompleteTasks = [...incompleteTasks];
                completedTasks = [...completedTasks];
                if (targetCatPath) {
                    await dataService.updateTask(targetCatPath, targetTask);
                    EventBus.emit(EventName.TASK_UPDATED, {
                        task: targetTask,
                        categoryFilepath: targetCatPath,
                        source: 'main-view',
                    });
                }
            }
        })();
    }

    async function jumpToSourceCategory(filepath?: string) {
        if (!filepath) return;
        const cats = await dataService.getCategories();
        const cat = cats.find(c => c.filepath === filepath);
        if (cat) {
            EventBus.emit(EventName.CATEGORY_SELECTED, { category: cat });
        }
    }

    function selectTask(task: TaskItem, options?: { skipModal?: boolean }) {
        selectedTaskId = task.id;
        const effectiveCategory = (currentCategory?.filepath === STARRED_CATEGORY_PATH && task.sourceFilepath)
            ? task.sourceFilepath
            : (currentCategory?.filepath || "");
        EventBus.emit(EventName.TASK_SELECTED, {
            task,
            categoryFilepath: effectiveCategory,
            skipModal: options?.skipModal,
        });
    }

    function toggleCompletedSection() {
        showCompleted = !showCompleted;
    }

    /** Navigate to a specific task: expand completed section if needed, scroll into view, highlight */
    async function handleTaskNavigate(payload: any) {
        const { taskId, isCompleted } = payload;
        // If the task is completed and the section is collapsed, expand it
        if (isCompleted && !showCompleted) {
            showCompleted = true;
        }
        selectedTaskId = taskId;
        // Wait for Svelte to render the DOM after state changes
        await tick();
        const el = document.getElementById('task-' + taskId);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Brief highlight flash
            el.classList.add('navigate-highlight');
            setTimeout(() => el.classList.remove('navigate-highlight'), 1500);
        }
    }

    // =============================================
    // In-List Task Search Engine (Ctrl+F)
    // =============================================
    function runTaskSearch(query: string) {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        const q = query.trim();
        if (!q || !currentCategory) {
            taskSearchResults = [];
            taskFocusedIndex = 0;
            isSearchingTasks = false;
            return;
        }
        searchDebounceTimer = setTimeout(async () => {
            isSearchingTasks = true;
            try {
                let results = await dataService.searchTasks(q, currentCategory ? currentCategory.filepath : null);
                taskSearchResults = results;
                taskFocusedIndex = 0;
            } catch (err) {
                console.error("[TaskMainView] Task search failed:", err);
                taskSearchResults = [];
            } finally {
                isSearchingTasks = false;
            }
        }, 50);
    }

    function handleListOnlyClick(e?: MouseEvent) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        new Notice(
            t("main_view_search_all_tasks_hint") ||
            "如果想要搜索全部任务 (All tasks)，请在 Obsidian【设置 -> 快捷键】中为本插件命令【Search all tasks】绑定快捷键。"
        );
        searchInputEl?.focus();
    }

    async function openSearch() {
        isSearchOpen = true;
        await tick();
        searchInputEl?.focus();
        searchInputEl?.select();
        if (searchQuery.trim().length > 0) {
            runTaskSearch(searchQuery);
        }
    }

    function closeSearch() {
        isSearchOpen = false;
        searchQuery = "";
        taskSearchResults = [];
        taskFocusedIndex = 0;
        isSearchingTasks = false;
    }

    function toggleSearch() {
        if (isSearchOpen) {
            closeSearch();
        } else {
            void openSearch();
        }
    }

    async function scrollTaskFocusedIntoView() {
        await tick();
        if (!taskResultsContainerEl) return;
        const focusedEl = taskResultsContainerEl.querySelector(".quick-modal-task-item.is-focused") as HTMLElement | null;
        if (focusedEl) {
            focusedEl.scrollIntoView({ block: "nearest" });
        }
    }

    async function selectSearchResult(item: { task: TaskItem; category: CategoryInfo; matchField: string }) {
        if (!item || !item.task) return;

        // 1. Close search overlay first so the task list view is fully visible and layout is settled
        closeSearch();

        // 2. Switch category if needed
        if (item.category && currentCategory && item.category.filepath !== currentCategory.filepath && currentCategory.filepath !== STARRED_CATEGORY_PATH) {
            await handleCategorySelected({ category: item.category });
        }

        // 3. Expand completed section if completed
        if (item.task.completed && !showCompleted) {
            showCompleted = true;
        }

        // 4. Select the task without opening floating detail modal (jump to position only)
        selectTask(item.task, { skipModal: true });

        // 5. Scroll into view and highlight
        await tick();
        let el = document.getElementById('task-' + item.task.id);
        if (!el) {
            await tick();
            el = document.getElementById('task-' + item.task.id);
        }
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('navigate-highlight');
            setTimeout(() => el.classList?.remove('navigate-highlight'), 1500);
        }
    }

    function handleSearchKeydown(e: KeyboardEvent) {
        if (e.isComposing || isSearchComposing || e.keyCode === 229) return;

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
                void selectSearchResult(taskSearchResults[taskFocusedIndex]);
            }
            return;
        }

        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeSearch();
            return;
        }
    }

    // =============================================
    // Custom Auto-Scroll Engine for DnD
    // =============================================
    function startAutoScroll() {
        if (scrollAnimId !== null) return;
        const step = () => {
            if (!scrollContainerEl || scrollSpeed === 0) {
                scrollAnimId = null;
                return;
            }
            scrollContainerEl.scrollTop += scrollSpeed;
            scrollAnimId = requestAnimationFrame(step);
        };
        scrollAnimId = requestAnimationFrame(step);
    }

    function stopAutoScroll() {
        if (scrollAnimId !== null) {
            cancelAnimationFrame(scrollAnimId);
            scrollAnimId = null;
        }
        scrollSpeed = 0;
    }

    function updateAutoScroll(clientY: number) {
        if (!scrollContainerEl) {
            scrollContainerEl = document.querySelector('.task-list') as HTMLElement;
        }
        if (!scrollContainerEl) return;

        const rect = scrollContainerEl.getBoundingClientRect();

        if (clientY < rect.top + AUTO_SCROLL_EDGE_ZONE && scrollContainerEl.scrollTop > 0) {
            // Linear speed: closer to edge = faster, clamped to max
            const proximity = 1 - ((clientY - rect.top) / AUTO_SCROLL_EDGE_ZONE);
            scrollSpeed = -Math.max(AUTO_SCROLL_MIN_SPEED, Math.round(proximity * AUTO_SCROLL_MAX_SPEED));
            startAutoScroll();
        } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_ZONE) {
            const proximity = 1 - ((rect.bottom - clientY) / AUTO_SCROLL_EDGE_ZONE);
            scrollSpeed = Math.max(AUTO_SCROLL_MIN_SPEED, Math.round(proximity * AUTO_SCROLL_MAX_SPEED));
            startAutoScroll();
        } else {
            stopAutoScroll();
        }
    }

    function handleGlobalPointerUp(e?: PointerEvent) {
        const wasDndActive = isDndActive;
        isDndActive = false;
        stopAutoScroll();

        const dragData = (window as any).__mstodo_drag_data;
        let targetFocusedPath = dragOverFocusedPath;
        dragOverFocusedPath = "";

        if (!targetFocusedPath && e && mainContainerEl && dragData && wasDndActive) {
            const pills = mainContainerEl.querySelectorAll('.focused-list-pill[data-filepath]');
            for (let i = 0; i < pills.length; i++) {
                const pill = pills[i] as HTMLElement;
                const rect = pill.getBoundingClientRect();
                if (
                    e.clientX >= rect.left &&
                    e.clientX <= rect.right &&
                    e.clientY >= rect.top &&
                    e.clientY <= rect.bottom
                ) {
                    const path = pill.getAttribute('data-filepath') || "";
                    if (path && path !== dragData.sourceFilepath && path !== currentCategory?.filepath) {
                        targetFocusedPath = path;
                    }
                    break;
                }
            }
        }

        if (dragData && targetFocusedPath && targetFocusedPath !== dragData.sourceFilepath && targetFocusedPath !== currentCategory?.filepath) {
            const targetCat = focusedCategories.find(c => c.filepath === targetFocusedPath);
            if (targetCat && dragData.task) {
                lastFocusedDropTime = Date.now();
                if (targetCat.filepath !== STARRED_CATEGORY_PATH) {
                    dragData.movedToTarget = targetCat.filepath;
                    const domNode = document.getElementById('task-' + dragData.taskId);
                    if (domNode) domNode.style.display = 'none';
                }
                killDndGhostElement();
                void moveTaskToCategory(dragData.task, targetCat);
                return;
            }
        }

        if (dragData) {
            setTimeout(() => {
                if ((window as any).__mstodo_drag_data === dragData) {
                    (window as any).__mstodo_drag_data = null;
                }
            }, 50);
        }
    }

    function handleDragPointerMove(e: PointerEvent) {
        if (e.buttons !== 1) {
            if (dragOverFocusedPath) dragOverFocusedPath = "";
            return;
        }
        const dragData = (window as any).__mstodo_drag_data;
        if (!isDndActive && !dragData) {
            if (dragOverFocusedPath) dragOverFocusedPath = "";
            return;
        }
        if (isDndActive) {
            updateAutoScroll(e.clientY);
        }
        if (mainContainerEl && dragData) {
            const pills = mainContainerEl.querySelectorAll('.focused-list-pill[data-filepath]');
            let foundPath = "";
            for (let i = 0; i < pills.length; i++) {
                const pill = pills[i] as HTMLElement;
                const rect = pill.getBoundingClientRect();
                if (
                    e.clientX >= rect.left &&
                    e.clientX <= rect.right &&
                    e.clientY >= rect.top &&
                    e.clientY <= rect.bottom
                ) {
                    const path = pill.getAttribute('data-filepath') || "";
                    if (path && path !== dragData.sourceFilepath && path !== currentCategory?.filepath) {
                        foundPath = path;
                    }
                    break;
                }
            }
            if (dragOverFocusedPath !== foundPath) {
                dragOverFocusedPath = foundPath;
            }
        } else if (dragOverFocusedPath) {
            dragOverFocusedPath = "";
        }
    }

    function handleWheelDuringDnd(e: WheelEvent) {
        // If left mouse button is not actively pressed, no drag is possible
        if (e.buttons !== 1) {
            isDndActive = false;
            if ((window as any).__mstodo_drag_data) {
                (window as any).__mstodo_drag_data = null;
            }
            return;
        }

        // Never intercept or hijack wheel scrolling over weight controls
        if ((e.target as HTMLElement)?.closest('.task-weight-control')) {
            return;
        }

        if (!isDndActive) return;
        if (!scrollContainerEl) {
            scrollContainerEl = document.querySelector('.task-list') as HTMLElement;
        }
        if (!scrollContainerEl) return;

        let isOverMain = false;
        if (mainContainerEl) {
            const rect = mainContainerEl.getBoundingClientRect();
            if (
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom
            ) {
                isOverMain = true;
            }
        }
        if (!isOverMain && scrollContainerEl) {
            const rect = scrollContainerEl.getBoundingClientRect();
            if (
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom
            ) {
                isOverMain = true;
            }
        }

        if (isOverMain) {
            e.preventDefault();
            e.stopPropagation();
            stopAutoScroll();
            const delta = e.deltaMode === 1 ? e.deltaY * 24 : (e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY);
            scrollContainerEl.scrollTop += delta;
        }
    }

    // =============================================
    // Drag & Drop (In-list reordering & Cross-Pane)
    // =============================================
    function handleDndConsider(e: CustomEvent, listType: 'incomplete' | 'completed') {
        if (!isDndActive) {
            isDndActive = true;
            const draggedId = e.detail?.info?.id;
            const items = listType === 'incomplete' ? (e.detail?.items || incompleteTasks) : (e.detail?.items || completedTasks);
            const draggedTask = items.find((t: TaskItem) => t.id === draggedId);
            const relevantCatPath = (currentCategory?.filepath === STARRED_CATEGORY_PATH && draggedTask?.sourceFilepath)
                ? draggedTask.sourceFilepath
                : currentCategory?.filepath;
            void plugin?.handleTaskDragStart?.(relevantCatPath);
            if (preDragIncompleteTasks.length === 0) preDragIncompleteTasks = [...incompleteTasks];
            if (preDragCompletedTasks.length === 0) preDragCompletedTasks = [...completedTasks];
        }
        if (listType === 'incomplete') incompleteTasks = e.detail.items;
        else completedTasks = e.detail.items;

        // Broadcast drag data for cross-pane drops (sidebar radar)
        const draggedId = e.detail.info.id;
        const task = (listType === 'incomplete' ? incompleteTasks : completedTasks).find(t => t.id === draggedId);
        if (task && currentCategory) {
            (window as any).__mstodo_drag_data = {
                taskId: task.id,
                task,
                sourceFilepath: (currentCategory.filepath === STARRED_CATEGORY_PATH && task?.sourceFilepath) ? task.sourceFilepath : currentCategory.filepath,
                movedToTarget: null,
            };
        }
    }

    async function handleDndFinalize(e: CustomEvent, listType: 'incomplete' | 'completed') {
        plugin?.handleTaskDragEnd?.();
        isDndActive = false;
        stopAutoScroll();

        const dragData = (window as any).__mstodo_drag_data;
        const draggedId = e.detail.info.id;

        // If the task was moved cross-pane to another category by sidebar radar
        if (dragData && dragData.movedToTarget && dragData.movedToTarget !== currentCategory?.filepath) {
            // Task was successfully moved cross-pane!
            // CRITICAL: Filter out from local state and DO NOT call saveTasks() on currentCategory
            // because moveTask has already removed it from disk.
            if (listType === 'incomplete') {
                rawIncompleteTasks = rawIncompleteTasks.filter(t => t.id !== draggedId && t.id !== dragData.task?.id);
                incompleteTasks = incompleteTasks.filter(t => t.id !== draggedId && t.id !== dragData.task?.id);
            } else {
                rawCompletedTasks = rawCompletedTasks.filter(t => t.id !== draggedId && t.id !== dragData.task?.id);
                completedTasks = completedTasks.filter(t => t.id !== draggedId && t.id !== dragData.task?.id);
            }

            const domNode = document.getElementById('task-' + draggedId);
            if (domNode) domNode.style.display = 'none';
            killDndGhostElement();
            (window as any).__mstodo_drag_data = null;
            preDragIncompleteTasks = [];
            preDragCompletedTasks = [];
            return;
        }

        (window as any).__mstodo_drag_data = null;

        if (e.detail.info.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) {
            // Dropped in empty space (cancelled drag)
            if (listType === 'incomplete') {
                incompleteTasks = preDragIncompleteTasks.length > 0 ? [...preDragIncompleteTasks] : e.detail.items;
            } else {
                completedTasks = preDragCompletedTasks.length > 0 ? [...preDragCompletedTasks] : e.detail.items;
            }
            preDragIncompleteTasks = [];
            preDragCompletedTasks = [];
            return;
        }

        // Normal drop (internal reordering within same list)
        const updatedItems = e.detail.items as TaskItem[];
        const isCompletedList = listType === 'completed';
        updatedItems.forEach(t => { t.completed = isCompletedList; });

        // When task weight mode is enabled, enforce monotonic non-increasing weight order:
        // A task with a smaller weight cannot be placed above a task with a larger weight.
        if (enableTaskWeightMode) {
            let hasViolation = false;
            for (let i = 0; i < updatedItems.length - 1; i++) {
                if (getTaskWeight(updatedItems[i]) < getTaskWeight(updatedItems[i + 1])) {
                    hasViolation = true;
                    break;
                }
            }

            if (hasViolation) {
                // Cancel move and revert to pre-drag order
                if (listType === 'incomplete') {
                    incompleteTasks = [...preDragIncompleteTasks];
                    rawIncompleteTasks = [...preDragIncompleteTasks];
                } else {
                    completedTasks = [...preDragCompletedTasks];
                    rawCompletedTasks = [...preDragCompletedTasks];
                }
                preDragIncompleteTasks = [];
                preDragCompletedTasks = [];
                killDndGhostElement();

                const NoticeCtor = (window as any).Notice || Notice;
                new NoticeCtor(isChinese()
                    ? "⚠️ 权重模式限制：数字较小的任务不能排在较大任务上方！"
                    : "⚠️ Weight mode: Smaller weight task cannot be placed above a larger weight task!", 4000);
                return;
            }
        }

        preDragIncompleteTasks = [];
        preDragCompletedTasks = [];

        if (listType === 'incomplete') {
            incompleteTasks = updatedItems;
            rawIncompleteTasks = updatedItems;
        } else {
            completedTasks = updatedItems;
            rawCompletedTasks = updatedItems;
        }

        if (!currentCategory) return;
        // Persist the new order
        const allTasks = [...rawIncompleteTasks, ...rawCompletedTasks];
        await dataService.saveTasks(currentCategory.filepath, allTasks);
    }

    function handleTaskPointerDown(task: TaskItem) {
        if (!isDndActive) {
            preDragIncompleteTasks = [...incompleteTasks];
            preDragCompletedTasks = [...completedTasks];
        }
        if (currentCategory) {
            (window as any).__mstodo_drag_data = {
                taskId: task.id,
                task,
                sourceFilepath: (currentCategory.filepath === STARRED_CATEGORY_PATH && task?.sourceFilepath) ? task.sourceFilepath : currentCategory.filepath,
                movedToTarget: null,
            };
        }
    }

    async function moveTaskToCategory(task: TaskItem, targetCat: CategoryInfo) {
        if (!currentCategory) return;
        const currentCatPath = currentCategory.filepath;
        const actualSource = (currentCatPath === STARRED_CATEGORY_PATH && task.sourceFilepath)
            ? task.sourceFilepath
            : currentCatPath;

        if (targetCat.filepath === actualSource) return;

        if (targetCat.filepath === STARRED_CATEGORY_PATH) {
            if (currentCatPath === STARRED_CATEGORY_PATH) return;
            injectDndGhostShield();
            if (!task.starred) {
                task.starred = true;
                incompleteTasks = [...incompleteTasks];
                completedTasks = [...completedTasks];
                await dataService.updateTask(actualSource, task);
                EventBus.emit(EventName.TASK_UPDATED, { task, categoryFilepath: actualSource });
                new Notice(isChinese() ? `已星标任务: "${task.title}"` : `Starred task: "${task.title}"`);
            }
            setTimeout(() => removeDndGhostShield(), ANTI_FLICKER_DURATION_MS);
            return;
        }

        // Anti-flicker: kill all transitions for the duration of the move
        injectDndGhostShield();

        // Optimistic UI: remove from local list
        incompleteTasks = incompleteTasks.filter(t => t.id !== task.id);
        completedTasks = completedTasks.filter(t => t.id !== task.id);
        rawIncompleteTasks = rawIncompleteTasks.filter(t => t.id !== task.id);
        rawCompletedTasks = rawCompletedTasks.filter(t => t.id !== task.id);

        await dataService.moveTask(task, actualSource, targetCat.filepath);
        EventBus.emit(EventName.TASK_MOVED, {
            task,
            sourcePath: actualSource,
            targetPath: targetCat.filepath,
        });

        new Notice(isChinese() ? `已将任务移动至 "${targetCat.name}"` : `Moved task to "${targetCat.name}"`);
        setTimeout(() => removeDndGhostShield(), ANTI_FLICKER_DURATION_MS);
    }

    // =============================================
    // Context Menu (Right-click → Move to...)
    // =============================================
    async function handleContextMenu(e: MouseEvent, task: TaskItem) {
        e.preventDefault();
        if (!currentCategory) return;

        const menu = new Menu();

        // 1st item: Add side step (opens floating subtasks modal)
        menu.addItem((item: any) => {
            item.setTitle(t("add_side_step") || "Add side step")
                .setIcon("list-plus")
                .onClick(() => {
                    openStepsModal(task);
                });
        });

        // 2nd item: Star / Remove star
        menu.addItem((item: any) => {
            item.setTitle(task.starred ? "Remove star" : "Star task")
                .setIcon("star")
                .onClick(async () => {
                    await toggleStar(task, true);
                });
        });

        menu.addSeparator();

        const sidebarItems = await dataService.getSidebarItems();
        const allCategories = await dataService.getCategories();
        const currentCatPath = currentCategory.filepath;
        const actualSource = (currentCatPath === STARRED_CATEGORY_PATH && task.sourceFilepath)
            ? task.sourceFilepath
            : currentCatPath;

        const eligibleCategories = allCategories.filter(
            c => c.filepath !== actualSource && c.filepath !== STARRED_CATEGORY_PATH
        );

        if (eligibleCategories.length > 0) {
            menu.addItem((item: any) => {
                item.setTitle(t("move_to_menu_title") || "Move to")
                    .setIcon("folder-input");

                if (typeof item.setSubmenu === "function") {
                    const subMenu = item.setSubmenu() as Menu;

                    // Quick search modal option
                    subMenu.addItem((searchItem: any) => {
                        searchItem.setTitle(t("search_list_to_move") || "Search destination list...")
                            .setIcon("search")
                            .onClick(() => {
                                if (plugin?.app) {
                                    new MoveToSuggestModal(plugin.app, eligibleCategories, (targetCat) => {
                                        void moveTaskToCategory(task, targetCat);
                                    }).open();
                                }
                            });
                    });

                    subMenu.addSeparator();

                    const hasGroups = sidebarItems.some(i => i.type === "group");

                    if (hasGroups) {
                        for (const sItem of sidebarItems) {
                            if (sItem.type === "group") {
                                const groupCats = (sItem.items || []).filter(
                                    c => c.filepath !== actualSource && c.filepath !== STARRED_CATEGORY_PATH
                                );
                                if (groupCats.length > 0) {
                                    subMenu.addItem((groupMenuItem: any) => {
                                        groupMenuItem.setTitle(sItem.name)
                                            .setIcon("folder");

                                        if (typeof groupMenuItem.setSubmenu === "function") {
                                            const groupSubMenu = groupMenuItem.setSubmenu() as Menu;
                                            for (const cat of groupCats) {
                                                groupSubMenu.addItem((catItem: any) => {
                                                    catItem.setTitle(cat.name)
                                                        .setIcon("file-text")
                                                        .onClick(() => {
                                                            void moveTaskToCategory(task, cat);
                                                        });
                                                });
                                            }
                                        } else {
                                            groupMenuItem.onClick(() => {
                                                if (plugin?.app) {
                                                    new MoveToSuggestModal(plugin.app, groupCats, (targetCat) => {
                                                        void moveTaskToCategory(task, targetCat);
                                                    }).open();
                                                }
                                            });
                                        }
                                    });
                                }
                            } else if (sItem.type === "category") {
                                if (sItem.filepath !== actualSource && sItem.filepath !== STARRED_CATEGORY_PATH) {
                                    subMenu.addItem((catItem: any) => {
                                        catItem.setTitle(sItem.name)
                                            .setIcon("file-text")
                                            .onClick(() => {
                                                void moveTaskToCategory(task, sItem as CategoryInfo);
                                            });
                                    });
                                }
                            }
                        }
                    } else {
                        for (const cat of eligibleCategories) {
                            subMenu.addItem((catItem: any) => {
                                catItem.setTitle(cat.name)
                                    .setIcon("file-text")
                                    .onClick(() => {
                                        void moveTaskToCategory(task, cat);
                                    });
                            });
                        }
                    }
                } else {
                    item.onClick(() => {
                        if (plugin?.app) {
                            new MoveToSuggestModal(plugin.app, eligibleCategories, (targetCat) => {
                                void moveTaskToCategory(task, targetCat);
                            }).open();
                        }
                    });
                }
            });
        }

        menu.addSeparator();
        menu.addItem((item: any) => {
            item.setTitle("Delete task")
                .setIcon("trash")
                .onClick(async () => {
                    const catPath = (currentCategory!.filepath === STARRED_CATEGORY_PATH && task.sourceFilepath)
                        ? task.sourceFilepath
                        : currentCategory!.filepath;
                    await promptDeleteTaskWithLinkedNote(
                        plugin.app,
                        task,
                        catPath,
                        dataService,
                        () => {
                            incompleteTasks = incompleteTasks.filter(t => t.id !== task.id);
                            completedTasks = completedTasks.filter(t => t.id !== task.id);
                        }
                    );
                });
        });

        menu.showAtMouseEvent(e);
    }

    export function openHintsModal() {
        showHintsModal = true;
    }

    export function showGuidePopover(e: MouseEvent) {
        showPopover(e, null, 'guide');
    }

    export function toggleMultiSelect() {
        isMultiSelectMode = !isMultiSelectMode;
        if (!isMultiSelectMode) {
            selectedTaskIds.clear();
            selectedTaskIds = selectedTaskIds;
        } else {
            new Notice(t("multi_select_mode_enabled"));
        }
    }

    export function openBackupModal() {
        new BackupModal(plugin.app, plugin, dataService).open();
    }

    function toggleTaskSelection(id: string) {
        if (selectedTaskIds.has(id)) {
            selectedTaskIds.delete(id);
        } else {
            selectedTaskIds.add(id);
        }
        selectedTaskIds = selectedTaskIds;
    }

    function selectAllTasks() {
        const all = [...incompleteTasks, ...completedTasks];
        if (selectedTaskIds.size === all.length && all.length > 0) {
            selectedTaskIds.clear();
        } else {
            for (const t of all) {
                selectedTaskIds.add(t.id);
            }
        }
        selectedTaskIds = selectedTaskIds;
    }

    function selectIncompleteTasks() {
        const incompleteIds = incompleteTasks.map(t => t.id);
        if (incompleteIds.length === 0) return;
        const allIncompleteSelected = incompleteIds.every(id => selectedTaskIds.has(id)) && selectedTaskIds.size === incompleteIds.length;
        if (allIncompleteSelected) {
            selectedTaskIds.clear();
        } else {
            selectedTaskIds.clear();
            for (const id of incompleteIds) {
                selectedTaskIds.add(id);
            }
        }
        selectedTaskIds = selectedTaskIds;
    }

    function selectCompletedTasks() {
        const completedIds = completedTasks.map(t => t.id);
        if (completedIds.length === 0) return;
        const allCompletedSelected = completedIds.every(id => selectedTaskIds.has(id)) && selectedTaskIds.size === completedIds.length;
        if (allCompletedSelected) {
            selectedTaskIds.clear();
        } else {
            selectedTaskIds.clear();
            for (const id of completedIds) {
                selectedTaskIds.add(id);
            }
        }
        selectedTaskIds = selectedTaskIds;
    }

    async function handleBatchStar() {
        if (!currentCategory || selectedTaskIds.size === 0) return;
        const all = [...incompleteTasks, ...completedTasks];
        const selected = all.filter(t => selectedTaskIds.has(t.id));
        if (selected.length === 0) return;
        const shouldStar = !selected.every(t => t.starred);
        for (const t of selected) {
            t.starred = shouldStar;
        }
        incompleteTasks = [...incompleteTasks];
        completedTasks = [...completedTasks];
        await dataService.saveTasks(currentCategory.filepath, [...incompleteTasks, ...completedTasks]);
        new Notice(shouldStar ? t("batch_starred_tasks", selected.length) : t("batch_unstarred_tasks", selected.length));
    }

    async function handleBatchDelete() {
        if (!currentCategory || selectedTaskIds.size === 0) return;
        const all = [...incompleteTasks, ...completedTasks];
        const toDelete = all.filter(t => selectedTaskIds.has(t.id));
        if (toDelete.length === 0) return;

        const imagesToInspect: string[] = [];
        for (const t of toDelete) {
            for (const img of getAllImagesInTask(t)) {
                if (!imagesToInspect.some(existing => isSameImageRef(existing, img))) {
                    imagesToInspect.push(img);
                }
            }
        }

        incompleteTasks = incompleteTasks.filter(t => !selectedTaskIds.has(t.id));
        completedTasks = completedTasks.filter(t => !selectedTaskIds.has(t.id));
        await dataService.saveTasks(currentCategory.filepath, [...incompleteTasks, ...completedTasks]);

        let trashedImages: TrashedImageBackup[] = [];
        if (imagesToInspect.length > 0 && plugin?.app) {
            trashedImages = await cleanupOrphanImages(imagesToInspect, plugin.app, dataService);
        }
        
        selectedTaskIds.clear();
        selectedTaskIds = selectedTaskIds;
        isMultiSelectMode = false;

        // Push a single consolidated undo toast for the batch deletion
        EventBus.emit(EventName.TASK_DELETED, {
            categoryFilepath: currentCategory.filepath,
            tasks: toDelete,
            trashedImages,
            isBatch: true,
        });
    }

    async function toggleCenterAlignTasks() {
        centerAlignTasks = !centerAlignTasks;
        if (plugin?.settings) {
            plugin.settings.centerAlignTasks = centerAlignTasks;
            await plugin.saveSettings();
        }
    }

    function openHeaderMoreMenu(e: MouseEvent | KeyboardEvent) {
        e.preventDefault();
        e.stopPropagation();
        const menu = new Menu();

        // 0. Rename list (F2)
        menu.addItem((item) => {
            item.setTitle(t("rename_list_menu_item") || "Rename list (F2)")
                .setIcon("edit-3")
                .onClick(() => {
                    startRenameCategory();
                });
        });

        menu.addSeparator();

        // 1. Center-align tasks toggle
        menu.addItem((item) => {
            item.setTitle(centerAlignTasks ? "Align tasks: Left" : "Align tasks: Center")
                .setIcon(centerAlignTasks ? "align-left" : "align-center")
                .setChecked(centerAlignTasks)
                .onClick(() => {
                    void toggleCenterAlignTasks();
                });
        });

        menu.addSeparator();

        // 2. Search in list
        menu.addItem((item) => {
            item.setTitle("Search in list (Ctrl+F)")
                .setIcon("search")
                .onClick(() => {
                    void openSearch();
                });
        });

        // 3. Multi-select mode
        menu.addItem((item) => {
            item.setTitle("Multi-select mode")
                .setIcon("check-square")
                .onClick(() => {
                    toggleMultiSelect();
                });
        });

        // 4. Backup manager
        menu.addItem((item) => {
            item.setTitle("Backup manager")
                .setIcon("archive")
                .onClick(() => {
                    openBackupModal();
                });
        });

        // 5. Features & shortcuts guide
        menu.addItem((item) => {
            item.setTitle("Features & shortcuts guide")
                .setIcon("help-circle")
                .onClick(() => {
                    showHintsModal = true;
                });
        });

        if (e instanceof MouseEvent) {
            menu.showAtMouseEvent(e);
        } else {
            const target = e.currentTarget as HTMLElement;
            const rect = target.getBoundingClientRect();
            menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
        }
    }

    function handleMainPointerDown(e: MouseEvent) {
        if (e.button === 3 || e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            if (e.button === 0 || e.button === 2) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }
        return;
    }

    /*
        if (e.button === 3) {
            e.preventDefault();
            e.stopPropagation();
            void navigateBack();
            return;
        }
        if (e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
            void navigateForward();
            return;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            if (e.button === 0) { // Alt + Left Click -> Back
                e.preventDefault();
                e.stopPropagation();
                void navigateBack();
                return;
            } else if (e.button === 2) { // Alt + Right Click -> Forward
                e.preventDefault();
                e.stopPropagation();
                void navigateForward();
                return;
            }
        }
    }

    }

    */

    function handleMainPointerUp(e: MouseEvent) {
        if (e.button === 3) {
            e.preventDefault();
            e.stopPropagation();
            void navigateBack();
            return;
        }
        if (e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
            void navigateForward();
            return;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            if (e.button === 0) {
                e.preventDefault();
                e.stopPropagation();
                void navigateBack();
                return;
            } else if (e.button === 2) {
                e.preventDefault();
                e.stopPropagation();
                void navigateForward();
                return;
            }
        }
    }

    function handleMainContextMenu(e: MouseEvent) {
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function handleMainAuxClick(e: MouseEvent) {
        if (e.button === 3 || e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }

    /*
        if (e.button === 3) {
            e.preventDefault();
            e.stopPropagation();
            void navigateBack();
        } else if (e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
            void navigateForward();
        }
    }

    }

    */

    export {
        scheduleHidePopover,
        openSearch,
        closeSearch,
        toggleSearch,
        startRenameCategory,
        cancelRenameCategory,
        isHoveringOrFocusedCategoryTitle,
        toggleStarByTaskId,
        applySettingsUpdate,
    };
</script>

<svelte:window 
    on:contextmenu={() => { if (popoverVisible) dismissPopover(); }} 
    on:wheel|capture={handleLightboxWheel}
    on:keydown|capture={(e) => {
        if (ImagePreviewModal.isImagePreviewActive()) {
            return;
        }
        if (lightboxData) {
            handleLightboxKeydown(e);
            return;
        }
        if (isMultiSelectMode && e.key === "Escape") {
            isMultiSelectMode = false;
            selectedTaskIds.clear();
            selectedTaskIds = selectedTaskIds;
        } else if (isSearchOpen && e.key === "Escape") {
            closeSearch();
        }
    }}
/>

<div 
    class="main-container" 
    bind:this={mainContainerEl} 
    class:wrap-titles={wrapTaskTitles} 
    class:center-tasks={centerAlignTasks} 
    class:has-header-title={showListTitleInHeader}
    role="application"
    on:pointerdown|capture={handleMainPointerDown}
    on:pointerup|capture={handleMainPointerUp}
    on:auxclick={handleMainAuxClick}
    on:contextmenu|capture={handleMainContextMenu}
>
    {#if currentCategory}
        <!-- Header -->
        <div class="main-header" class:has-header-title={showListTitleInHeader}>
            <div class="main-header-left">
                {#if isEditingCategoryName}
                    <div class="category-title-edit-wrap">
                        <input 
                            type="text"
                            class="category-title-input size-{mainListTitleSize}"
                            bind:this={categoryRenameInputEl}
                            bind:value={editingCategoryName}
                            on:compositionstart={() => { isComposingCategoryTitle = true; }}
                            on:compositionend={() => { isComposingCategoryTitle = false; }}
                            on:keydown={handleCategoryTitleKeydown}
                            on:blur={commitRenameCategory}
                        />
                    </div>
                {:else if !showListTitleInHeader}
                    {#if currentCategory.filepath === STARRED_CATEGORY_PATH}
                        <h1 class="category-title is-smart-title size-{mainListTitleSize}" style="cursor: default; display: flex; align-items: center; gap: 8px;">
                            <span style="color: var(--todo-star, var(--todo-accent, #8b5cf6)); font-size: 1.1em;">★</span>
                            <span>{currentCategory.name}</span>
                        </h1>
                    {:else}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <h1 
                            class="category-title size-{mainListTitleSize}" 
                            role="button"
                            tabindex="0"
                            title={t("rename_list_tooltip")}
                            on:click={startRenameCategory}
                            on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startRenameCategory(); } }}
                            on:mouseenter={() => { isCategoryTitleHovered = true; }}
                            on:mouseleave={() => { isCategoryTitleHovered = false; }}
                        >
                            {currentCategory.name}
                        </h1>
                    {/if}
                {/if}

                {#if enableFocusedLists}
                    <div class="focused-lists-bar">
                        <button 
                            class="focused-lists-config-btn"
                            type="button"
                            title={t("focused_lists_btn_tooltip") || "Focused lists"}
                            aria-label="Focused lists"
                            on:click={openFocusedListsModal}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="3" width="7" height="7"></rect>
                                <rect x="14" y="3" width="7" height="7"></rect>
                                <rect x="14" y="14" width="7" height="7"></rect>
                                <rect x="3" y="14" width="7" height="7"></rect>
                            </svg>
                        </button>

                        {#if focusedCategories.length > 0}
                            <div 
                                class="focused-lists-pills"
                                use:dndzone={{
                                    items: focusedCategories,
                                    flipDurationMs: DND_FLIP_DURATION,
                                    dropAnimationDisabled: true,
                                    dropTargetStyle: {},
                                    type: 'focused-lists-pills'
                                }}
                                on:consider={handleFocusedPillsConsider}
                                on:finalize={handleFocusedPillsFinalize}
                            >
                                {#each focusedCategories as cat (cat.id)}
                                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                                    <div 
                                        class="focused-list-pill"
                                        class:is-active={currentCategory?.filepath === cat.filepath}
                                        class:drag-over={dragOverFocusedPath === cat.filepath}
                                        class:is-shadow={isShadowPill(cat)}
                                        data-filepath={cat.filepath}
                                        role="button"
                                        tabindex="0"
                                        title={cat.name}
                                        animate:flip={{ duration: DND_FLIP_DURATION }}
                                        on:click={() => handleSelectFocusedCategory(cat)}
                                        on:keydown={(e) => e.key === "Enter" && handleSelectFocusedCategory(cat)}
                                    >
                                        {cat.name}
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>

            <div class="main-header-actions">
                {#if showNoHotkeyWarning}
                    <button class="header-hotkey-warning-pill"
                            on:click={handleOpenHotkeySettings}
                            title={t("warn_bind_hotkey_tooltip")}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <span>{t("warn_bind_hotkey_btn")}</span>
                    </button>
                {/if}
                {#if isMultiSelectMode}
                    <div class="header-multi-select-group">
                        <span class="header-multi-select-count" title={t("selected_items_label", selectedTaskIds.size)}>
                            {selectedTaskIds.size}
                        </span>

                        <!-- Select All / Deselect All -->
                        <span class="icon-btn"
                              class:is-active={selectedTaskIds.size > 0 && selectedTaskIds.size === (incompleteTasks.length + completedTasks.length)}
                              on:click|stopPropagation={selectAllTasks}
                              role="button" tabindex="0"
                              aria-label={selectedTaskIds.size === (incompleteTasks.length + completedTasks.length) && (incompleteTasks.length + completedTasks.length) > 0 ? t("deselect_all") : t("select_all")}
                              title={selectedTaskIds.size === (incompleteTasks.length + completedTasks.length) && (incompleteTasks.length + completedTasks.length) > 0 ? t("deselect_all") : t("select_all")}
                              on:keydown|stopPropagation={(e) => e.key === "Enter" && selectAllTasks()}>
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 6L7 17l-5-5"/>
                                <path d="M22 10l-7.5 7.5L13 16"/>
                            </svg>
                        </span>

                        <!-- Select Incomplete Tasks -->
                        <span class="icon-btn"
                              class:is-active={incompleteTasks.length > 0 && incompleteTasks.every(t => selectedTaskIds.has(t.id)) && selectedTaskIds.size === incompleteTasks.length}
                              on:click|stopPropagation={selectIncompleteTasks}
                              role="button" tabindex="0"
                              aria-label={t("select_incomplete_tasks")}
                              title={t("select_incomplete_tasks")}
                              on:keydown|stopPropagation={(e) => e.key === "Enter" && selectIncompleteTasks()}>
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="9"/>
                            </svg>
                        </span>

                        <!-- Select Completed Tasks -->
                        <span class="icon-btn"
                              class:is-active={completedTasks.length > 0 && completedTasks.every(t => selectedTaskIds.has(t.id)) && selectedTaskIds.size === completedTasks.length}
                              on:click|stopPropagation={selectCompletedTasks}
                              role="button" tabindex="0"
                              aria-label={t("select_completed_tasks")}
                              title={t("select_completed_tasks")}
                              on:keydown|stopPropagation={(e) => e.key === "Enter" && selectCompletedTasks()}>
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                                <polyline points="22 4 12 14.01 9 11.01"/>
                            </svg>
                        </span>

                        <!-- Batch Star -->
                        {#if !hiddenStarMode}
                            <span class="icon-btn"
                                  class:is-disabled={selectedTaskIds.size === 0}
                                  on:click|stopPropagation={() => selectedTaskIds.size > 0 && handleBatchStar()}
                                  role="button" tabindex="0"
                                  aria-label={t("batch_star")}
                                  title={t("batch_star")}
                                  on:keydown|stopPropagation={(e) => e.key === "Enter" && selectedTaskIds.size > 0 && handleBatchStar()}>
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                </svg>
                            </span>
                        {/if}

                        <!-- Batch Delete -->
                        <span class="icon-btn is-delete"
                              class:is-disabled={selectedTaskIds.size === 0}
                              on:click|stopPropagation={() => selectedTaskIds.size > 0 && handleBatchDelete()}
                              role="button" tabindex="0"
                              aria-label={t("batch_delete")}
                              title={t("batch_delete")}
                              on:keydown|stopPropagation={(e) => e.key === "Enter" && selectedTaskIds.size > 0 && handleBatchDelete()}>
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </span>

                        <!-- Exit multi select mode -->
                        <span class="icon-btn is-exit"
                              on:click|stopPropagation={() => { isMultiSelectMode = false; selectedTaskIds.clear(); selectedTaskIds = selectedTaskIds; }}
                              role="button" tabindex="0"
                              aria-label={t("exit_multi_select")}
                              title={t("exit_multi_select")}
                              on:keydown|stopPropagation={(e) => e.key === "Enter" && (isMultiSelectMode = false, selectedTaskIds.clear(), selectedTaskIds = selectedTaskIds)}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </span>
                    </div>
                {:else}
                    <!-- More options menu (three vertical dots) -->
                    <span class="icon-btn"
                          on:click|stopPropagation={openHeaderMoreMenu}
                          role="button" tabindex="0"
                          aria-label="More options"
                          title="More options"
                          on:keydown|stopPropagation={(e) => (e.key === "Enter" || e.key === " ") && openHeaderMoreMenu(e)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                            <circle cx="12" cy="12" r="2"/>
                            <circle cx="12" cy="5" r="2"/>
                            <circle cx="12" cy="19" r="2"/>
                        </svg>
                    </span>
                {/if}
            </div>
        </div>

        {#if isSearchOpen}
            <!-- In-List Search Filter Bar & Dropdown Overlay -->
            <div class="main-search-bar-wrap">
                <div class="quick-modal-filter-bar main-search-filter-bar">
                    <span class="quick-modal-filter-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </span>
                    <input 
                        type="text" 
                        class="quick-modal-filter-input"
                        placeholder={t("main_view_task_search_placeholder") || "Search tasks in this list (title, steps, notes)..."}
                        bind:value={searchQuery}
                        bind:this={searchInputEl}
                        on:input={() => runTaskSearch(searchQuery)}
                        on:compositionstart={() => { isSearchComposing = true; }}
                        on:compositionend={() => { isSearchComposing = false; runTaskSearch(searchQuery); }}
                        on:keydown={handleSearchKeydown}
                    />
                    {#if searchQuery}
                        <button class="quick-modal-filter-clear" on:click={() => { searchQuery = ""; taskSearchResults = []; searchInputEl?.focus(); }}>✕</button>
                    {/if}

                    <button 
                        class="quick-modal-header-btn main-search-scope-pill"
                        tabindex="-1"
                        title={t("main_view_search_list_only_tooltip") || "List only"}
                        on:click={handleListOnlyClick}
                    >
                        {t("main_view_search_list_only_btn") || "List only"}
                    </button>

                    <button 
                        class="quick-modal-header-btn quick-modal-close-btn main-search-close-btn"
                        aria-label="Close search (Esc)"
                        title="Close search (Esc)"
                        tabindex="-1"
                        on:click={closeSearch}
                    >
                        ✕
                    </button>
                </div>

                {#if searchQuery.trim().length > 0}
                    <!-- Floating Task Search Results Dropdown Overlay -->
                    <div class="quick-modal-task-dropdown main-search-task-dropdown" bind:this={taskResultsContainerEl}>
                        {#if isSearchingTasks}
                            <div class="quick-modal-task-dropdown-status">Searching tasks...</div>
                        {:else if taskSearchResults.length === 0}
                            <div class="quick-modal-task-dropdown-status">{t("quick_list_task_search_no_results") || "No matching tasks found."}</div>
                        {:else}
                            <div class="quick-modal-task-dropdown-list" role="listbox">
                                {#each taskSearchResults as item, idx (item.task.id)}
                                    <!-- svelte-ignore a11y-no-noninteractive-tabindex a11y-click-events-have-key-events -->
                                    <div 
                                        class="quick-modal-task-item"
                                        class:is-focused={taskFocusedIndex === idx}
                                        class:is-completed={item.task.completed}
                                        role="option"
                                        aria-selected={taskFocusedIndex === idx}
                                        tabindex="0"
                                        on:mouseenter={() => { taskFocusedIndex = idx; }}
                                        on:click={() => selectSearchResult(item)}
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
        {/if}

        <!-- Add Task Input -->
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="add-task-container" 
             class:is-editing={isAddTaskFocused || newTaskTitle.trim().length > 0}
             on:click={() => addTaskInputEl?.focus()}>
            <span class="plus-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </span>
            <textarea
                class="add-task-input"
                use:autosize={newTaskTitle}
                rows="1"
                placeholder="Add a task (Press Enter to add, Shift+Enter for newline)"
                bind:value={newTaskTitle}
                bind:this={addTaskInputEl}
                on:focus={() => { isAddTaskFocused = true; }}
                on:blur={() => { isAddTaskFocused = false; handleAddTaskBlur(); }}
                on:keydown={handleAddTaskKeydown}
            />
        </div>

        <!-- Incomplete Tasks (drag-sortable) -->
        <div class="task-list"
             use:dndzone={{ items: incompleteTasks, flipDurationMs: DND_FLIP_DURATION, dropAnimationDisabled: true, dropTargetStyle: {} }}
             on:consider={(e) => handleDndConsider(e, 'incomplete')}
             on:finalize={(e) => handleDndFinalize(e, 'incomplete')}
        >
            {#each incompleteTasks as task (task.id)}
                {@const badgeData = getTaskBadges(task)}
                <div
                    id={'task-' + task.id}
                    animate:flip={{duration: DND_FLIP_DURATION}}
                    class="task-item"
                    class:has-images={getTitleImages(task).length > 0}
                    class:is-center-aligned={centerAlignTasks}
                    class:selected={selectedTaskId === task.id}
                    class:is-multi-selected={isMultiSelectMode && selectedTaskIds.has(task.id)}
                    class:just-created={justCreatedTaskId === task.id}
                    on:pointerdown={() => handleTaskPointerDown(task)}
                    on:click={() => selectTask(task)}
                    on:contextmenu={(e) => handleContextMenu(e, task)}
                    on:keydown={(e) => e.key === "Enter" && selectTask(task)}
                    on:mouseenter={() => handleTaskMouseEnter(task)}
                    on:mouseleave={() => handleTaskMouseLeave(task)}
                    tabindex="0"
                    role="button"
                >
                    <div class="task-left-controls">
                        {#if isMultiSelectMode}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <span class="multi-select-checkbox-wrap" on:click|stopPropagation={() => toggleTaskSelection(task.id)}>
                                <span class="multi-select-checkbox" class:is-checked={selectedTaskIds.has(task.id)}>
                                    {#if selectedTaskIds.has(task.id)}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                            <polyline points="20 6 9 17 4 12"></polyline>
                                        </svg>
                                    {/if}
                                </span>
                            </span>
                        {/if}

                        <!-- Checkbox circle -->
                        <span class="checkbox" on:click|stopPropagation={() => toggleComplete(task)}
                              role="checkbox" aria-checked="false" tabindex="0"
                              on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleComplete(task)}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                            </svg>
                        </span>
                    </div>

                    <div class="task-content">
                        {#if getTitleImages(task).length > 0}
                            <TaskImageStrip
                                images={getTitleImages(task)}
                                app={actualApp}
                                size={38}
                                isCenterAligned={centerAlignTasks}
                                onDelete={(imgRef) => removeImageFromMainTaskTitle(task, imgRef)}
                                onCut={(imgRef) => cutImageFromMainTaskTitle(task, imgRef)}
                                onHover={(imgRef, isHovered) => handleThumbnailHover(task, imgRef, isHovered)}
                            />
                        {/if}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span class="task-title"
                              on:mouseenter={(e) => handleTitleHover(e, task)}
                              on:mousemove={(e) => handleTitleMouseMove(e, task)}
                              on:mouseleave={handleTitleMouseLeave}>
                            {cleanDisplayTitle(task.title) || task.title}
                        </span>
                        <div class="task-meta-row">
                            {#if currentCategory?.filepath === STARRED_CATEGORY_PATH && task.sourceCategoryName}
                                <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                                <span 
                                    class="task-meta source-category-badge" 
                                    title={`From list: ${task.sourceCategoryName} (Click to jump)`}
                                    on:click|stopPropagation={() => jumpToSourceCategory(task.sourceFilepath)}
                                >
                                    📁 {task.sourceCategoryName}
                                </span>
                            {/if}
                            {#if task.steps.length > 0}
                                <!-- svelte-ignore a11y-no-static-element-interactions -->
                                <span class="task-meta steps-badge"
                                      on:click|stopPropagation={() => openStepsModal(task)}
                                      on:keydown|stopPropagation={(e) => (e.key === "Enter" || e.key === " ") && openStepsModal(task)}
                                      on:mouseenter={(e) => showPopover(e, task, 'steps')}
                                      on:mouseleave={scheduleHidePopover}
                                      role="button"
                                      tabindex="0"
                                      title="Click to view & edit subtasks, hover to preview">
                                    {task.steps.filter(s => s.done).length}/{task.steps.length} steps
                                </span>
                            {/if}
                            {#if task.dueDate}
                                <span class="task-meta due-date">
                                    {task.dueDate}
                                </span>
                            {/if}
                            {#if task.recurrence}
                                <span class="task-meta recurrence" title="Recurring task">
                                    <svg class="recurrence-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
                                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="17 1 21 5 17 9"/>
                                        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                                        <polyline points="7 23 3 19 7 15"/>
                                        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                                    </svg>
                                </span>
                            {/if}
                        </div>
                    </div>

                    <div class="task-right-controls">
                        <!-- Meta Badges (Visible max 9) -->
                        {#each badgeData.visibleBadges as badge (badge.id)}
                            {#if badge.type === 'why'}
                                <span class="meta-badge why-badge"
                                      on:mouseenter={(e) => showPopover(e, task, 'why', badge.index)}
                                      on:mouseleave={scheduleHidePopover}
                                      role="button" tabindex="0"
                                      title={((task.whys && task.whys.length > 1) ? `Why #${(badge.index || 0) + 1}: view rationale` : "Why: view rationale")}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="12" cy="12" r="10"/>
                                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                                    </svg>
                                </span>
                            {:else if badge.type === 'svg'}
                                <span class="meta-badge svg-badge"
                                      on:mouseenter={(e) => showPopover(e, task, 'svg', badge.index)}
                                      on:mouseleave={scheduleHidePopover}
                                      on:click={(e) => badge.svgContent && openSvgLightbox(e, badge.svgContent, task.title)}
                                      on:keydown={(e) => e.key === "Enter" && badge.svgContent && openSvgLightbox(e, badge.svgContent, task.title)}
                                      role="button" tabindex="0"
                                      title="Visual memory SVG: click to enlarge, hover to preview">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                        <polyline points="21 15 16 10 5 21"/>
                                    </svg>
                                </span>
                            {:else if badge.type === 'note' && badge.noteLink}
                                <span class="meta-badge note-badge"
                                      class:task-note={badge.id === 'task-note'}
                                      class:note-link={badge.id !== 'task-note'}
                                      class:hard-bound={LinkedNoteService.isHardBoundNote(badge.noteLink)}
                                      on:mouseenter={(e) => handleNoteLinkHover(e, badge.noteLink)}
                                      on:click={(e) => handleNoteLinkClick(e, badge.noteLink, badge.id === 'task-note' ? task.id : undefined)}
                                      on:keydown={(e) => e.key === "Enter" && handleNoteLinkClick(e, badge.noteLink, badge.id === 'task-note' ? task.id : undefined)}
                                      role="button" tabindex="0"
                                      title={t("linked_note_preview_tooltip", badge.noteLink)}>
                                    {#if LinkedNoteService.isHardBoundNote(badge.noteLink)}
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                            <polyline points="14 2 14 8 20 8"/>
                                            <line x1="16" y1="13" x2="8" y2="13"/>
                                            <line x1="16" y1="17" x2="8" y2="17"/>
                                            <polyline points="10 9 9 9 8 9"/>
                                        </svg>
                                    {:else}
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                                        </svg>
                                    {/if}
                                </span>
                            {:else if badge.type === 'custom'}
                                <span class="meta-badge custom-badge"
                                      on:mouseenter={(e) => showPopover(e, task, 'custom')}
                                      on:mouseleave={scheduleHidePopover}
                                      role="button" tabindex="0"
                                      title="Custom properties">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                                        <line x1="7" y1="7" x2="7.01" y2="7"/>
                                    </svg>
                                </span>
                            {/if}
                        {/each}

                        <!-- Overflow Badges Dropdown (···) -->
                        {#if badgeData.overflowBadges.length > 0}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <span class="meta-badge more-badge"
                                  on:click|stopPropagation={(e) => openBadgesOverflowMenu(e, task, badgeData.overflowBadges)}
                                  on:keydown|stopPropagation={(e) => (e.key === "Enter" || e.key === " ") && openBadgesOverflowMenu(e, task, badgeData.overflowBadges)}
                                  role="button" tabindex="0"
                                  title={`More metadata (${badgeData.overflowBadges.length}): click to view`}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                    <circle cx="5" cy="12" r="2"/>
                                    <circle cx="12" cy="12" r="2"/>
                                    <circle cx="19" cy="12" r="2"/>
                                </svg>
                            </span>
                        {/if}

                        <!-- Star -->
                        {#if !hiddenStarMode}
                            <span class="star" class:active={task.starred}
                                  on:click|stopPropagation={() => toggleStar(task)}
                                  role="button" tabindex="0"
                                  on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleStar(task)}>
                                <svg width="14" height="14" viewBox="0 0 24 24"
                                     fill={task.starred ? "currentColor" : "none"}
                                     stroke="currentColor" stroke-width="2">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                </svg>
                            </span>
                        {/if}

                        <!-- Weight Control (Priority 1-9) -->
                        {#if enableTaskWeightMode}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <div class="task-weight-control"
                                 class:is-editing={editingWeightTaskId === task.id}
                                 on:click|stopPropagation={() => startEditingWeight(task)}
                                 on:pointerdown|stopPropagation
                                 on:wheel|preventDefault|stopPropagation={(e) => handleWeightWheel(e, task)}
                                 on:mouseleave={handleWeightMouseLeave}
                                 title="Priority: {getTaskWeight(task)} (Scroll or click to edit 1-9)">
                                {#if editingWeightTaskId === task.id}
                                    <input
                                        type="text"
                                        class="task-weight-input"
                                        data-task-id={task.id}
                                        maxlength="1"
                                        placeholder={String(getTaskWeight(task))}
                                        bind:value={editingWeightValue}
                                        on:blur={() => commitWeightEdit(task)}
                                        on:keydown={(e) => handleWeightInputKeydown(e, task)}
                                        on:input={(e) => handleWeightInput(e, task)}
                                        on:click|stopPropagation
                                        on:pointerdown|stopPropagation
                                    />
                                {:else}
                                    <span class="weight-score-badge" class:high-weight={getTaskWeight(task) >= 7} class:low-weight={getTaskWeight(task) <= 3}>
                                        {getTaskWeight(task)}
                                    </span>
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>

        <!-- Completed Section -->
        {#if completedTasks.length > 0}
            <div class="completed-section" class:is-collapsed={!showCompleted}>
                <div class="completed-header" on:click={toggleCompletedSection}
                     role="button" tabindex="0"
                     on:keydown={(e) => e.key === "Enter" && toggleCompletedSection()}>
                    <span class="chevron" class:open={showCompleted}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </span>
                    <span>Completed</span>
                    <span class="completed-count">{completedTasks.length}</span>
                </div>

                {#if showCompleted}
                    <div class="completed-list"
                         use:dndzone={{ items: completedTasks, flipDurationMs: DND_FLIP_DURATION, dropAnimationDisabled: true, dropTargetStyle: {} }}
                         on:consider={(e) => handleDndConsider(e, 'completed')}
                         on:finalize={(e) => handleDndFinalize(e, 'completed')}
                     >
                        {#each completedTasks as task (task.id)}
                            {@const badgeData = getTaskBadges(task)}
                            <div
                                id={'task-' + task.id}
                                animate:flip={{duration: DND_FLIP_DURATION}}
                                class="task-item completed"
                                class:has-images={getTitleImages(task).length > 0}
                                class:is-center-aligned={centerAlignTasks}
                                class:selected={selectedTaskId === task.id}
                                class:is-multi-selected={isMultiSelectMode && selectedTaskIds.has(task.id)}
                                class:just-created={justCreatedTaskId === task.id}
                                on:pointerdown={() => handleTaskPointerDown(task)}
                                on:click={() => selectTask(task)}
                                on:contextmenu={(e) => handleContextMenu(e, task)}
                                on:keydown={(e) => e.key === "Enter" && selectTask(task)}
                                on:mouseenter={() => handleTaskMouseEnter(task)}
                                on:mouseleave={() => handleTaskMouseLeave(task)}
                                tabindex="0"
                                role="button"
                            >
                                <div class="task-left-controls">
                                    {#if isMultiSelectMode}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <span class="multi-select-checkbox-wrap" on:click|stopPropagation={() => toggleTaskSelection(task.id)}>
                                            <span class="multi-select-checkbox" class:is-checked={selectedTaskIds.has(task.id)}>
                                                {#if selectedTaskIds.has(task.id)}
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                                        <polyline points="20 6 9 17 4 12"></polyline>
                                                    </svg>
                                                {/if}
                                            </span>
                                        </span>
                                    {/if}

                                    <span class="checkbox" on:click|stopPropagation={() => toggleComplete(task)}
                                          role="checkbox" aria-checked="true" tabindex="0"
                                          on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleComplete(task)}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                                             stroke="var(--todo-accent)" stroke-width="2">
                                            <circle cx="12" cy="12" r="10"/>
                                            <polyline points="8 12 11 15 16 9"/>
                                        </svg>
                                    </span>
                                </div>

                                <div class="task-content">
                                    {#if getTitleImages(task).length > 0}
                                        <TaskImageStrip
                                            images={getTitleImages(task)}
                                            app={actualApp}
                                            size={38}
                                            isCenterAligned={centerAlignTasks}
                                            onDelete={(imgRef) => removeImageFromMainTaskTitle(task, imgRef)}
                                            onCut={(imgRef) => cutImageFromMainTaskTitle(task, imgRef)}
                                            onHover={(imgRef, isHovered) => handleThumbnailHover(task, imgRef, isHovered)}
                                        />
                                    {/if}
                                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                                    <span class="task-title"
                                          on:mouseenter={(e) => handleTitleHover(e, task)}
                                          on:mousemove={(e) => handleTitleMouseMove(e, task)}
                                          on:mouseleave={handleTitleMouseLeave}>
                                        {cleanDisplayTitle(task.title) || task.title}
                                    </span>
                                    <div class="task-meta-row">
                                        {#if currentCategory?.filepath === STARRED_CATEGORY_PATH && task.sourceCategoryName}
                                            <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                                            <span 
                                                class="task-meta source-category-badge" 
                                                title={`From list: ${task.sourceCategoryName} (Click to jump)`}
                                                on:click|stopPropagation={() => jumpToSourceCategory(task.sourceFilepath)}
                                            >
                                                📁 {task.sourceCategoryName}
                                            </span>
                                        {/if}
                                        {#if task.steps && task.steps.length > 0}
                                                <!-- svelte-ignore a11y-no-static-element-interactions -->
                                                <span class="task-meta steps-badge"
                                                      on:click|stopPropagation={() => openStepsModal(task)}
                                                      on:keydown|stopPropagation={(e) => (e.key === "Enter" || e.key === " ") && openStepsModal(task)}
                                                      on:mouseenter={(e) => showPopover(e, task, 'steps')}
                                                      on:mouseleave={scheduleHidePopover}
                                                      role="button"
                                                      tabindex="0"
                                                      title="Click to view & edit subtasks, hover to preview">
                                                    {task.steps.filter(s => s.done).length}/{task.steps.length} steps
                                                </span>
                                            {/if}
                                            {#if task.dueDate}
                                                <span class="task-meta due-date">{task.dueDate}</span>
                                            {/if}
                                            {#if task.recurrence}
                                                <span class="task-meta recurrence">
                                                    <svg class="recurrence-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
                                                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <polyline points="17 1 21 5 17 9"/>
                                                        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                                                        <polyline points="7 23 3 19 7 15"/>
                                                        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                                                    </svg>
                                                </span>
                                            {/if}
                                        </div>
                                </div>

                                <div class="task-right-controls">
                                    <!-- Meta Badges (Visible max 9) -->
                                    {#each badgeData.visibleBadges as badge (badge.id)}
                                        {#if badge.type === 'why'}
                                            <span class="meta-badge why-badge"
                                                  on:mouseenter={(e) => showPopover(e, task, 'why', badge.index)}
                                                  on:mouseleave={scheduleHidePopover}
                                                  role="button" tabindex="0"
                                                  title={((task.whys && task.whys.length > 1) ? `Why #${(badge.index || 0) + 1}: view rationale` : "Why: view rationale")}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <circle cx="12" cy="12" r="10"/>
                                                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                                </svg>
                                            </span>
                                        {:else if badge.type === 'svg'}
                                            <span class="meta-badge svg-badge"
                                                  on:mouseenter={(e) => showPopover(e, task, 'svg', badge.index)}
                                                  on:mouseleave={scheduleHidePopover}
                                                  on:click={(e) => badge.svgContent && openSvgLightbox(e, badge.svgContent, task.title)}
                                                  on:keydown={(e) => e.key === "Enter" && badge.svgContent && openSvgLightbox(e, badge.svgContent, task.title)}
                                                  role="button" tabindex="0"
                                                  title="Visual memory SVG: click to enlarge, hover to preview">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                                    <circle cx="8.5" cy="8.5" r="1.5"/>
                                                    <polyline points="21 15 16 10 5 21"/>
                                                </svg>
                                            </span>
                                        {:else if badge.type === 'note' && badge.noteLink}
                                            <span class="meta-badge note-badge"
                                                  class:task-note={badge.id === 'task-note'}
                                                  class:note-link={badge.id !== 'task-note'}
                                                  class:hard-bound={LinkedNoteService.isHardBoundNote(badge.noteLink)}
                                                  on:mouseenter={(e) => handleNoteLinkHover(e, badge.noteLink)}
                                                  on:click={(e) => handleNoteLinkClick(e, badge.noteLink, badge.id === 'task-note' ? task.id : undefined)}
                                                  on:keydown={(e) => e.key === "Enter" && handleNoteLinkClick(e, badge.noteLink, badge.id === 'task-note' ? task.id : undefined)}
                                                  role="button" tabindex="0"
                                                  title={t("linked_note_preview_tooltip", badge.noteLink)}>
                                                {#if LinkedNoteService.isHardBoundNote(badge.noteLink)}
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                        <polyline points="14 2 14 8 20 8"/>
                                                        <line x1="16" y1="13" x2="8" y2="13"/>
                                                        <line x1="16" y1="17" x2="8" y2="17"/>
                                                        <polyline points="10 9 9 9 8 9"/>
                                                    </svg>
                                                {:else}
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                                                    </svg>
                                                {/if}
                                            </span>
                                        {:else if badge.type === 'custom'}
                                            <span class="meta-badge custom-badge"
                                                  on:mouseenter={(e) => showPopover(e, task, 'custom')}
                                                  on:mouseleave={scheduleHidePopover}
                                                  role="button" tabindex="0"
                                                  title="Custom properties">
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                                                    <line x1="7" y1="7" x2="7.01" y2="7"/>
                                                </svg>
                                            </span>
                                        {/if}
                                    {/each}

                                    <!-- Overflow Badges Dropdown (···) -->
                                    {#if badgeData.overflowBadges.length > 0}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <span class="meta-badge more-badge"
                                              on:click|stopPropagation={(e) => openBadgesOverflowMenu(e, task, badgeData.overflowBadges)}
                                              on:keydown|stopPropagation={(e) => (e.key === "Enter" || e.key === " ") && openBadgesOverflowMenu(e, task, badgeData.overflowBadges)}
                                              role="button" tabindex="0"
                                              title={`More metadata (${badgeData.overflowBadges.length}): click to view`}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                                <circle cx="5" cy="12" r="2"/>
                                                <circle cx="12" cy="12" r="2"/>
                                                <circle cx="19" cy="12" r="2"/>
                                            </svg>
                                        </span>
                                    {/if}

                                    <!-- Star -->
                                    {#if !hiddenStarMode}
                                        <span class="star" class:active={task.starred}
                                              on:click|stopPropagation={() => toggleStar(task)}
                                              role="button" tabindex="0"
                                              on:keydown|stopPropagation={(e) => e.key === "Enter" && toggleStar(task)}>
                                            <svg width="14" height="14" viewBox="0 0 24 24"
                                                 fill={task.starred ? "currentColor" : "none"}
                                                 stroke="currentColor" stroke-width="2">
                                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                            </svg>
                                        </span>
                                    {/if}

                                    <!-- Weight Control (Priority 1-9) -->
                                    {#if enableTaskWeightMode}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <div class="task-weight-control"
                                             class:is-editing={editingWeightTaskId === task.id}
                                             on:click|stopPropagation={() => startEditingWeight(task)}
                                             on:pointerdown|stopPropagation
                                             on:wheel|preventDefault|stopPropagation={(e) => handleWeightWheel(e, task)}
                                             on:mouseleave={handleWeightMouseLeave}
                                             title="Priority: {getTaskWeight(task)} (Scroll or click to edit 1-9)">
                                            {#if editingWeightTaskId === task.id}
                                                <input
                                                    type="text"
                                                    class="task-weight-input"
                                                    data-task-id={task.id}
                                                    maxlength="1"
                                                    placeholder={String(getTaskWeight(task))}
                                                    bind:value={editingWeightValue}
                                                    on:blur={() => commitWeightEdit(task)}
                                                    on:keydown={(e) => handleWeightInputKeydown(e, task)}
                                                    on:input={(e) => handleWeightInput(e, task)}
                                                    on:click|stopPropagation
                                                    on:pointerdown|stopPropagation
                                                />
                                            {:else}
                                                <span class="weight-score-badge" class:high-weight={getTaskWeight(task) >= 7} class:low-weight={getTaskWeight(task) <= 3}>
                                                    {getTaskWeight(task)}
                                                </span>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    {:else}
        {#if showNoHotkeyWarning}
            <div class="main-empty-header-actions">
                <button class="header-hotkey-warning-pill"
                        on:click={handleOpenHotkeySettings}
                        title={t("warn_bind_hotkey_tooltip")}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <span>{t("warn_bind_hotkey_btn")}</span>
                </button>
            </div>
        {/if}
        <div class="detail-empty">
            {hideLeftSidebar ? (t("empty_state_hide_sidebar_desc") || "Sidebar is hidden. Use Quick List (Floating UI) to select a list.") : "Select a list from the sidebar to view tasks."}
        </div>
    {/if}

    <!-- Global Meta Badge Popover (Portaled to document.body to prevent sidebar clipping) -->
    {#if popoverVisible && (popoverTask || popoverType === 'guide')}
        <div use:portal
             class="meta-popover placement-{popoverPlacement}"
             class:guide-popover={popoverType === 'guide'}
             class:is-center-aligned={centerAlignTasks}
             style="left: {popoverX}px; top: {popoverY}px;"
             on:mouseenter={cancelHidePopover}
             on:mouseleave={scheduleHidePopover}
             on:contextmenu|preventDefault={dismissPopover}
             role="tooltip">
            {#if popoverType === 'why' && popoverTask && (popoverTask.why || (popoverTask.whys && popoverTask.whys.length > 0))}
                {@const activeWhys = (popoverTask.whys && popoverTask.whys.length > 0) ? popoverTask.whys : (popoverTask.why ? [popoverTask.why] : [])}
                {@const activeWhy = activeWhys[popoverSvgIndex] || activeWhys[0] || ""}
                <div class="meta-popover-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <span>Why {activeWhys.length > 1 ? `#${popoverSvgIndex + 1}` : ''}</span>
                    </div>
                </div>
                <div class="meta-popover-body">{activeWhy}</div>
            {:else if popoverType === 'svg' && popoverTask && popoverTask.svgs && popoverTask.svgs[popoverSvgIndex]}
                {@const resolved = resolveSvgItem(popoverTask.svgs[popoverSvgIndex])}
                <div class="meta-popover-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>
                    </div>
                    <span class="meta-popover-hint">{isChinese() ? "点击放大" : "Click to enlarge"}</span>
                </div>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div class="meta-popover-svg-preview"
                     on:click={(e) => popoverTask && popoverTask.svgs && openSvgLightbox(e, popoverTask.svgs[popoverSvgIndex], popoverTask.title)}
                     role="button" tabindex="0"
                     title="Click to view full size">
                    {#if resolved.isInline}
                        {@html resolved.content}
                    {:else}
                        <img src={resolved.srcUrl} alt="Visual memory" class="meta-popover-img" />
                    {/if}
                </div>
            {:else if popoverType === 'custom' && popoverTask && popoverTask.customMeta}
                <div class="meta-popover-header">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                            <line x1="7" y1="7" x2="7.01" y2="7"/>
                        </svg>
                        <span>Custom Properties</span>
                    </div>
                </div>
                <div class="meta-popover-custom-grid">
                    {#each Object.entries(popoverTask.customMeta) as [k, v]}
                        <div class="meta-popover-custom-row">
                            <span class="custom-row-key">{k}:</span>
                            <span class="custom-row-val">{v}</span>
                        </div>
                    {/each}
                </div>
            {:else if popoverType === 'steps' && popoverTask && popoverTask.steps && popoverTask.steps.length > 0}
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="meta-popover-steps-card"
                     on:click|stopPropagation={() => openStepsModal(popoverTask)}
                     on:keydown|stopPropagation={(e) => e.key === "Enter" && openStepsModal(popoverTask)}
                     role="button"
                     tabindex="0"
                     title="Click to open big subtasks editor">
                    <div class="meta-popover-header">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="9 11 12 14 22 4"/>
                                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                            </svg>
                            <span style="font-weight: 600;">Subtasks Checklist</span>
                        </div>
                        <span class="meta-popover-hint">{popoverTask.steps.filter(s => s.done).length}/{popoverTask.steps.length} done</span>
                    </div>
                    <div class="popover-steps-list" style="margin-top: 6px;">
                        {#each popoverTask.steps as step}
                            <div class="popover-step-item" class:done={step.done}>
                                <span class="step-bullet">{step.done ? "✓" : "○"}</span>
                                <span class="step-text">{cleanDisplayTitle(step.text) || step.text}</span>
                            </div>
                        {/each}
                    </div>
                    <div class="meta-popover-expand-hint">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="15 3 21 3 21 9"/>
                            <polyline points="9 21 3 21 3 15"/>
                            <line x1="21" y1="3" x2="14" y2="10"/>
                            <line x1="3" y1="21" x2="10" y2="14"/>
                        </svg>
                        <span>Click to expand & edit</span>
                    </div>
                </div>
            {:else if popoverType === 'title' && popoverTask}
                <div class="meta-popover-title-card">
                    <div class="meta-popover-header">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <span>Task Quick Peek</span>
                        </div>
                        {#if popoverTask.createdAt}
                            <span class="meta-popover-hint">{getRelativeTime(popoverTask.createdAt)}</span>
                        {/if}
                    </div>

                    <!-- Full Unclipped Title -->
                    <div class="meta-popover-full-title">{popoverTask.title}</div>

                    <!-- Mini Details Section -->
                    {#if popoverTask.steps && popoverTask.steps.length > 0}
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <div class="meta-popover-detail-section"
                             style="cursor: pointer;"
                             title="Click to open big subtasks editor"
                             role="button"
                             tabindex="0"
                             on:click|stopPropagation={() => openStepsModal(popoverTask)}>
                            <div class="popover-detail-label" style="display: flex; justify-content: space-between; align-items: center;">
                                <span>Steps ({popoverTask.steps.filter(s => s.done).length}/{popoverTask.steps.length})</span>
                                <span style="font-size: 10px; color: var(--todo-accent); text-transform: none; font-weight: normal;">Expand ↗</span>
                            </div>
                            <div class="popover-steps-list">
                                {#each popoverTask.steps as step}
                                    <div class="popover-step-item" class:done={step.done}>
                                        <span class="step-bullet">{step.done ? "✓" : "○"}</span>
                                        <span class="step-text">{cleanDisplayTitle(step.text) || step.text}</span>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    {#if popoverTask.note}
                        <div class="meta-popover-detail-section">
                            <div class="popover-detail-label">Note</div>
                            <div class="popover-note-box">{popoverTask.note}</div>
                        </div>
                    {/if}

                    {#if popoverTask.why}
                        <div class="meta-popover-detail-section">
                            <div class="popover-detail-label">Why / Rationale</div>
                            <div class="popover-why-box">{popoverTask.why}</div>
                        </div>
                    {/if}

                    {#if popoverTask.dueDate || popoverTask.recurrence}
                        <div class="meta-popover-footer-tags">
                            {#if popoverTask.dueDate}
                                <span class="popover-tag due-tag">📅 {popoverTask.dueDate}</span>
                            {/if}
                            {#if popoverTask.recurrence}
                                <span class="popover-tag repeat-tag">🔁 {getRecurrenceLabel(popoverTask.recurrence)}</span>
                            {/if}
                        </div>
                    {/if}
                </div>
            {:else if popoverType === 'guide'}
                <div class="meta-popover-guide-card">
                    <div class="meta-popover-header">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                <line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                            <span style="font-weight: 600;">Fluent Tasks Guide</span>
                        </div>
                        <span class="meta-popover-hint">Click for full guide</span>
                    </div>
                    <div class="meta-guide-items">
                        <div class="meta-guide-item">
                            <span class="guide-key">Quick List Modal</span>
                            <span class="guide-desc">Full-screen board navigator, horizontal slider & 2D arrow keys</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Floating Detail Modal</span>
                            <span class="guide-desc">Sidebar-free centered popup for editing task details</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Quick Task Modal</span>
                            <span class="guide-desc">Maximized popup for rapid keyboard task management</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Ctrl + Hover Title</span>
                            <span class="guide-desc">Quick peek full title, subtasks & notes</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Drag & Drop Tasks</span>
                            <span class="guide-desc">Reorder in-list or drag across panes to sidebar lists</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Direct Hover Badges</span>
                            <span class="guide-desc">Preview Why (?), SVG (🖼️), Note (📄), Custom (🏷️)</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Click Steps Badge</span>
                            <span class="guide-desc">Open large scrollable subtasks editor (edit, add, check & IME shield)</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Dedicated Link Note</span>
                            <span class="guide-desc">Header button creates note, syncs titles bidirectionally & prompts on delete</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Click Note / SVG</span>
                            <span class="guide-desc">Jump directly to note or open full SVG Lightbox</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Recurring & Due Dates</span>
                            <span class="guide-desc">Daily/weekly repeats with automatic next rollover</span>
                        </div>
                        <div class="meta-guide-item">
                            <span class="guide-key">Right Click</span>
                            <span class="guide-desc">Dismiss popovers / context actions (Move & Delete)</span>
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <!-- Global SVG Visual Memory Lightbox Modal (Portaled to document.body) -->
    {#if lightboxData}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div use:portal
             class="svg-lightbox-backdrop"
             on:click={handleLightboxClick}
             on:contextmenu|preventDefault={requestCloseSvgLightbox}
             role="presentation">
            <div class="svg-lightbox-modal" role="dialog" aria-modal="true" tabindex="-1">
                {#if showSaveToast}
                    <div class="svg-lightbox-toast">
                        <svg class="svg-lightbox-toast-icon" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        <span>{saveToastText}</span>
                    </div>
                {/if}
                <div class="svg-lightbox-header">
                    <div class="svg-lightbox-title-row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        <span class="svg-lightbox-title">{lightboxData.title || "Visual Memory Aid"}</span>
                        <div class="svg-lightbox-hints" style="font-size: 11px; display: inline-flex; gap: 6px; align-items: center; margin-left: 10px; overflow: visible;">
                            {#if isSvgQuickEditorInstalled()}
                                <div class="svg-help-wrap">
                                    <div class="svg-help-icon" title={isChinese() ? "操作说明 (悬浮查看)" : "Help & Shortcuts (Hover to view)"}>?</div>
                                    <div class="svg-help-popover">
                                        {#if isChinese()}
                                            <div class="svg-help-row"><kbd>Ctrl+S</kbd><span class="svg-help-desc">即时保存 (保留撤销记录)</span></div>
                                            <div class="svg-help-row"><kbd>智能排版</kbd><span class="svg-help-desc">自动居中并均匀分布卡片间隙</span></div>
                                            <div class="svg-help-row"><kbd>Ctrl+滚轮</kbd><span class="svg-help-desc">缩放UI框大小 (增大/减小)</span></div>
                                            <div class="svg-help-row"><kbd>Delete</kbd><span class="svg-help-desc">悬浮UI框按键直接删除</span></div>
                                            <div class="svg-help-row"><kbd>清空文本</kbd><span class="svg-help-desc">清空文字自动删除UI框</span></div>
                                            <div class="svg-help-row"><kbd>Shift+拖拽</kbd><span class="svg-help-desc">移动UI框</span></div>
                                            <div class="svg-help-row"><kbd>Alt+拖拽</kbd><span class="svg-help-desc">复制克隆UI框</span></div>
                                            <div class="svg-help-row"><kbd>Ctrl+Z / Y</kbd><span class="svg-help-desc">撤销与重做</span></div>
                                            <div class="svg-help-row"><kbd>双击 / F2</kbd><span class="svg-help-desc">快速编辑文字</span></div>
                                        {:else}
                                            <div class="svg-help-row"><kbd>Ctrl+S</kbd><span class="svg-help-desc">Save in-place (keeps history)</span></div>
                                            <div class="svg-help-row"><kbd>Smart Layout</kbd><span class="svg-help-desc">Auto-center and balance cards & gaps</span></div>
                                            <div class="svg-help-row"><kbd>Ctrl+Scroll</kbd><span class="svg-help-desc">Scale UI box size (enlarge/shrink)</span></div>
                                            <div class="svg-help-row"><kbd>Delete</kbd><span class="svg-help-desc">Hover and press Delete to remove box</span></div>
                                            <div class="svg-help-row"><kbd>Clear Text</kbd><span class="svg-help-desc">Auto-deletes box when text is empty</span></div>
                                            <div class="svg-help-row"><kbd>Shift+Drag</kbd><span class="svg-help-desc">Move UI box</span></div>
                                            <div class="svg-help-row"><kbd>Alt+Drag</kbd><span class="svg-help-desc">Duplicate / clone UI box</span></div>
                                            <div class="svg-help-row"><kbd>Ctrl+Z / Y</kbd><span class="svg-help-desc">Undo & Redo</span></div>
                                            <div class="svg-help-row"><kbd>Dblclick / F2</kbd><span class="svg-help-desc">Quick edit text</span></div>
                                        {/if}
                                    </div>
                                </div>
                            {:else}
                                <button type="button" class="svg-plugin-download-btn" on:click={() => showPluginDownloadModal = true}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                    <span>{isChinese() ? "⚡ 想要编辑图片？安装/开启 SVG Quick Editor 插件" : "⚡ Want to edit? Get SVG Quick Editor Plugin"}</span>
                                </button>
                            {/if}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button type="button"
                                class="svg-lightbox-action-btn"
                                class:is-active={isAutoAlignActive}
                                on:click|stopPropagation={toggleAutoAlign}
                                title={isChinese() ? "拖动时在很小的范围内自动对齐上下左右" : "Snap to edges and centers while dragging"}>
                            Auto Align
                        </button>
                        {#if isSvgQuickEditorInstalled()}
                            <button type="button"
                                    class="svg-lightbox-action-btn"
                                    on:click|stopPropagation={applySmartLayout}
                                    title={isChinese() ? "智能排版：删除部分UI卡片后自动居中并均匀分布剩余卡片与间隙 (Ctrl+Z 可撤销)" : "Smart Layout: auto-center and balance remaining cards and gaps (Ctrl+Z to undo)"}>
                                {isChinese() ? "智能排版" : "Smart Layout"}
                            </button>
                        {/if}
                        {#if lightboxData.cleanPath}
                            <button type="button" class="svg-lightbox-action-btn" on:click|stopPropagation={() => lightboxData && openSvgInVault(lightboxData.cleanPath)} title="Open note/file in Obsidian">
                                Open in Tab
                            </button>
                            <button type="button"
                                    class="svg-lightbox-action-btn svg-lightbox-delete-btn"
                                    on:click|stopPropagation={promptDeleteSvgLightbox}
                                    title={isChinese() ? "删除此 SVG 图像及关联任务链接" : "Delete this SVG file and unlink from task"}>
                                {isChinese() ? "删除 SVG" : "Delete SVG"}
                            </button>
                        {/if}
                        <span class="svg-lightbox-close" on:click={requestCloseSvgLightbox}
                              role="button" tabindex="-1">✕</span>
                    </div>
                </div>
                <div class="svg-lightbox-body">
                    {#if lightboxData.isInline}
                        <div class="svg-lightbox-content"
                             data-a1-svg-path={lightboxData.cleanPath || undefined}
                             on:dblclick|stopPropagation={handleLightboxDblClick}>
                            {@html lightboxData.content}
                        </div>
                    {:else}
                        <img src={lightboxData.srcUrl} alt="Visual memory" class="svg-lightbox-img" />
                    {/if}
                </div>
            </div>
        </div>
    {/if}

    <!-- Save Confirmation Modal on Right-click/Close ("是否保存？") -->
    {#if showSvgSaveConfirmModal}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div use:portal class="svg-confirm-backdrop" on:click|self={cancelSvgSavePrompt} role="presentation">
            <div class="svg-confirm-modal" role="dialog" aria-modal="true" tabindex="-1">
                <div class="svg-confirm-title">{isChinese() ? "是否保存？" : "Save changes?"}</div>
                <div class="svg-confirm-desc">
                    {isChinese() ? "当前 SVG 图像已有改动，退出前是否保存更改？" : "The SVG image has been modified. Do you want to save changes before exiting?"}
                </div>
                <div class="svg-confirm-actions">
                    <button type="button" class="svg-btn svg-btn-primary" on:click={saveAndCloseSvgLightbox}>
                        {isChinese() ? "保存 (Enter)" : "Save (Enter)"}
                    </button>
                    <button type="button" class="svg-btn svg-btn-warning" on:click={discardAndCloseSvgLightbox}>
                        {isChinese() ? "不保存 / 放弃" : "Don't Save"}
                    </button>
                    <button type="button" class="svg-btn svg-btn-ghost" on:click={cancelSvgSavePrompt}>
                        {isChinese() ? "继续编辑 (Esc)" : "Keep Editing (Esc)"}
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- Delete Confirmation Modal ("是否删除？") -->
    {#if showSvgDeleteConfirmModal}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div use:portal class="svg-confirm-backdrop" on:click|self={() => showSvgDeleteConfirmModal = false} role="presentation">
            <div class="svg-confirm-modal" role="dialog" aria-modal="true" tabindex="-1">
                <div class="svg-confirm-title" style="color: var(--text-error, #f87171);">
                    Delete SVG?
                </div>
                <div class="svg-confirm-desc">
                    Are you sure you want to permanently delete this SVG file?
                    {#if lightboxData?.cleanPath}
                        <br><code style="font-size: 11.5px; opacity: 0.85; word-break: break-all;">{lightboxData.cleanPath}</code>
                    {/if}
                    <div style="margin-top: 8px;">
                        {#if svgLinkedTaskCount > 0}
                            <span style="color: var(--text-warning, #f59e0b);">
                                This file is linked to {svgLinkedTaskCount === 1 ? '1 task' : `${svgLinkedTaskCount} tasks`}{#if svgLinkedTaskTitles[0]} ("{svgLinkedTaskTitles[0].slice(0, 36)}{svgLinkedTaskTitles[0].length > 36 ? '...' : ''}"){/if}. Deleting it will also remove the link from the task{svgLinkedTaskCount > 1 ? 's' : ''}.
                            </span>
                        {:else}
                            <span style="color: var(--text-muted, #9ca3af);">
                                This action cannot be undone.
                            </span>
                        {/if}
                    </div>
                </div>
                <div class="svg-confirm-actions">
                    <button type="button" class="svg-btn svg-btn-danger" on:click={confirmDeleteSvgFromLightbox}>
                        Delete (Enter)
                    </button>
                    <button type="button" class="svg-btn svg-btn-ghost" on:click={() => showSvgDeleteConfirmModal = false}>
                        Cancel (Esc)
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- Companion Plugin Downloader Guide Modal ("获取 A1 SVG Quick Editor 插件") -->
    {#if showPluginDownloadModal}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div use:portal class="svg-confirm-backdrop" on:click|self={() => showPluginDownloadModal = false} role="presentation">
            <div class="svg-confirm-modal" role="dialog" aria-modal="true" tabindex="-1" style="max-width: 480px;">
                <div class="svg-confirm-title" style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent, #7c9cff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="16" x2="12" y2="12"/>
                        <line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                    <span>{isChinese() ? "获取 SVG Quick Editor 配套插件" : "Get SVG Quick Editor Companion"}</span>
                </div>
                <div class="svg-confirm-desc" style="line-height: 1.6; font-size: 13px; color: var(--text-muted, #9ca3af); margin-top: 8px;">
                    {#if isChinese()}
                        Fluent Tasks 专注轻量纯净展示。若需开启<b>Ctrl+S 即时保存</b>、<b>清空删框</b>、<b>Shift+拖拽移动UI框</b>、<b>Alt+拖拽克隆UI框</b>与 <b>Ctrl+Z/Y 撤销重做</b>等高级交互功能，请安装或启用配套插件 <b>SVG Quick Editor</b>。
                    {:else}
                        Fluent Tasks focuses on pure visual presentation. To unlock <b>Ctrl+S in-place save</b>, <b>empty-text box removal</b>, <b>Shift+drag card move</b>, <b>Alt+drag card duplication</b>, and <b>Ctrl+Z/Y undo/redo</b>, please install or enable the companion plugin <b>SVG Quick Editor</b>。
                    {/if}
                </div>
                <div class="svg-download-actions" style="display: flex; flex-direction: column; gap: 10px; margin-top: 18px;">
                    <!-- 1. 打开社区插件设置并搜索 -->
                    <button type="button" class="svg-btn svg-btn-primary" on:click={openObsidianPluginSettings} style="display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 14px;">
                        <span>⚙️</span>
                        <span>{isChinese() ? "打开插件设置并搜索下载" : "Open Settings & Search Plugin"}</span>
                    </button>
                    <div style="display: flex; gap: 10px;">
                        <!-- 2. GitHub 网页跳转 -->
                        <button type="button" class="svg-btn svg-btn-ghost" on:click={openPluginGithub} style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 10px;">
                            <span>🌐</span>
                            <span>{isChinese() ? "GitHub 网页跳转" : "GitHub Page"}</span>
                        </button>
                        <!-- 3. 复制插件名称 -->
                        <button type="button" class="svg-btn svg-btn-ghost" on:click={copyPluginName} style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 10px;">
                            <span>{nameCopiedHint ? "✅" : "📋"}</span>
                            <span>{nameCopiedHint ? (isChinese() ? "已复制！" : "Copied!") : (isChinese() ? "复制插件名称" : "Copy Name")}</span>
                        </button>
                    </div>
                </div>

                {#if nameCopiedHint}
                    <div class="svg-copy-embedded-hint" style="display: flex; align-items: center; gap: 8px; margin-top: 14px; padding: 10px 14px; border-radius: 8px; background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.35); color: #4ade80; font-size: 12.5px; line-height: 1.45;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <span>
                            {isChinese()
                                ? "插件名称已复制，到插件市场（社区插件）粘贴搜索下载即可。"
                                : "Plugin name copied! Open Settings -> Community Plugins to search & install."}
                        </span>
                    </div>
                {/if}

                <div style="margin-top: 16px; text-align: right;">
                    <button type="button" class="svg-btn svg-btn-ghost" on:click={() => { showPluginDownloadModal = false; nameCopiedHint = false; }}>
                        {isChinese() ? "知道了 (Esc)" : "Close (Esc)"}
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- Features & Shortcuts Guide Modal (Portaled to document.body) -->
    {#if showHintsModal}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div use:portal
             class="meta-modal-backdrop" on:click={(e) => e.target === e.currentTarget && (showHintsModal = false)} role="presentation">
            <div class="meta-modal-dialog guide-modal-dialog" role="dialog" aria-modal="true" tabindex="-1">
                <div class="meta-modal-header">
                    <div class="meta-modal-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--todo-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <span>Fluent Tasks Features & Shortcut Guide</span>
                    </div>
                    <span class="meta-modal-close" on:click={() => showHintsModal = false}
                          role="button" tabindex="0">✕</span>
                </div>
                <div class="meta-modal-body guide-modal-body">
                    <!-- 1. Shortcuts -->
                    <div class="guide-section">
                        <div class="guide-section-title">⚡ Interaction Shortcuts</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Quick List Modal</span> Full-Screen Board Navigation</div>
                                <div class="guide-card-body">Press hotkey (or Command Palette) to summon the 100% full-screen dashboard board. Features auto-wrapping vertical columns, horizontal mouse-wheel panning, dynamic gap expansion & centering, and intuitive 2D arrow navigation (← ↑ → ↓ / Enter / F2).</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Detail View Mode</span> Floating Detail Modal</div>
                                <div class="guide-card-body">Toggle in Settings to inspect and edit task details in an elegant centered floating modal instead of expanding the right sidebar panel. Supports stacked two-tier metadata modals and Esc dismissal without disturbing your workspace.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Quick Task Modal</span> Dual-Pane Popup Manager</div>
                                <div class="guide-card-body">Summon the 92vw × 86vh floating task popup for lightning-fast task management with full keyboard navigation (↑↓←→, Space, Ctrl+N, Ctrl+Enter) and inline checklist triage.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Ctrl + Hover</span> Task Title Quick Peek</div>
                                <div class="guide-card-body">Hover over any task title while pressing <kbd>Ctrl</kbd> (or <kbd>Cmd</kbd> on macOS) to instantly pop up full title, subtasks checklist, notes, and due dates without opening the detail view.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Direct Hover</span> Meta Badges</div>
                                <div class="guide-card-body">Hovering over <span class="why-badge">?</span>, <span class="note-badge">📄</span>, <span class="svg-badge">🖼️</span>, or <span class="custom-badge">🏷️</span> instantly previews rationale, notes, SVGs, or custom properties with zero modifier keys.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Click Steps</span> Big Subtasks Floating Editor</div>
                                <div class="guide-card-body">Click any subtask badge (or the hover preview card) to open the spacious floating editor with large typography. Easily check off, edit multiline text, delete, or add steps with instant auto-save without opening the right task detail panel.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Right Click</span> Instant Dismiss & Context Actions</div>
                                <div class="guide-card-body">Right-click anywhere to immediately dismiss any open hover popover or full-screen SVG Lightbox. Right-click tasks to open move/delete context menus.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header"><span class="guide-badge-pill">Alt + Left / Right</span> List History Navigation</div>
                                <div class="guide-card-body">Quickly jump back and forward across previously visited lists using <kbd>Alt</kbd> + <kbd>←</kbd> / <kbd>→</kbd>, Alt + mouse left/right click, or mouse side buttons.</div>
                            </div>
                        </div>
                    </div>

                    <!-- 2. Drag & Drop -->
                    <div class="guide-section">
                        <div class="guide-section-title">🎯 Physics Drag & Drop System</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header">↕️ In-List Task Reordering</div>
                                <div class="guide-card-body">Grab and drag tasks up and down to reorder priorities with physics animations and uniform auto-scrolling when approaching the top or bottom edges.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">🔀 Cross-Pane Drag to Sidebar Lists</div>
                                <div class="guide-card-body">Drag any task from the center task list directly across onto any list or group in the left sidebar to transfer it instantly to that category.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">📁 Sidebar List & Group Hierarchy</div>
                                <div class="guide-card-body">Drag lists into groups to nest them, reorder groups in the sidebar, or pull nested lists back out to the root level.</div>
                            </div>
                        </div>
                    </div>

                    <!-- 3. Organization & Metadata -->
                    <div class="guide-section">
                        <div class="guide-section-title">📂 Organization & Metadata System</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header">❓ Why / Causal Methodology</div>
                                <div class="guide-card-body">Attach development instructions, rationales, or agent methodologies to tasks. Displayed as a clean <span class="why-badge">?</span> badge with rich hover popover.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">🔗 Dedicated Linked Notes & Title Hot-Sync</div>
                                <div class="guide-card-body">Click the dedicated Link Note button in the detail panel header to auto-create and open a dedicated note under <code>TodoData/&lt;ListName&gt;/</code>. Hard-bound notes feature a distinctive chain badge and bidirectional title hot-sync (renaming either task or note automatically updates the other with collision protection). Deleting prompts a confirmation modal to safely trash the note or retain it.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">🖼️ Visual Memory SVGs & Lightbox</div>
                                <div class="guide-card-body">Attach vault SVG diagrams or inline icons. Hover for 280px preview, click for full-screen zoom lightbox with one-click "Open in Tab" navigation.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">➕ Custom Metadata Manager</div>
                                <div class="guide-card-body">Click the <code>+</code> button next to Time at the bottom of the right detail view to add/manage custom properties, Why rationale, and linked notes.</div>
                            </div>
                        </div>
                    </div>

                    <!-- 4. Scheduling & Recurrence -->
                    <div class="guide-section">
                        <div class="guide-section-title">🔁 Recurring Tasks & Smart Due Dates</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header">🔁 Repeating Task Rules</div>
                                <div class="guide-card-body">Set tasks to repeat Daily, Weekdays (Mon–Fri), Weekly on chosen days, or Custom day/week intervals. Checking off a recurring task automatically advances to the next occurrence.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">📅 Due Dates & Overdue Badges</div>
                                <div class="guide-card-body">Set due dates with smart color-coded badges (<code>Due Today</code>, <code>Overdue</code>, <code>Repeats</code>) displayed directly in task rows and quick peeks.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">⭐ Priority Starring & Completed Toggle</div>
                                <div class="guide-card-body">Star priority tasks to keep them prominent. Collapse or expand completed tasks with a clean accordion toggle.</div>
                            </div>
                        </div>
                    </div>

                    <!-- 5. Search & Data Privacy -->
                    <div class="guide-section">
                        <div class="guide-section-title">🔍 Search & 100% Local Markdown Ownership</div>
                        <div class="guide-grid">
                            <div class="guide-card">
                                <div class="guide-card-header">🔍 Instant Global Search</div>
                                <div class="guide-card-body">Click <code>🔍</code> in the category header or trigger Search Modal anytime to search through tasks across all lists in milliseconds.</div>
                            </div>
                            <div class="guide-card">
                                <div class="guide-card-header">🔒 100% Local Open Markdown Data</div>
                                <div class="guide-card-body">All tasks are saved directly in your vault under <code>TodoData/*.md</code> as standard checklists with discrete JSON comments. Zero proprietary lock-in.</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="meta-modal-footer">
                    <button type="button" class="meta-btn-primary" on:click={() => showHintsModal = false}>Got it!</button>
                </div>
            </div>
        </div>
    {/if}
</div>
