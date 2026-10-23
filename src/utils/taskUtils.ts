/**
 * taskUtils.ts
 * Pure utility functions for task manipulations, priority weight calculation,
 * and stable sorting.
 */

import type { TaskItem, TaskStep } from "../types";
import { DEFAULT_TASK_WEIGHT, MIN_TASK_WEIGHT, MAX_TASK_WEIGHT } from "../constants";
import { getTitleImages, getNoteImages, getStepImages, cleanDisplayTitle } from "./imageAttachmentUtils";

/**
 * Checks whether a single task step is empty (no text and no images).
 */
export function isStepEmpty(step: TaskStep): boolean {
    const hasText = !!step.text && step.text.trim().length > 0;
    const hasImages = getStepImages(step).length > 0;
    return !hasText && !hasImages;
}

/**
 * Checks whether a task is completely empty across all fields:
 * - title (text and images)
 * - note / detail (text and images)
 * - why / whys
 * - steps / sidesteps (zero steps or only empty steps)
 * - svgs
 * - task_note, note_link, and note_links
 * - custom metadata
 */
export function isTaskEmpty(task: TaskItem | null | undefined): boolean {
    if (!task) return false;

    // 1. Title: check cleaned text and images
    const hasTitle = cleanDisplayTitle(task.title || "").trim().length > 0 || getTitleImages(task).length > 0;
    if (hasTitle) return false;

    // 2. Note / Detail: check text and images
    const noteClean = (task.note || "")
        .replace(/!\[\[([^\]\n]+)\]\]/g, "")
        .replace(/!\[.*?\]\(([^)\n]+)\)/g, "")
        .trim();
    const hasNote = noteClean.length > 0 || getNoteImages(task).length > 0;
    if (hasNote) return false;

    // 3. Why / Whys
    const hasWhy = (!!task.why && task.why.trim().length > 0) || (!!task.whys && task.whys.some(w => !!w && w.trim().length > 0));
    if (hasWhy) return false;

    // 4. Steps / Sidesteps: check if any non-empty step exists
    const hasSteps = !!task.steps && task.steps.some(s => !isStepEmpty(s));
    if (hasSteps) return false;

    // 5. Visual SVGs
    const hasSvgs = !!task.svgs && task.svgs.length > 0;
    if (hasSvgs) return false;

    // 6. Dedicated task note and linked notes
    const hasTaskNote = !!task.task_note && task.task_note.trim().length > 0;
    if (hasTaskNote) return false;
    const hasNoteLink = !!task.note_link && task.note_link.trim().length > 0;
    if (hasNoteLink) return false;
    const hasNoteLinks = !!task.note_links && task.note_links.some(nl => !!nl && nl.trim().length > 0);
    if (hasNoteLinks) return false;

    // 7. Custom metadata
    const hasCustom = !!task.customMeta && Object.values(task.customMeta).some(v => v !== null && v !== undefined && (typeof v !== "string" || v.trim().length > 0));
    if (hasCustom) return false;

    return true;
}

/**
 * Returns the effective priority weight of a task (1-9), falling back to DEFAULT_TASK_WEIGHT (5).
 */
export function getTaskWeight(task: TaskItem): number {
    if (typeof task.weight === "number" && !isNaN(task.weight) && task.weight >= MIN_TASK_WEIGHT && task.weight <= MAX_TASK_WEIGHT) {
        return task.weight;
    }
    return DEFAULT_TASK_WEIGHT;
}

/**
 * Clamps a given weight to the valid [MIN_TASK_WEIGHT, MAX_TASK_WEIGHT] range.
 */
export function clampTaskWeight(weight: number): number {
    return Math.max(MIN_TASK_WEIGHT, Math.min(MAX_TASK_WEIGHT, weight));
}

/**
 * Applies stable priority sorting by weight when weight mode is enabled.
 * Tasks with higher weights appear first; tasks with equal weights preserve their relative order.
 */
export function applyWeightSort(items: TaskItem[], enableWeightMode: boolean = false): TaskItem[] {
    if (!enableWeightMode) {
        return [...items];
    }
    return items
        .map((item, idx) => ({ item, idx }))
        .sort((a, b) => {
            const diff = getTaskWeight(b.item) - getTaskWeight(a.item);
            if (diff !== 0) return diff;
            return a.idx - b.idx;
        })
        .map(({ item }) => item);
}
