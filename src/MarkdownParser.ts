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

import { TaskItem, TaskStep, DATA_FOLDER, RecurrenceRule } from "./types";

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
     * Supports both single-line <br> encoded titles and legacy multi-line continuation lines.
     */
    static parseTasksFromMarkdown(content: string): TaskItem[] {
        const tasks: TaskItem[] = [];
        const rawLines = content.split("\n");

        interface RawTaskBlock {
            completed: boolean;
            lines: string[];
        }

        const blocks: RawTaskBlock[] = [];
        let currentBlock: RawTaskBlock | null = null;
        const TASK_START_REGEX = /^- \[([ x])\](?:\s+(.*))?$/;

        for (const rawLine of rawLines) {
            const trimmed = rawLine.trim();
            const startMatch = trimmed.match(TASK_START_REGEX);

            if (startMatch) {
                if (currentBlock) {
                    blocks.push(currentBlock);
                }
                currentBlock = {
                    completed: startMatch[1] === "x",
                    lines: [startMatch[2] || ""],
                };
            } else if (currentBlock) {
                // Check if current block already completed its metadata
                const blockHasMeta = currentBlock.lines.some(l => META_REGEX.test(l));
                if (blockHasMeta) {
                    // Current block already closed its metadata.
                    // Subsequent lines do not belong to it.
                    blocks.push(currentBlock);
                    currentBlock = null;
                } else if (trimmed.length > 0) {
                    // Continuation line belonging to the unclosed task block
                    currentBlock.lines.push(trimmed);
                }
            }
        }

        if (currentBlock) {
            blocks.push(currentBlock);
        }

        for (const block of blocks) {
            const joinedContent = block.lines.join("\n");

            // Extract metadata JSON from %%{...}%%
            const metaMatch = joinedContent.match(META_REGEX);
            let meta: Record<string, unknown> = {};
            let rawTitle = joinedContent;

            if (metaMatch) {
                try {
                    const parsed = JSON.parse(metaMatch[1]);
                    if (parsed && typeof parsed === "object") {
                        meta = parsed as Record<string, unknown>;
                    }
                } catch { /* swallow parse errors gracefully */ }
                rawTitle = joinedContent.replace(/\s*%%\{.*?\}%%/, "");
            }

            const createdAt = typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString();
            // Decode <br> / <br/> / <br /> back to \n
            const cleanTitle = rawTitle.replace(/<br\s*\/?>/gi, "\n").trim();
            const id = typeof meta.id === "string" ? meta.id : generateStableId(cleanTitle, createdAt);

            const cleanSteps: TaskStep[] = Array.isArray(meta.steps)
                ? (meta.steps as unknown[])
                    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
                    .map((s) => ({
                        text: typeof s.text === "string" ? s.text.trimEnd() : "",
                        done: Boolean(s.done),
                    }))
                : [];

            tasks.push({
                id,
                title: cleanTitle,
                completed: block.completed,
                starred: typeof meta.starred === "boolean" ? meta.starred : false,
                steps: cleanSteps,
                note: typeof meta.note === "string" ? meta.note : "",
                createdAt,
                ...(typeof meta.completedAt === "string" ? { completedAt: meta.completedAt } : {}),
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
     * Encodes newlines in titles as <br> to ensure each task is a single physical line.
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
            if (task.completedAt) meta.completedAt = task.completedAt;
            if (task.dueDate) meta.dueDate = task.dueDate;
            if (task.msGraphId) meta.msGraphId = task.msGraphId;
            if (task.msGraphListId) meta.msGraphListId = task.msGraphListId;
            if (task.recurrence) meta.recurrence = task.recurrence;
            if (task.why) meta.why = task.why;
            if (task.svgs && task.svgs.length > 0) meta.svgs = task.svgs;
            if (task.note_link) meta.note_link = task.note_link;
            if (task.customMeta && Object.keys(task.customMeta).length > 0) meta.customMeta = task.customMeta;

            const safeTitle = (task.title || "").replace(/\r?\n/g, "<br>");
            return `- ${checkbox} ${safeTitle} %%${JSON.stringify(meta)}%%`;
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
