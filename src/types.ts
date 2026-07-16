/**
 * types.ts
 * Central type definitions and constants for the entire plugin.
 * All modules import from here — single source of truth.
 */

// =============================================
// View Type Constants
// =============================================
export const VIEW_TYPE_SIDEBAR = "ms-todo-sidebar";
export const VIEW_TYPE_MAIN = "ms-todo-main";
export const VIEW_TYPE_DETAIL = "ms-todo-detail";

export const DATA_FOLDER = "TodoData";

// =============================================
// Data Models
// =============================================
export interface TaskStep {
    text: string;
    done: boolean;
}

export interface TaskItem {
    /** Stable fingerprint ID derived from content + creation timestamp */
    id: string;
    title: string;
    completed: boolean;
    starred: boolean;
    steps: TaskStep[];
    note: string;
    createdAt: string; // ISO 8601
}

export interface CategoryInfo {
    /** Optional ID used by Svelte-DND for dragging categories */
    id?: string;
    type?: "category";
    /** Display name (derived from filename without .md extension) */
    name: string;
    /** Relative path within the vault, e.g. "TodoData/MyList.md" */
    filepath: string;
}

export interface GroupInfo {
    id: string;
    type: "group";
    name: string;
    items: CategoryInfo[];
    isExpanded: boolean;
}

export type SidebarItem = CategoryInfo | GroupInfo;

export interface SidebarItemState {
    type: "category" | "group";
    id?: string; // Group ID
    name: string; // Group name or Category name
    isExpanded?: boolean;
    children?: string[]; // Array of Category names for groups
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
    TASK_SELECTED = "task:selected",
    TASK_UPDATED = "task:updated",
    TASK_MOVED = "task:moved",
    TASK_DELETED = "task:deleted",
    TASK_COMPLETED = "task:completed",
    DETAIL_CLOSE = "detail:close",
}
