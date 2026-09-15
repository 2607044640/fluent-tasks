import { getLanguage, moment } from "obsidian";
import en from "./locale/en";
import zhCn from "./locale/zh-cn";

export type TranslationKey = keyof typeof en;

/**
 * Detect current Obsidian user interface language.
 * Follows official Obsidian guidelines (getLanguage API + fallbacks).
 */
export function detectLanguage(): string {
    let lang = "";
    try {
        if (typeof getLanguage === "function") {
            lang = getLanguage();
        }
    } catch {}

    if (!lang) {
        try {
            lang = (window as any).localStorage?.getItem("language") || "";
        } catch {}
    }

    if (!lang) {
        try {
            lang = (moment as any)?.locale?.() || "";
        } catch {}
    }

    if (!lang && typeof navigator !== "undefined") {
        lang = navigator.language || "";
    }

    return (lang || "en").toLowerCase();
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
    let text = dict[key] || en[key] || (key as string);
    if (params && params.length > 0) {
        for (let i = 0; i < params.length; i++) {
            text = text.replace(new RegExp(`\\{${i}\\}`, "g"), String(params[i]));
        }
    }
    return text;
}
