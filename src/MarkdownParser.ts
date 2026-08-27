/**
 * MarkdownParser.ts
 * Pure-function Markdown ↔ TaskItem[] serialization engine.
 * Zero side effects — no vault access, no state. Just parsing and formatting.
 *
 * File format:
 *   - [ ] Task title %%{"id":"abc","starred":false,"steps":[],"note":"","createdAt":"..."}%%
 *   - [x] Completed task %%{"id":"def","starred":true,"steps":[...],"note":"...","createdAt":"..."}%%
 *
 * The %%{...}%% is an Obsidian invisible comment containing structured JSON metadata.
 */

import { TaskItem, TaskStep, DATA_FOLDER } from "./types";

// =============================================
// Internal Constants
// =============================================
const META_REGEX = /%%(\{.*?\})%%/;
const TASK_LINE_REGEX = /^- \[([ x])\] (.+?)(?:\s*%%\{.*?\}%%)?$/;

// =============================================
// Helpers
// =============================================

/** Generate a deterministic ID from content + timestamp (survives re-reads) */
function generateStableId(title: string, createdAt: string): string {
    const raw = title + createdAt;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

// =============================================
// Parser Class
// =============================================

export class MarkdownParser {

    /**
     * Parse raw markdown content into a TaskItem array.
     */
    static parseTasksFromMarkdown(content: string): TaskItem[] {
        const tasks: TaskItem[] = [];
        const lines = content.split("\n");

        for (const line of lines) {
            const trimmed = line.trim();
            const match = trimmed.match(TASK_LINE_REGEX);
            if (!match) continue;

            const completed = match[1] === "x";
            const rawContent = match[2].trim();

            // Extract metadata JSON from %%{...}%%
            const metaMatch = trimmed.match(META_REGEX);
            let meta: Record<string, unknown> = {};
            let title = rawContent;

            if (metaMatch) {
                try {
                    const parsed = JSON.parse(metaMatch[1]);
                    if (parsed && typeof parsed === "object") {
                        meta = parsed as Record<string, unknown>;
                    }
                } catch { /* swallow parse errors gracefully */ }
                title = rawContent.replace(/\s*%%\{.*?\}%%/, "").trim();
            }

            const createdAt = typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString();
            const id = typeof meta.id === "string" ? meta.id : generateStableId(title, createdAt);

            tasks.push({
                id,
                title,
                completed,
                starred: typeof meta.starred === "boolean" ? meta.starred : false,
                steps: Array.isArray(meta.steps) ? (meta.steps as TaskStep[]) : [],
                note: typeof meta.note === "string" ? meta.note : "",
                createdAt,
                ...(typeof meta.dueDate === "string" ? { dueDate: meta.dueDate } : {}),
                ...(typeof meta.msGraphId === "string" ? { msGraphId: meta.msGraphId } : {}),
                ...(typeof meta.msGraphListId === "string" ? { msGraphListId: meta.msGraphListId } : {}),
                ...(meta.recurrence && typeof meta.recurrence === "object" ? { recurrence: meta.recurrence as RecurrenceRule } : {}),
                ...(typeof meta.why === "string" ? { why: meta.why } : {}),
                ...(Array.isArray(meta.svgs) && meta.svgs.length > 0 ? { svgs: meta.svgs as string[] } : {}),
                ...(typeof meta.note_link === "string" ? { note_link: meta.note_link } : typeof meta.noteLink === "string" ? { note_link: meta.noteLink } : {}),
                ...(meta.customMeta && typeof meta.customMeta === "object" && Object.keys(meta.customMeta).length > 0 ? { customMeta: meta.customMeta as Record<string, unknown> } : {}),
            });
        }

        return tasks;
    }

    /**
     * Serialize a TaskItem array back to markdown text.
     */
    static serializeTasksToMarkdown(tasks: TaskItem[]): string {
        return tasks.map(task => {
            const checkbox = task.completed ? "[x]" : "[ ]";
            const meta: Record<string, unknown> = {
                id: task.id,
                starred: task.starred,
                steps: task.steps,
                note: task.note,
                createdAt: task.createdAt,
            };
            if (task.dueDate) meta.dueDate = task.dueDate;
            if (task.msGraphId) meta.msGraphId = task.msGraphId;
            if (task.msGraphListId) meta.msGraphListId = task.msGraphListId;
            if (task.recurrence) meta.recurrence = task.recurrence;
            if (task.why) meta.why = task.why;
            if (task.svgs && task.svgs.length > 0) meta.svgs = task.svgs;
            if (task.note_link) meta.note_link = task.note_link;
            if (task.customMeta && Object.keys(task.customMeta).length > 0) meta.customMeta = task.customMeta;
            return `- ${checkbox} ${task.title} %%${JSON.stringify(meta)}%%`;
        }).join("\n");
    }

    /**
     * Find a task's index using stable ID, falling back to content fingerprint.
     */
    static findTaskIndex(tasks: TaskItem[], target: TaskItem): number {
        if (!target) return -1;
        const byId = tasks.findIndex(t => t.id === target.id);
        if (byId !== -1) return byId;
        const byTitleAndCreated = tasks.findIndex(t =>
            t.title === target.title && t.createdAt === target.createdAt
        );
        if (byTitleAndCreated !== -1) return byTitleAndCreated;
        return tasks.findIndex(t => t.title === target.title);
    }

    /**
     * Factory: create a new TaskItem with sensible defaults.
     */
    static createTask(title: string): TaskItem {
        const createdAt = new Date().toISOString();
        return {
            id: generateStableId(title, createdAt),
            title,
            completed: false,
            starred: false,
            steps: [],
            note: "",
            createdAt,
        };
    }

}
