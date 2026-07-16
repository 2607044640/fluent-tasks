/**
 * constants.ts
 * All magic numbers and shared timing constants for the plugin.
 * Import from here instead of using raw literals.
 */

// Delay before focusing a newly created input element after DOM update
export const INPUT_FOCUS_DELAY_MS = 50;

// Delay to allow click events to fire before a blur handler cancels the input
export const BLUR_CONFIRM_DELAY_MS = 150;

// Delay before removing the DND CSS shield (allows svelte-dnd to fully settle)
export const DND_SHIELD_REMOVAL_DELAY_MS = 500;

// Delay before re-syncing task list from disk after a cross-pane move
export const DISK_SYNC_DELAY_MS = 800;

// Duration of the inline anti-flicker style block for context menu moves
export const ANTI_FLICKER_DURATION_MS = 250;

// Debounce delay for auto-saving task edits in the detail panel
export const SAVE_DEBOUNCE_MS = 600;

// Delay before dispatching rescue pointerup event for frozen DND state
export const DND_RESCUE_DELAY_MS = 50;
