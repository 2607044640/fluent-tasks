import { App } from "obsidian";
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
