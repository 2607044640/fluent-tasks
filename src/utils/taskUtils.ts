/**
 * taskUtils.ts
 * Pure utility functions for task manipulations, priority weight calculation,
 * and stable sorting.
 */

import type { TaskItem } from "../types";
import { DEFAULT_TASK_WEIGHT, MIN_TASK_WEIGHT, MAX_TASK_WEIGHT } from "../constants";

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
