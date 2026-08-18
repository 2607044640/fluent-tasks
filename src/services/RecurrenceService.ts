import type { TaskItem, RecurrenceRule } from "../types";

/**
 * Pure-function service for recurring task logic.
 * No side effects — all methods return new values without mutating inputs.
 */
export class RecurrenceService {

    /**
     * Calculate the next due date from the current due date and recurrence rule.
     * @param currentDue ISO date string "YYYY-MM-DD"
     * @param rule The recurrence rule
     * @returns Next ISO date string "YYYY-MM-DD"
     */
    static calculateNextDueDate(currentDue: string, rule: RecurrenceRule): string {
        const date = new Date(currentDue + "T00:00:00");

        switch (rule.type) {
            case 'daily':
                date.setDate(date.getDate() + rule.interval);
                break;

            case 'weekdays':
                // Advance to next weekday (Mon-Fri)
                do {
                    date.setDate(date.getDate() + 1);
                } while (date.getDay() === 0 || date.getDay() === 6);
                break;

            case 'weekly':
                if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
                    // Find the next matching day in the weekly cycle
                    const currentDay = date.getDay();
                    const sorted = [...rule.daysOfWeek].sort((a, b) => a - b);

                    // Look for the next day in the same week
                    let found = false;
                    for (const day of sorted) {
                        if (day > currentDay) {
                            date.setDate(date.getDate() + (day - currentDay));
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        // Wrap to the first day of the next interval-week cycle
                        const daysUntilFirstDay = 7 * rule.interval - currentDay + sorted[0];
                        date.setDate(date.getDate() + daysUntilFirstDay);
                    }
                } else {
                    // Simple: advance by N weeks
                    date.setDate(date.getDate() + 7 * rule.interval);
                }
                break;

            case 'custom':
                if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
                    // Custom with weekday selection: same logic as weekly
                    const currentDay = date.getDay();
                    const sorted = [...rule.daysOfWeek].sort((a, b) => a - b);

                    let found = false;
                    for (const day of sorted) {
                        if (day > currentDay) {
                            date.setDate(date.getDate() + (day - currentDay));
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        const daysUntilFirstDay = 7 * rule.interval - currentDay + sorted[0];
                        date.setDate(date.getDate() + daysUntilFirstDay);
                    }
                } else {
                    // Custom every N days
                    date.setDate(date.getDate() + rule.interval);
                }
                break;
        }

        return date.toISOString().slice(0, 10);
    }

    /**
     * Process a recurring task completion: advance due date, reset completed and steps.
     * Returns a NEW task object (does not mutate the input).
     */
    static handleRecurringCompletion(task: TaskItem): TaskItem {
        const baseDue = task.dueDate || new Date().toISOString().slice(0, 10);
        const nextDue = RecurrenceService.calculateNextDueDate(baseDue, task.recurrence!);

        return {
            ...task,
            completed: false,
            dueDate: nextDue,
            steps: task.steps.map(s => ({ ...s, done: false })),
        };
    }
}
