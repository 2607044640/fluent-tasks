import type { TaskItem, RecurrenceRule } from "../types";
import { parseLocalDate, formatLocalDate } from "../utils/timeUtils";

/**
 * Pure-function service for recurring task logic.
 * No side effects — all methods return new values without mutating inputs.
 */
export class RecurrenceService {

    /**
     * Calculate the next due date from the current due date and recurrence rule.
     * @param currentDue ISO date string "YYYY-MM-DD"
     * @param rule The recurrence rule
     * @returns Next ISO date string "YYYY-MM-DD" in local calendar format
     */
    static calculateNextDueDate(currentDue: string, rule: RecurrenceRule): string {
        const date = parseLocalDate(currentDue);

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
                    RecurrenceService.advanceWeeklyCycle(date, rule.daysOfWeek, rule.interval);
                } else {
                    date.setDate(date.getDate() + 7 * rule.interval);
                }
                break;

            case 'custom':
                if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
                    RecurrenceService.advanceWeeklyCycle(date, rule.daysOfWeek, rule.interval);
                } else {
                    date.setDate(date.getDate() + rule.interval);
                }
                break;
        }

        return formatLocalDate(date);
    }

    /**
     * Advance a date to the next matching weekday in the weekly/custom recurrence cycle.
     */
    private static advanceWeeklyCycle(date: Date, daysOfWeek: number[], interval: number): void {
        const currentDay = date.getDay();
        const sorted = [...daysOfWeek].sort((a, b) => a - b);

        for (const day of sorted) {
            if (day > currentDay) {
                date.setDate(date.getDate() + (day - currentDay));
                return;
            }
        }

        // Wrap to the first day of the next interval-week cycle
        const daysUntilFirstDay = 7 * interval - currentDay + sorted[0];
        date.setDate(date.getDate() + daysUntilFirstDay);
    }

    /**
     * Check if a recurring task should rollover to today.
     * - If completed and its next recurrence or new day has arrived: resets completed=false, steps, and dueDate=today.
     * - If incomplete but dueDate < today ("过了就要重置时间到当天！"): resets dueDate=today.
     * Returns updated TaskItem if changes were made, or null if no change needed.
     */
    static checkTaskRollover(task: TaskItem, todayStr: string): TaskItem | null {
        if (!task.recurrence) return null;

        let changed = false;
        let updated = { ...task };

        // Case 1: Task was completed. Check if its next occurrence date has arrived, or completed on a past day.
        if (updated.completed) {
            const compDate = updated.completedAt
                ? formatLocalDate(new Date(updated.completedAt))
                : (updated.dueDate || "");
            
            // Prioritize actual completion date so today's completion is not prematurely reset by stale due dates
            const baseDate = compDate || updated.dueDate || todayStr;
            const nextDue = RecurrenceService.calculateNextDueDate(baseDate, updated.recurrence);

            if (todayStr >= nextDue || (compDate && compDate < todayStr)) {
                updated.completed = false;
                delete updated.completedAt;
                updated.dueDate = todayStr;
                if (updated.steps && updated.steps.length > 0) {
                    updated.steps = updated.steps.map(s => ({ ...s, done: false }));
                }
                changed = true;
            }
        }
        // Case 2: Incomplete, but dueDate is in the past (< todayStr). User requirement: "过了就要重置时间到当天！"
        else {
            if (updated.dueDate && updated.dueDate < todayStr) {
                updated.dueDate = todayStr;
                changed = true;
            }
        }

        return changed ? updated : null;
    }

    /**
     * Process an entire array of tasks for rollover to today.
     * Returns { tasks: TaskItem[], changed: boolean }
     */
    static rolloverTasks(tasks: TaskItem[], todayStr: string): { tasks: TaskItem[]; changed: boolean } {
        let hasChanges = false;
        const newTasks = tasks.map(task => {
            const rolled = RecurrenceService.checkTaskRollover(task, todayStr);
            if (rolled) {
                hasChanges = true;
                return rolled;
            }
            return task;
        });
        return { tasks: newTasks, changed: hasChanges };
    }
}
