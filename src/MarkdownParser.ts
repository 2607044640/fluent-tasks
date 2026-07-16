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
            let meta: Partial<TaskItem> = {};
            let title = rawContent;

            if (metaMatch) {
                try {
                    meta = JSON.parse(metaMatch[1]);
                } catch { /* swallow parse errors gracefully */ }
                title = rawContent.replace(/\s*%%\{.*?\}%%/, "").trim();
            }

            const createdAt = meta.createdAt || new Date().toISOString();
            const id = meta.id || generateStableId(title, createdAt);

            tasks.push({
                id,
                title,
                completed,
                starred: meta.starred ?? false,
                steps: meta.steps ?? [],
                note: meta.note ?? "",
                createdAt,
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
            const meta = {
                id: task.id,
                starred: task.starred,
                steps: task.steps,
                note: task.note,
                createdAt: task.createdAt,
            };
            return `- ${checkbox} ${task.title} %%${JSON.stringify(meta)}%%`;
        }).join("\n");
    }

    /**
     * Find a task's index using stable ID, falling back to content fingerprint.
     */
    static findTaskIndex(tasks: TaskItem[], target: TaskItem): number {
        const byId = tasks.findIndex(t => t.id === target.id);
        if (byId !== -1) return byId;
        return tasks.findIndex(t =>
            t.title === target.title && t.createdAt === target.createdAt
        );
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
