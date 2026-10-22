<script lang="ts">
    import { onDestroy } from "svelte";
    import type { App } from "obsidian";
    import {
        resolveImageResourceUrl,
        getImageBaseName,
    } from "../utils/imageAttachmentUtils";
    import { ImagePreviewModal } from "../modals/ImagePreviewModal";
    import { t } from "../lang/helpers";

    export let app: App;
    export let imageRef: string;
    export let onDelete: (() => void) | undefined = undefined;
    export let onCut: (() => void) | undefined = undefined;
    export let onHover: ((isHovered: boolean) => void) | undefined = undefined;
    export let onClick: (() => void) | undefined = undefined;
    export let size: number = 44;
    export let canDelete: boolean = true;

    $: resolvedSrc = resolveImageResourceUrl(imageRef, app);
    $: fileName = getImageBaseName(imageRef);

    function handleClick() {
        if (onClick) {
            onClick();
            return;
        }
        const effectiveApp = app || (window as any).app;
        if (!effectiveApp) {
            console.error("[fluent-tasks] Cannot open image preview modal: app instance missing");
            return;
        }
        new ImagePreviewModal(effectiveApp, imageRef, {
            onCut,
            onDelete,
        }).open();
    }

    function handleMouseEnter() {
        if (onHover) onHover(true);
    }

    function handleMouseLeave() {
        if (onHover) onHover(false);
    }

    function handleDelete(e: MouseEvent) {
        e.stopPropagation();
        e.preventDefault();
        if (onHover) onHover(false);
        if (onDelete) {
            onDelete();
        }
    }

    onDestroy(() => {
        if (onHover) onHover(false);
    });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="task-image-thumbnail-container"
    data-no-toolkit="true"
    style="width: {size}px; height: {size}px; min-width: {size}px; min-height: {size}px;"
    role="button"
    tabindex="0"
    title={t("image_tooltip") || "Click to preview • Hover + Ctrl+C to copy • Hover + Ctrl+X to cut / 点击查看 • 悬浮 Ctrl+C 复制 • 悬浮 Ctrl+X 剪切"}
    on:click|stopPropagation={handleClick}
    on:mouseenter={handleMouseEnter}
    on:mouseleave={handleMouseLeave}
>
    {#if resolvedSrc}
        <div
            class="task-image-thumbnail-img"
            style="background-image: url('{resolvedSrc}');"
            role="img"
            aria-label={fileName}
        ></div>
    {:else}
        <div class="task-image-thumbnail-empty">🖼️</div>
    {/if}

    {#if canDelete && onDelete}
        <button
            type="button"
            class="task-image-thumb-delete-btn"
            title={t("image_delete_tooltip") || "Remove image (Ctrl+X) / 移除图片"}
            on:click={handleDelete}
        >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    {/if}
</div>

<style>
    .task-image-thumbnail-container {
        position: relative;
        border-radius: 8px;
        overflow: hidden;
        background-color: var(--background-secondary-alt);
        border: 1px solid var(--background-modifier-border);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
        box-sizing: border-box;
        flex-shrink: 0;
        user-select: none;
    }

    .task-image-thumbnail-container:hover {
        border-color: var(--interactive-accent);
        box-shadow: 0 0 0 1px var(--interactive-accent), 0 2px 8px rgba(0, 0, 0, 0.25);
        transform: translateY(-1px);
    }

    .task-image-thumbnail-img {
        width: 100%;
        height: 100%;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        display: block;
        user-select: none;
        -webkit-user-drag: none;
        border-radius: 6px;
    }

    .task-image-thumbnail-empty {
        font-size: 14px;
        opacity: 0.6;
    }

    .task-image-thumb-delete-btn {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.68);
        color: #ffffff;
        border: none;
        padding: 0;
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background-color 0.15s ease, transform 0.1s ease;
        z-index: 2;
    }

    .task-image-thumbnail-container:hover .task-image-thumb-delete-btn {
        display: flex;
    }

    .task-image-thumb-delete-btn:hover {
        background: var(--text-error, #e54d2e);
        transform: scale(1.15);
    }
</style>
