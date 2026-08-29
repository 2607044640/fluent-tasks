export type PopoverContentType = 'why' | 'svg' | 'custom' | 'title' | 'guide' | 'steps';

export interface PopoverPosition {
    placement: 'top' | 'bottom';
    x: number;
    y: number;
}

/**
 * Calculates smart auto-flipping popover coordinates (X, Y, placement)
 * based on target element bounding rect and estimated content size.
 */
export function calculatePopoverPosition(
    targetEl: HTMLElement,
    type: PopoverContentType
): PopoverPosition {
    const rect = targetEl.getBoundingClientRect();

    const estimatedHeight = type === 'svg' ? 320 : type === 'guide' ? 280 : type === 'title' ? 240 : type === 'steps' ? 200 : type === 'custom' ? 180 : 140;
    const estimatedHalfWidth = type === 'svg' ? 150 : type === 'guide' ? 170 : type === 'title' ? 170 : type === 'steps' ? 150 : 140;

    const fitsAbove = rect.top >= estimatedHeight + 24;
    const placement: 'top' | 'bottom' = fitsAbove ? 'top' : 'bottom';

    const centerX = rect.left + rect.width / 2;
    const x = Math.max(estimatedHalfWidth + 16, Math.min(window.innerWidth - estimatedHalfWidth - 16, centerX));
    const y = fitsAbove ? (rect.top - 8) : (rect.bottom + 8);

    return { placement, x, y };
}
