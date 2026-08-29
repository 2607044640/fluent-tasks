/**
 * domUtils.ts
 * Shared DOM utilities and Svelte actions.
 */

/**
 * Svelte Action: Portal a DOM node directly to document.body.
 * Ensures the element escapes any parent overflow clipping or stacking context.
 */
export function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
        destroy() {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        }
    };
}

/**
 * Svelte Action: Bulletproof auto-resizing for textareas.
 * Uses native field-sizing where supported, with robust scrollHeight calculation
 * and scrollTop zeroing to eliminate cursor jumping, top-line clipping, and residual height.
 */
export function autosize(node: HTMLTextAreaElement, _value?: string) {
    const supportsFieldSizing = typeof CSS !== "undefined" && CSS.supports && CSS.supports("field-sizing", "content");

    function resize() {
        node.scrollTop = 0;
        if (supportsFieldSizing) {
            // Native Chromium field-sizing dynamically computes content height without layout shifts
            // Reset inline height to auto so field-sizing: content can shrink/grow natively on value updates
            node.setCssStyles({
                boxSizing: "border-box",
                height: "auto",
                minHeight: "0px",
            });
            node.scrollTop = 0;
            return;
        }

        // Fallback for environments without CSS field-sizing: content
        node.setCssStyles({
            boxSizing: "border-box",
            height: "auto",
            minHeight: "0px",
        });
        const targetHeight = node.scrollHeight;
        if (targetHeight > 0) {
            node.setCssStyles({
                height: `${targetHeight}px`
            });
        }
        node.scrollTop = 0;
    }

    node.addEventListener("input", resize);
    node.addEventListener("focus", resize);
    requestAnimationFrame(resize);

    return {
        update(_newValue?: string) {
            requestAnimationFrame(resize);
        },
        destroy() {
            node.removeEventListener("input", resize);
            node.removeEventListener("focus", resize);
        }
    };
}
