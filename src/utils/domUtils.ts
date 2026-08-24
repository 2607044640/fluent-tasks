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
 * Svelte Action: Automatically resize a textarea height to match its scrollHeight.
 * Ensures multi-line text wraps and displays completely without vertical scrollbars.
 */
export function autosize(node: HTMLTextAreaElement) {
    function resize() {
        node.setCssStyles({ height: "auto" });
        node.setCssStyles({ height: `${node.scrollHeight}px` });
    }
    node.addEventListener("input", resize);
    requestAnimationFrame(resize);

    return {
        update() {
            resize();
        },
        destroy() {
            node.removeEventListener("input", resize);
        }
    };
}
