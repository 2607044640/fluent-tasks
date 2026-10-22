<script lang="ts">
    import { onMount } from "svelte";
    import type { App } from "obsidian";
    import {
        resolveImageResourceUrl,
        copyImageToClipboard,
        getImageBaseName,
    } from "../utils/imageAttachmentUtils";
    import { t } from "../lang/helpers";

    export let app: App;
    export let imageRef: string;
    export let onCut: (() => void) | undefined = undefined;
    export let onDelete: (() => void) | undefined = undefined;
    export let closeModal: () => void;

    $: resolvedSrc = resolveImageResourceUrl(imageRef, app);
    $: fileName = getImageBaseName(imageRef);

    let isZoomed: boolean = false;

    function toggleZoom() {
        isZoomed = !isZoomed;
    }

    async function handleCopy() {
        await copyImageToClipboard(imageRef, app, t("image_copied") || "Image copied to clipboard / 图片已复制到剪贴板");
    }

    async function handleCut() {
        await copyImageToClipboard(imageRef, app, t("image_cut") || "Image cut to clipboard / 图片已剪切至剪贴板");
        if (onCut) {
            onCut();
        } else if (onDelete) {
            onDelete();
        }
        closeModal();
    }

    function handleDelete() {
        if (onDelete) {
            onDelete();
        }
        closeModal();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
            if (e.key === "c" || e.key === "C") {
                e.preventDefault();
                e.stopPropagation();
                void handleCopy();
                return;
            }
            if (e.key === "x" || e.key === "X") {
                e.preventDefault();
                e.stopPropagation();
                void handleCut();
                return;
            }
        }

        if (e.key === "Delete" && !e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            handleDelete();
            return;
        }
    }

    onMount(() => {
        window.addEventListener("keydown", handleKeydown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleKeydown, { capture: true });
        };
    });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="task-img-preview-backdrop" on:click={closeModal}>
    <div class="task-img-preview-card" data-no-toolkit="true" on:click|stopPropagation>
        <!-- Top Toolbar -->
        <div class="task-img-preview-header">
            <div class="task-img-preview-title" title={fileName}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span>{fileName}</span>
            </div>
            <div class="task-img-preview-actions">
                <button
                    type="button"
                    class="task-img-preview-btn"
                    title={t("image_copy_tooltip") || "Copy image (Ctrl+C) / 复制图片"}
                    on:click={handleCopy}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    <span>{t("copy") || "Copy"}</span>
                </button>
                <button
                    type="button"
                    class="task-img-preview-btn is-cut"
                    title={t("image_cut_tooltip") || "Cut image (Ctrl+X) / 剪切图片"}
                    on:click={handleCut}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="6" cy="6" r="3"/>
                        <circle cx="6" cy="18" r="3"/>
                        <line x1="20" y1="4" x2="8.12" y2="15.88"/>
                        <line x1="14.47" y1="14.48" x2="20" y2="20"/>
                        <line x1="8.12" y1="8.12" x2="12" y2="12"/>
                    </svg>
                    <span>{t("cut") || "Cut"}</span>
                </button>
                <button
                    type="button"
                    class="task-img-preview-btn is-close"
                    title={t("close") || "Close (Esc) / 关闭"}
                    on:click={closeModal}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Main Image Container -->
        <div class="task-img-preview-body">
            {#if resolvedSrc}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
                <img
                    src={resolvedSrc}
                    alt={fileName}
                    class="task-img-preview-image"
                    class:is-zoomed={isZoomed}
                    data-no-toolkit="true"
                    on:click={toggleZoom}
                    title={isZoomed ? (t("image_zoom_out") || "Click to fit screen / 点击适应屏幕") : (t("image_zoom_in") || "Click to zoom 1:1 / 点击放大原图")}
                />
            {:else}
                <div class="task-img-preview-placeholder">Loading image...</div>
            {/if}
        </div>

        <!-- Footer keyboard helper badges -->
        <div class="task-img-preview-footer">
            <span class="task-img-preview-badge">
                <kbd>Click</kbd> {isZoomed ? (t("image_hint_fit") || "Fit / 适应屏幕") : (t("image_hint_zoom") || "Zoom 1:1 / 放大原图")}
            </span>
            <span class="task-img-preview-badge">
                <kbd>Ctrl+C</kbd> {t("image_hint_copy") || "Copy / 复制"}
            </span>
            <span class="task-img-preview-badge">
                <kbd>Ctrl+X</kbd> {t("image_hint_cut") || "Cut / 剪切"}
            </span>
            <span class="task-img-preview-badge">
                <kbd>Esc</kbd> {t("image_hint_close") || "Close / 关闭"}
            </span>
        </div>
    </div>
</div>

<style>
    .task-img-preview-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(4px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
        animation: fadeIn 0.15s ease-out;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    .task-img-preview-card {
        max-width: 92vw;
        max-height: 92vh;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 10px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .task-img-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 16px;
        background: var(--background-secondary);
        border-bottom: 1px solid var(--background-modifier-border);
        gap: 12px;
    }

    .task-img-preview-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-normal);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 60%;
    }

    .task-img-preview-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .task-img-preview-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        font-size: 12px;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .task-img-preview-btn:hover {
        background: var(--background-modifier-hover);
        border-color: var(--interactive-accent);
        color: var(--interactive-accent);
    }

    .task-img-preview-btn.is-cut:hover {
        border-color: var(--text-error, #e54d2e);
        color: var(--text-error, #e54d2e);
    }

    .task-img-preview-btn.is-close {
        padding: 4px 6px;
    }

    .task-img-preview-btn.is-close:hover {
        color: var(--text-error, #e54d2e);
    }

    .task-img-preview-body {
        flex: 1;
        display: flex;
        padding: 16px;
        overflow: auto;
        background: var(--background-primary-alt);
        min-height: 200px;
    }

    .task-img-preview-image {
        margin: auto;
        max-width: 86vw;
        max-height: 72vh;
        object-fit: contain;
        border-radius: 6px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
        user-select: none;
        cursor: zoom-in;
        transition: max-width 0.15s ease, max-height 0.15s ease;
    }

    .task-img-preview-image.is-zoomed {
        max-width: none;
        max-height: none;
        cursor: zoom-out;
    }

    .task-img-preview-placeholder {
        color: var(--text-muted);
        font-size: 13px;
    }

    .task-img-preview-footer {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 8px 16px;
        background: var(--background-secondary);
        border-top: 1px solid var(--background-modifier-border);
    }

    .task-img-preview-badge {
        font-size: 11px;
        color: var(--text-muted);
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .task-img-preview-badge kbd {
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        padding: 1px 4px;
        font-size: 10px;
        font-family: var(--font-monospace);
        color: var(--text-normal);
    }
</style>
