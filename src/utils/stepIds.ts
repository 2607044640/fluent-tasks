import { SHADOW_ITEM_MARKER_PROPERTY_NAME } from "svelte-dnd-action";
import type { TaskStep } from "../types";

export function ensureStepIds(taskId: string, steps: TaskStep[]): TaskStep[] {
    const used = new Set<string>();
    return steps.map((step, index) => {
        const base = step.id && step.id.length > 0 ? step.id : `${taskId}-step-${index}`;
        let unique = base;
        let n = 0;
        while (used.has(unique)) {
            n += 1;
            unique = `${base}-${n}`;
        }
        used.add(unique);
        if (step.id === unique) return step;
        return { ...step, id: unique };
    });
}

export function persistableSteps(steps: TaskStep[]): TaskStep[] {
    return steps
        .filter((step) => {
            const marker = (step as unknown as Record<string, unknown>)[SHADOW_ITEM_MARKER_PROPERTY_NAME];
            return marker !== true;
        })
        .map((step) => {
            const out: TaskStep = { text: step.text, done: step.done };
            if (step.id) out.id = step.id;
            return out;
        });
}

/**
 * Reconciles steps after a DND reorder operation.
 * Guarantees that:
 * 1. Every step that existed in preDragSteps is preserved (zero data loss).
 * 2. Shadow items are restored to their real step contents rather than dropped.
 * 3. Any dropped or missing steps are automatically recovered and appended.
 * 4. All DND internal markers are stripped from the output.
 */
export function reconcileDndSteps(
    preDragSteps: TaskStep[],
    incomingItems: TaskStep[],
    trigger?: string
): TaskStep[] {
    const preMap = new Map<string, TaskStep>();
    for (const s of preDragSteps) {
        if (s.id) preMap.set(s.id, s);
    }

    const result: TaskStep[] = [];
    const seenIds = new Set<string>();

    for (const item of incomingItems) {
        const id = item.id;
        if (!id) continue;
        if (seenIds.has(id)) continue;

        const original = preMap.get(id);
        const isShadow = (item as unknown as Record<string, unknown>)[SHADOW_ITEM_MARKER_PROPERTY_NAME] === true;

        if (isShadow && original) {
            // Restore original step data cleanly without shadow marker
            result.push({ text: original.text, done: original.done, id: original.id });
            seenIds.add(id);
        } else if (original) {
            result.push({ text: item.text ?? original.text, done: item.done ?? original.done, id });
            seenIds.add(id);
        } else {
            result.push({ text: item.text, done: item.done, id });
            seenIds.add(id);
        }
    }

    // Safety recovery: if any step from preDragSteps was dropped by dndzone, restore it
    const missing: TaskStep[] = [];
    for (const orig of preDragSteps) {
        if (orig.id && !seenIds.has(orig.id)) {
            missing.push({ text: orig.text, done: orig.done, id: orig.id });
            seenIds.add(orig.id);
        }
    }

    if (missing.length > 0) {
        console.warn(`[FluentTasks DND Guard] Recovered ${missing.length} lost step(s):`, {
            trigger,
            missing,
            preCount: preDragSteps.length,
            incomingCount: incomingItems.length
        });
        result.push(...missing);
    }

    return result;
}
