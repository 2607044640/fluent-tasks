/**
 * timeUtils.ts
 * Pure formatting utilities for timestamps, relative time, and recurrence rules.
 */

import type { RecurrenceRule } from "../types";

export const DAY_LABELS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Parse a calendar date string (YYYY-MM-DD) into a local midnight Date.
 * Avoids browser UTC timezone offset distortion.
 */
export function parseLocalDate(dateStr: string): Date {
    const parts = dateStr.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
}

/**
 * Format a Date object to local calendar string: YYYY-MM-DD.
 * Strictly uses local date components to avoid UTC off-by-one shifts.
 */
export function formatLocalDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Get today's calendar date in local format: YYYY-MM-DD.
 */
export function getTodayLocalDateString(): string {
    return formatLocalDate(new Date());
}

/**
 * Format an ISO string to exact second timestamp: YYYY-MM-DD HH:mm:ss
 */
export function formatExactTime(iso?: string): string {
    if (!iso) return "";
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch {
        return "";
    }
}

/**
 * Convert ISO timestamp to human-friendly relative time string (e.g. "just now", "15m ago", "2h ago", "yesterday", "3d ago")
 */
export function getRelativeTime(iso?: string): string {
    if (!iso) return "";
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        const now = Date.now();
        const diffMs = now - d.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) return "just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return "yesterday";
        if (diffDays < 30) return `${diffDays}d ago`;
        const diffMonths = Math.floor(diffDays / 30);
        if (diffMonths < 12) return `${diffMonths}mo ago`;
        return `${Math.floor(diffDays / 365)}y ago`;
    } catch {
        return "";
    }
}

/**
 * Format a RecurrenceRule into a human-readable natural language label.
 */
export function getRecurrenceLabel(rule?: RecurrenceRule): string {
    if (!rule) return "";
    switch (rule.type) {
        case 'daily':
            return rule.interval === 1 ? "Every day" : `Every ${rule.interval} days`;
        case 'weekdays':
            return "Weekdays (Mon–Fri)";
        case 'weekly': {
            const days = (rule.daysOfWeek || []).map((d: number) => DAY_LABELS[d]).join(', ');
            const prefix = rule.interval === 1 ? "Every week" : `Every ${rule.interval} weeks`;
            return days ? `${prefix} on ${days}` : prefix;
        }
        case 'custom': {
            if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
                const days = rule.daysOfWeek.map((d: number) => DAY_LABELS[d]).join(', ');
                return `Every ${rule.interval} week(s) on ${days}`;
            }
            return `Every ${rule.interval} day(s)`;
        }
        default:
            return "";
    }
}
