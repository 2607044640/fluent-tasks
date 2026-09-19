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
            const marker = (step as Record<string, unknown>)[SHADOW_ITEM_MARKER_PROPERTY_NAME];
            return marker !== true;
        })
        .map((step) => {
            const out: TaskStep = { text: step.text, done: step.done };
            if (step.id) out.id = step.id;
            return out;
        });
}
