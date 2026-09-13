# Recurrence Engine

Pure date math for `RecurrenceRule`. No vault I/O. Persistence is a field on `TaskItem` inside the Markdown `%%{}%%` comment. UI lives in `TaskDetailView`.

## Scope Boundaries

| Component | Responsible For | MUST NOT Contain |
|---|---|---|
| `RecurrenceService` (`src/services/RecurrenceService.ts`) | `calculateNextDueDate`, `checkTaskRollover`, `rolloverTasks` | File writes, EventBus, Svelte |
| `RecurrenceRule` (`src/types.ts`) | `type: 'daily' \| 'weekdays' \| 'weekly' \| 'custom'`, `interval`, optional `daysOfWeek` (0=Sun…6=Sat) | Monthly/yearly (not implemented) |
| `timeUtils` (`parseLocalDate`, `formatLocalDate`, `getTodayLocalDateString`, `getRecurrenceLabel`) | Local `YYYY-MM-DD` and labels | Vault |
| `FluentTasksPlugin.checkRecurringTasksRollover` | Schedule rollover (startup, 10s, focus) | Rule math |
| `TaskDetailView.setRecurrencePreset` / `setCustomInterval` / `toggleWeekday` | User-facing presets | Direct file I/O (goes through `immediateSave` / `scheduleSave`) |

## Key Invariants

1. All due dates are local calendar strings, never UTC ISO dates. (Why chosen over `toISOString().slice(0,10)` in the engine: UTC would shift the calendar day.)
2. Methods copy tasks (`{ ...task }`, mapped steps); they do not mutate the input array. (Why chosen over in-place edits: `getTasks` can decide whether to save.)
3. Incomplete overdue recurrences snap `dueDate` to **today**, they do not skip forward by `interval` until completion. Completed recurrences wait until `today >= nextDue` (from `completedAt` or `dueDate`) then uncomplete, clear `completedAt`, reset step `done` flags, set `dueDate` today. (Why chosen over generating extra task rows: one row per recurring item.)

## Numbered Data Flow

1. User sets a preset in `TaskDetailView` (`daily` interval 1, `weekdays`, `weekly` on `new Date().getDay()`, or `custom`). Missing `dueDate` is filled with UTC-slice today in the **UI** (`toISOString().slice(0,10)`).
2. `immediateSave` / `scheduleSave` → `DataService.updateTask` serializes `recurrence` via `MarkdownParser`.
3. On read: `TaskService.getTasks` → `RecurrenceService.rolloverTasks(tasks, getTodayLocalDateString())`.
4. Background: `checkRecurringTasksRollover` skips if `lastRolloverDate === today` unless `force`; else `DataService.rolloverRecurringTasks` per file.
5. `calculateNextDueDate`: `daily` adds `interval` days; `weekdays` walks forward to Mon–Fri; `weekly`/`custom` with `daysOfWeek` uses `advanceWeeklyCycle`; else weekly adds `7 * interval` or custom adds `interval` days.
6. If any file changed, plugin emits `TASK_UPDATED` `{ isExternal: true }`.

## Side-effects API

| Method | Signature | Side-Effects |
|---|---|---|
| `calculateNextDueDate` | `(currentDue: string, rule: RecurrenceRule): string` | None (pure) |
| `checkTaskRollover` | `(task: TaskItem, todayStr: string): TaskItem \| null` | None (pure; `null` if unchanged) |
| `rolloverTasks` | `(tasks: TaskItem[], todayStr: string): { tasks, changed }` | None (pure) |
| `getRecurrenceLabel` (`timeUtils`) | `(rule?: RecurrenceRule): string` | None (pure) |
| `FluentTasksPlugin.checkRecurringTasksRollover` | `(force?: boolean): Promise<void>` | May rewrite list files; EventBus |

## Recipes

1. **Repeat daily** — Detail panel `setRecurrencePreset('daily')` → `task.recurrence = { type: 'daily', interval: 1 }` → `immediateSave`.
2. **Weekdays** — `setRecurrencePreset('weekdays')`.
3. **Weekly on a weekday** — `handleWeekdayClick(day)` sets `{ type: 'weekly', interval: 1, daysOfWeek: [...] }`.
4. **Custom interval** — `setCustomInterval(n)` sets `{ type: 'custom', interval: max(1,n) }`.
5. **Clear** — `clearRecurrence` or `clearDueDate` (clears both due date and recurrence).
6. **Force rollover** — plugin startup `checkRecurringTasksRollover(true)`.

<!-- BEGIN USER-SPECIFIED -->
<!-- END USER-SPECIFIED -->
