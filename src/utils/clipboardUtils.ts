/**
 * clipboardUtils.ts
 * Cross-platform clipboard abstraction for modern browsers and Obsidian Electron desktop environments.
 */

/**
 * Copies the given text string to the system clipboard.
 * Tries `navigator.clipboard.writeText`, falls back to Electron's clipboard API,
 * and finally attempts `document.execCommand('copy')` as a last resort.
 *
 * @param text The plain text string to copy.
 * @returns Promise<boolean> indicating whether the copy operation succeeded.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    if (!text) return false;

    // 1. Modern Navigator Clipboard API
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Proceed to Electron fallback if navigator.clipboard fails (e.g. unfocused window / permission error)
        }
    }

    // 2. Obsidian Electron Native Process API
    try {
        const electron = typeof window !== "undefined" && typeof (window as any).require === "function"
            ? (window as any).require("electron")
            : undefined;
        if (electron?.clipboard?.writeText) {
            electron.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Fall through to document fallback
    }

    // 3. Fallback: Hidden Textarea DOM ExecCommand
    try {
        if (typeof document !== "undefined") {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.left = "-9999px";
            textarea.style.top = "-9999px";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const success = document.execCommand("copy");
            document.body.removeChild(textarea);
            if (success) return true;
        }
    } catch {
        // All options exhausted
    }

    return false;
}
