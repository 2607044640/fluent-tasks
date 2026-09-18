import { getLanguage } from "obsidian";
import en from "./locale/en";
import zhCn from "./locale/zh-cn";

export type TranslationKey = keyof typeof en;

/**
 * Detect current Obsidian user interface language.
 * Follows official Obsidian guidelines (getLanguage API + fallbacks).
 */
export function detectLanguage(): string {
    try {
        const lang = getLanguage();
        if (lang) {
            return lang.toLowerCase();
        }
    } catch {
        // Fallback if environment lacks getLanguage
    }

    return "en";
}

/**
 * Check if the active locale is Chinese (zh, zh-cn, zh-tw, zh-hk, etc.)
 */
export function isChinese(): boolean {
    const lang = detectLanguage();
    return lang === "zh" || lang.startsWith("zh-") || lang.startsWith("zh_");
}

/**
 * Get the active dictionary based on user's language setting.
 * Strict rule: Default to English unless language is specifically Chinese.
 */
export function getLocaleDict(): typeof en {
    if (isChinese()) {
        return zhCn;
    }
    return en;
}

/**
 * Primary translation helper.
 * Retrieves translated string by key with parameter interpolation ({0}, {1}, etc.)
 */
export function t(key: TranslationKey, ...params: (string | number)[]): string {
    const dict = getLocaleDict();
    let text = dict[key] || en[key] || key;
    if (params && params.length > 0) {
        for (let i = 0; i < params.length; i++) {
            text = text.replace(new RegExp(`\\{${i}\\}`, "g"), String(params[i]));
        }
    }
    return text;
}
