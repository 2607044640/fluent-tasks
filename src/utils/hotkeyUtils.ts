import type { App } from "obsidian";
import type FluentTasksPlugin from "../main";

export const MAX_TIP_COUNT = 5;

export interface HotkeyTipInfo {
    showTip: boolean;
    remainingTips: number;
}

/**
 * Checks if the user already has a custom hotkey assigned to the given command.
 * If not, and remaining tip count > 0, returns showTip = true and remaining countdown.
 */
export function getModalHotkeyTipInfo(
    app: App,
    plugin: FluentTasksPlugin,
    commandId: string
): HotkeyTipInfo {
    interface AppWithHotkeys extends App {
        hotkeyManager?: { customKeys?: Record<string, string[]> };
    }
    const customHotkeys = (app as unknown as AppWithHotkeys).hotkeyManager?.customKeys?.[commandId];
    const hotkeyAlreadySet = !!(customHotkeys && customHotkeys.length > 0);

    const currentCount = plugin.settings.quickModalTipCount ?? 0;
    const showTip = !hotkeyAlreadySet && currentCount < MAX_TIP_COUNT;
    const remainingTips = MAX_TIP_COUNT - currentCount;

    return { showTip, remainingTips };
}

/**
 * Increment the tip shown count in settings and persist asynchronously.
 */
export function recordHotkeyTipShown(plugin: FluentTasksPlugin): void {
    const currentCount = plugin.settings.quickModalTipCount ?? 0;
    plugin.settings.quickModalTipCount = currentCount + 1;
    void plugin.saveSettings();
}

export const QUICK_LIST_COMMAND_ID = "fluent-tasks:open-quick-list-modal";

/**
 * Checks if Obsidian has a hotkey assigned to the Quick List floating modal.
 * Inspects official Obsidian HotkeyManager internals (customKeys, defaultKeys, getHotkeys).
 */
export function isQuickListHotkeyAssigned(app: App): boolean {
    const hm = (app as any).hotkeyManager;
    if (!hm) return false;

    const candidateIds = [
        "fluent-tasks:open-quick-list-modal",
        "open-quick-list-modal",
        "fluent-tasks:open-quick-task-modal"
    ];

    for (const id of candidateIds) {
        // 1. Check customKeys dictionary (user-configured custom hotkeys)
        if (hm.customKeys?.[id] && Array.isArray(hm.customKeys[id]) && hm.customKeys[id].length > 0) {
            return true;
        }
        // 2. Check defaultKeys dictionary
        if (hm.defaultKeys?.[id] && Array.isArray(hm.defaultKeys[id]) && hm.defaultKeys[id].length > 0) {
            return true;
        }
        // 3. Check getHotkeys method if available
        if (typeof hm.getHotkeys === "function") {
            try {
                const keys = hm.getHotkeys(id);
                if (Array.isArray(keys) && keys.length > 0) {
                    return true;
                }
            } catch {
                // Ignore errors from internal API
            }
        }
    }

    return false;
}

/**
 * Directly opens Obsidian Settings -> Hotkeys tab with the Quick List command pre-filtered.
 */
export function openHotkeySettingsForQuickList(app: App): void {
    const setting = (app as any).setting;
    if (!setting) return;

    try {
        setting.open();
        setting.openTabById("hotkeys");
        const activeTab = setting.activeTab;
        if (activeTab && activeTab.searchComponent) {
            activeTab.searchComponent.setValue("fluent-tasks:open-quick-list-modal");
            if (typeof activeTab.updateHotkeyVisibility === "function") {
                activeTab.updateHotkeyVisibility();
            }
        }
    } catch (e) {
        console.error("Failed to open Hotkeys setting tab:", e);
    }
}
