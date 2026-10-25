/**
 * types.ts
 * Central type definitions and constants for the entire plugin.
 * All modules import from here — single source of truth.
 */

// =============================================
// View Type Constants
// =============================================
export const VIEW_TYPE_SIDEBAR = "fluent-tasks-sidebar";
export const VIEW_TYPE_MAIN = "fluent-tasks-main";
export const VIEW_TYPE_DETAIL = "fluent-tasks-detail";

export const DATA_FOLDER = "TodoData";
export const STARRED_CATEGORY_PATH = "__starred__";
export const STARRED_CATEGORY_NAME = "Starred";

// =============================================
// Data Models
// =============================================
export interface TaskStep {
    /** Stable key for in-list DnD; optional so legacy JSON still parses */
    id?: string;
    text: string;
    done: boolean;
    /** Attached image paths or wikilinks */
    images?: string[];
}

export interface RecurrenceRule {
    type: 'daily' | 'weekdays' | 'weekly' | 'custom';
    interval: number;
    daysOfWeek?: number[];  // 0=Sun, 1=Mon, ..., 6=Sat
}

export interface TaskItem {
    /** Stable fingerprint ID derived from content + creation timestamp */
    id: string;
    title: string;
    completed: boolean;
    starred: boolean;
    steps: TaskStep[];
    note: string;
    /** Attached image paths or wikilinks for task / note */
    images?: string[];
    /** Attached image paths or wikilinks for title */
    titleImages?: string[];
    createdAt: string; // ISO 8601
    completedAt?: string;   // ISO 8601 timestamp when task was completed
    dueDate?: string;       // ISO date "YYYY-MM-DD", synced from MS Graph
    msGraphId?: string;     // Microsoft Graph todoTask ID
    msGraphListId?: string; // Microsoft Graph todoTaskList ID
    recurrence?: RecurrenceRule;
    /** Core reasoning / rationale behind this task or instruction */
    why?: string;
    /** Multiple reasonings / rationales behind this task */
    whys?: string[];
    /** Array of inline SVG code strings for visual metadata icons */
    svgs?: string[];
    /** Dedicated task note (TodoData/<List>/<title5>_<List>_<Group>_<taskId>.md) */
    task_note?: string;
    /** Multiple linked Obsidian note paths or wikilinks (e.g. [[Topic]] or OneNote/Domain/Topic.md) */
    note_links?: string[];
    /** Linked Obsidian note path or wikilink (legacy single property, kept for backwards compatibility) */
    note_link?: string;
    /** Arbitrary custom key-value metadata */
    customMeta?: Record<string, unknown>;
    /** Priority weight score: 1 to 9, default 5 */
    weight?: number;
    /** For aggregated smart lists (like Starred): original category filepath */
    sourceFilepath?: string;
    /** For aggregated smart lists (like Starred): original category name */
    sourceCategoryName?: string;
}

export interface CategoryInfo {
    /** ID used by Svelte-DND for dragging categories (matches filepath) */
    id: string;
    type?: "category";
    /** Display name (derived from filename without .md extension) */
    name: string;
    /** Relative path within the vault, e.g. "TodoData/MyList.md" */
    filepath: string;
    /** Whether this is a virtual smart list like Starred */
    isSmartList?: boolean;
}

export interface GroupInfo {
    id: string;
    type: "group";
    name: string;
    items: CategoryInfo[];
    isExpanded: boolean;
}

export type SidebarItem = CategoryInfo | GroupInfo;

export interface SidebarCategoryEntry {
    name: string;
    file?: string;
}

export interface SidebarItemState {
    type: "category" | "group";
    id?: string; // Group ID
    name: string; // Group name or Category name
    file?: string; // Physical file basename without .md if different from name
    isExpanded?: boolean;
    children?: Array<string | SidebarCategoryEntry>; // Array of Category names or objects for groups
}

// =============================================
// Event Payloads (for EventBus)
// =============================================
export interface CategorySelectedPayload {
    category: CategoryInfo | null;
}

export interface TaskSelectedPayload {
    task: TaskItem;
    categoryFilepath: string;
}

export interface TaskUpdatedPayload {
    task: TaskItem;
    categoryFilepath: string;
}

export interface TaskMovedPayload {
    task: TaskItem;
    sourcePath: string;
    targetPath: string;
}

export interface TaskDeletedPayload {
    task: TaskItem;
    categoryFilepath: string;
}

export interface CategoryListChangedPayload {
    sidebarItems: SidebarItem[];
}

// =============================================
// Event Name Registry
// =============================================
export enum EventName {
    CATEGORY_SELECTED = "category:selected",
    CATEGORY_LIST_CHANGED = "category:list-changed",
    CATEGORY_RENAMED = "category:renamed",
    CATEGORY_DELETED = "category:deleted",
    TASK_SELECTED = "task:selected",
    TASK_UPDATED = "task:updated",
    TASK_MOVED = "task:moved",
    TASK_DELETED = "task:deleted",
    STEP_DELETED = "step:deleted",
    TASK_COMPLETED = "task:completed",
    DETAIL_CLOSE = "detail:close",
    TASK_NAVIGATE = "task:navigate",
    SETTINGS_CHANGED = "settings:changed",
    TRIGGER_SIDEBAR_RENAME = "sidebar:trigger-rename",
    REVEAL_SIDEBAR_CATEGORY = "sidebar:reveal-category",
}

export interface CategoryRenamedPayload {
    oldFilepath: string;
    category: CategoryInfo;
}

export interface TrashedImageBackup {
    path: string;
    binary: ArrayBuffer;
}

export interface StepDeletedPayload {
    taskId: string;
    categoryFilepath: string;
    step: TaskStep;
    index: number;
    trashedImages?: TrashedImageBackup[];
}

export interface CategoryDeletedPayload {
    categoryName: string;
    categoryFilepath: string;
    fileContent: string;
    groupName?: string;
    index?: number;
}

