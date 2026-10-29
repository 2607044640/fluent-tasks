<script lang="ts">
    interface HistoryToast {
        id: string;
        type: "undo" | "redo";
        title: string;
        message: string;
        isEmpty?: boolean;
    }

    let toasts: HistoryToast[] = [];

    export function showToast(params: { type: "undo" | "redo"; title: string; message: string; isEmpty?: boolean }) {
        const id = `ht-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const toast: HistoryToast = {
            id,
            type: params.type,
            title: params.title,
            message: params.message,
            isEmpty: params.isEmpty,
        };

        // Keep at most 2 active toasts to prevent stacking bloat
        toasts = [...toasts.slice(-1), toast];

        setTimeout(() => {
            toasts = toasts.filter(t => t.id !== id);
        }, 2800);
    }
</script>

{#if toasts.length > 0}
    <div class="fluent-tasks-history-container" role="status" aria-live="polite">
        {#each toasts as toast (toast.id)}
            <div class="fluent-tasks-history-toast" class:is-empty={toast.isEmpty} class:is-redo={toast.type === 'redo'}>
                <div class="history-toast-icon-wrap">
                    {#if toast.type === "undo"}
                        <!-- Undo Icon (curved arrow counterclockwise) -->
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 7v6h6" />
                            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                        </svg>
                    {:else}
                        <!-- Redo Icon (curved arrow clockwise) -->
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 7v6h-6" />
                            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
                        </svg>
                    {/if}
                </div>
                <div class="history-toast-content">
                    <div class="history-toast-header">
                        <span class="history-toast-type">{toast.title}</span>
                    </div>
                    <div class="history-toast-message" title={toast.message}>
                        {toast.message}
                    </div>
                </div>
            </div>
        {/each}
    </div>
{/if}
