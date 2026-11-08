export type PopoverContentType = 'why' | 'svg' | 'custom' | 'title' | 'guide' | 'steps' | 'note';

export interface PopoverPosition {
    placement: 'top' | 'bottom';
    x: number;
    y: number;
    maxHeight: number;
    maxWidth: number;
}

/**
 * Calculates smart auto-flipping, screen-adaptive popover coordinates and dimension limits
 * based on the target element's bounding rect and current viewport geometry.
 */
export function calculatePopoverPosition(
    targetEl: HTMLElement,
    type: PopoverContentType
): PopoverPosition {
    const rect = targetEl.getBoundingClientRect();
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 800;

    // Safety margin from viewport edges
    const margin = 16;
    const spaceAbove = Math.max(0, rect.top - margin);
    const spaceBelow = Math.max(0, winH - rect.bottom - margin);

    // Dynamic viewport-adaptive max limits: never exceed 60% of viewport height (or 400px)
    const maxScreenHeight = Math.min(400, Math.floor(winH * 0.6));
    const maxWidth = Math.min(480, Math.floor(winW * 0.88), Math.max(240, winW - 32));

    // Determine placement: prefer the side that comfortably fits content (~240px)
    // or whichever side provides more room
    let placement: 'top' | 'bottom';
    let availableH: number;

    if (spaceAbove >= 240 && spaceAbove >= spaceBelow) {
        placement = 'top';
        availableH = spaceAbove;
    } else if (spaceBelow >= 240) {
        placement = 'bottom';
        availableH = spaceBelow;
    } else {
        if (spaceBelow >= spaceAbove) {
            placement = 'bottom';
            availableH = spaceBelow;
        } else {
            placement = 'top';
            availableH = spaceAbove;
        }
    }

    // maxHeight is strictly bounded to the available space minus 8px clearance,
    // guaranteeing that the popover will NEVER clip outside the top or bottom of the screen
    const maxHeight = Math.max(100, Math.min(availableH - 8, maxScreenHeight));

    // Clamp horizontal center so neither left nor right edge overflows viewport
    const halfWidth = maxWidth / 2;
    const centerX = rect.left + rect.width / 2;
    const x = Math.max(halfWidth + 12, Math.min(winW - halfWidth - 12, centerX));

    // Y position adjacent to target element
    const y = placement === 'top' ? (rect.top - 8) : (rect.bottom + 8);

    return { placement, x, y, maxHeight, maxWidth };
}
