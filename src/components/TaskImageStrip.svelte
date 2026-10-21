<script lang="ts">
    import type { App } from "obsidian";
    import TaskImageThumbnail from "./TaskImageThumbnail.svelte";

    export let app: App;
    export let images: string[] = [];
    export let size: number = 38;
    export let canDelete: boolean = true;
    export let showDivider: boolean = true;
    export let onDelete: ((imgRef: string) => void) | undefined = undefined;
    export let onCut: ((imgRef: string) => void) | undefined = undefined;
    export let onHover: ((imgRef: string, isHovered: boolean) => void) | undefined = undefined;
    export let onClick: ((imgRef: string) => void) | undefined = undefined;
</script>

{#if images && images.length > 0}
    <div class="task-image-strip-wrapper">
        <div class="task-image-strip-row">
            {#each images as imgRef (imgRef)}
                <TaskImageThumbnail
                    imageRef={imgRef}
                    {app}
                    {size}
                    {canDelete}
                    onDelete={() => onDelete && onDelete(imgRef)}
                    onCut={() => onCut && onCut(imgRef)}
                    onHover={(isHovered) => onHover && onHover(imgRef, isHovered)}
                    onClick={() => onClick && onClick(imgRef)}
                />
            {/each}
        </div>
        {#if showDivider}
            <div class="task-image-strip-divider"></div>
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

    .task-image-strip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
    }

    .task-image-strip-divider {
        height: 1px;
        width: 100%;
        background-color: var(--background-modifier-border, rgba(255, 255, 255, 0.12));
        margin-top: 8px;
        margin-bottom: 6px;
        opacity: 0.85;
    }
</style>
