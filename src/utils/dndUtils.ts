/**
 * dndUtils.ts
 * Pure DOM utility functions for drag-and-drop mechanics.
 * Separated to adhere to the Single Responsibility Principle (SRP).
 */

/**
 * Synchronously kills the svelte-dnd-action ghost element.
 * This is used to prevent the library's fly-back animation when we want to
 * consume a cross-pane drop visually without flicker.
 */
export function killDndGhostElement(): void {
    const ghost = document.getElementById('dnd-action-dragged-el');
    if (ghost) {
        ghost.setCssStyles({
            display: 'none',
            opacity: '0',
            transition: 'none',
            transform: 'none'
        });
    }
}

/**
 * Injects a global CSS shield to permanently hide the dragged ghost and 
 * stop all CSS transitions momentarily (anti-flicker).
 */
export function injectDndGhostShield(): void {
    document.body.classList.add('is-dragging-ghost');
}

/**
 * Removes the global CSS shield added by injectDndGhostShield().
 */
export function removeDndGhostShield(): void {
    document.body.classList.remove('is-dragging-ghost');
}
