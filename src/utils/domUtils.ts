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
