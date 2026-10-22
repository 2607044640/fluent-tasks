/**
 * domUtils.ts
 * Shared DOM utilities and Svelte actions.
 */

/**
 * Svelte Action: Portal a DOM node directly to document.body (or parent modal container).
 * Ensures the element escapes any parent overflow clipping or stacking context, while
 * keeping it within any active modal scope to prevent focus trap hijacking.
 */
export function portal(node: HTMLElement, target?: HTMLElement | string) {
    let dest: HTMLElement | null = null;
    if (target instanceof HTMLElement) {
        dest = target;
    } else if (typeof target === "string") {
        dest = document.querySelector(target);
    }

    if (!dest) {
        // If node originates inside an Obsidian Modal, portal to that modal's modal element (modalEl)
        // so it remains within Obsidian's modal DOM tree and focus trap scope.
        const modalEl = (node.closest(".modal") || document.querySelector(".modal.task-detail-floating-modal")) as HTMLElement | null;
        if (modalEl) {
            dest = modalEl;
        } else {
            dest = document.body;
        }
    }

    dest.appendChild(node);
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
 * Dual-engine: applies native field-sizing: content when supported, but ALWAYS
 * enforces a scrollHeight fail-safe check to guarantee multiline text is never
 * clipped or squished into a single line.
 */
export function autosize(node: HTMLTextAreaElement, _value?: string) {
    const supportsFieldSizing = typeof CSS !== "undefined" && CSS.supports && CSS.supports("field-sizing", "content");

    if (supportsFieldSizing) {
        node.addClass("autosize-field-sizing");
    }

    function resize() {
        node.scrollTop = 0;

        // Reset to auto so both field-sizing and scrollHeight can measure natural content height
        node.setCssStyles({
            boxSizing: "border-box",
            height: "auto",
            minHeight: "0px",
        });

        const targetHeight = node.scrollHeight;
        if (targetHeight > 0) {
            // Fail-safe guarantee: if field-sizing didn't expand the element (e.g. missing CSS rule,
            // modal animation layout delay, font metric race), or if field-sizing is unsupported:
            if (!supportsFieldSizing || targetHeight > node.clientHeight + 1) {
                node.setCssStyles({
                    height: `${targetHeight}px`
                });
            }
        }
        node.scrollTop = 0;
    }

    node.addEventListener("input", resize);
    node.addEventListener("focus", resize);
    window.addEventListener("resize", resize);

    // Initial resize passes (synchronous + rAF + microtask + delayed for modal layout reflow)
    resize();
    window.requestAnimationFrame(resize);
    window.setTimeout(resize, 0);
    window.setTimeout(resize, 50);
    window.setTimeout(resize, 150);

    return {
        update(_newValue?: string) {
            resize();
            window.requestAnimationFrame(resize);
            window.setTimeout(resize, 0);
        },
        destroy() {
            node.removeEventListener("input", resize);
            node.removeEventListener("focus", resize);
            window.removeEventListener("resize", resize);
        }
    };
}

export interface LongPressOptions {
    duration?: number;
    onLongPress: () => void | Promise<void>;
    onClick?: () => void | Promise<void>;
}

/**
 * Svelte Action: handles normal click vs long press (default 1.5s).
 * If held for >= duration ms, triggers onLongPress() and suppresses click.
 * If released before duration, triggers onClick().
 */
export function longPress(node: HTMLElement, options: LongPressOptions) {
    let duration = options.duration ?? 1500;
    let onLongPress = options.onLongPress;
    let onClick = options.onClick;
    let timer: number | null = null;
    let isLongPressTriggered = false;
    let startX = 0;
    let startY = 0;

    function handlePointerDown(e: PointerEvent) {
        if (e.button !== 0) return;
        isLongPressTriggered = false;
        startX = e.clientX;
        startY = e.clientY;
        node.classList.add("is-pressing");

        timer = window.setTimeout(async () => {
            isLongPressTriggered = true;
            node.classList.remove("is-pressing");
            node.classList.add("long-pressed");
            window.setTimeout(() => node.classList.remove("long-pressed"), 300);
            try {
                await onLongPress();
            } catch (err) {
                console.error("longPress error:", err);
            }
        }, duration);
    }

    function cancelTimer() {
        if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
        }
        node.classList.remove("is-pressing");
    }

    function handlePointerMove(e: PointerEvent) {
        if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
            cancelTimer();
        }
    }

    function handlePointerUp(e: PointerEvent) {
        cancelTimer();
        if (isLongPressTriggered) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (onClick) {
            e.stopPropagation();
            void onClick();
        }
    }

    function handlePointerCancel() {
        cancelTimer();
    }

    node.addEventListener("pointerdown", handlePointerDown);
    node.addEventListener("pointermove", handlePointerMove);
    node.addEventListener("pointerup", handlePointerUp);
    node.addEventListener("pointercancel", handlePointerCancel);
    node.addEventListener("pointerleave", handlePointerCancel);

    return {
        update(newOptions: LongPressOptions) {
            duration = newOptions.duration ?? 1500;
            onLongPress = newOptions.onLongPress;
            onClick = newOptions.onClick;
        },
        destroy() {
            cancelTimer();
            node.removeEventListener("pointerdown", handlePointerDown);
            node.removeEventListener("pointermove", handlePointerMove);
            node.removeEventListener("pointerup", handlePointerUp);
            node.removeEventListener("pointercancel", handlePointerCancel);
            node.removeEventListener("pointerleave", handlePointerCancel);
        }
    };
}

