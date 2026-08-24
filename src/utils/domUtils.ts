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
 * and scrollTop zeroing to eliminate cursor jumping and top-line clipping.
 */
export function autosize(node: HTMLTextAreaElement) {
    function resize() {
        node.scrollTop = 0;
        node.setCssStyles({
            boxSizing: "border-box",
            height: "auto",
            minHeight: "0px",
        });
        const targetHeight = Math.max(node.scrollHeight, 24);
        node.setCssStyles({
            height: `${targetHeight}px`
        });
        node.scrollTop = 0;
    }

    node.addEventListener("input", resize);
    node.addEventListener("focus", resize);
    requestAnimationFrame(resize);

    return {
        update() {
            requestAnimationFrame(resize);
        },
        destroy() {
            node.removeEventListener("input", resize);
            node.removeEventListener("focus", resize);
        }
    };
}
