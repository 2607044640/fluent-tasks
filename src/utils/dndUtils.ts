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

const AUTO_SCROLL_EDGE_ZONE = 60;
const AUTO_SCROLL_MAX_SPEED = 12;
const AUTO_SCROLL_MIN_SPEED = 2;

export function createVerticalAutoScroll(getContainer: () => HTMLElement | null) {
    let scrollAnimId: number | null = null;
    let scrollSpeed = 0;
    let isDndActive = false;

    function startAutoScroll() {
        if (scrollAnimId !== null) return;
        const step = () => {
            const container = getContainer();
            if (!container || scrollSpeed === 0) {
                scrollAnimId = null;
                return;
            }
            container.scrollTop += scrollSpeed;
            scrollAnimId = requestAnimationFrame(step);
        };
        scrollAnimId = requestAnimationFrame(step);
    }

    function stopAutoScroll() {
        if (scrollAnimId !== null) {
            cancelAnimationFrame(scrollAnimId);
            scrollAnimId = null;
        }
        scrollSpeed = 0;
    }

    function updateAutoScroll(clientY: number) {
        const container = getContainer();
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (clientY < rect.top + AUTO_SCROLL_EDGE_ZONE && container.scrollTop > 0) {
            const proximity = 1 - ((clientY - rect.top) / AUTO_SCROLL_EDGE_ZONE);
            scrollSpeed = -Math.max(AUTO_SCROLL_MIN_SPEED, Math.round(proximity * AUTO_SCROLL_MAX_SPEED));
            startAutoScroll();
        } else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_ZONE) {
            const proximity = 1 - ((rect.bottom - clientY) / AUTO_SCROLL_EDGE_ZONE);
            scrollSpeed = Math.max(AUTO_SCROLL_MIN_SPEED, Math.round(proximity * AUTO_SCROLL_MAX_SPEED));
            startAutoScroll();
        } else {
            stopAutoScroll();
        }
    }

    return {
        setActive(active: boolean) {
            isDndActive = active;
            if (!active) stopAutoScroll();
        },
        onPointerMove(e: PointerEvent) {
            if (!isDndActive) return;
            updateAutoScroll(e.clientY);
        },
        stop() {
            isDndActive = false;
            stopAutoScroll();
        },
    };
}
