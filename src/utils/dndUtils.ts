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
        ghost.style.display = 'none';
        ghost.style.opacity = '0';
        ghost.style.transition = 'none';
        ghost.style.transform = 'none';
    }
}

/**
 * Injects a global CSS shield to permanently hide the dragged ghost and 
 * stop all CSS transitions momentarily (anti-flicker).
 */
export function injectDndGhostShield(): void {
    if (document.getElementById('mstodo-dnd-kill')) return;
    
    const style = document.createElement("style");
    style.id = 'mstodo-dnd-kill';
    style.textContent = [
        "#dnd-action-dragged-el { display: none !important; opacity: 0 !important; transition: none !important; transform: none !important; }",
        "* { transition: none !important; }",
    ].join("\n");
    document.head.appendChild(style);
}

/**
 * Removes the global CSS shield added by injectDndGhostShield().
 */
export function removeDndGhostShield(): void {
    const style = document.getElementById('mstodo-dnd-kill');
    if (style) {
        style.remove();
    }
}
