import type { TaskItem, TaskStep } from "../types";

export interface AiXmlExportOptions {
    /**
     * Optional override for task steps (e.g. current in-memory reactive steps
     * that might be mid-drag or not yet persisted to the underlying task object).
     */
    steps?: TaskStep[];
}

/**
 * Serializes a task and its subtasks/metadata into an XML-tagged format
 * optimized for AI prompt consumption and structured LLM reasoning.
 *
 * Output tags:
 * - <Title>: Task title
 * - <Item_N> / <Item_N_Excluded>: Subtask items (with done status reflected in tag name)
 * - <Details>: Task notes and image attachments
 * - <Why>: Core reasoning
 * - <LinkedNote>: Linked markdown files and dedicated task notes
 * - <DueDate>: Due date string
 */
export function formatTaskAsAiXml(task: TaskItem | null | undefined, options?: AiXmlExportOptions): string {
    if (!task) return "";

    const sections: string[] = [];

    // Title
    if (task.title && task.title.trim()) {
        sections.push(`<Title>\n${task.title.trim()}\n</Title>`);
    }

    // Steps / Items
    const effectiveSteps = options?.steps || task.steps;
    if (effectiveSteps && effectiveSteps.length > 0) {
        let itemIndex = 1;
        for (const step of effectiveSteps) {
            let text = (step.text || "").trim();
            if (step.images && step.images.length > 0) {
                const imgText = step.images.map(img => `![[${img}]]`).join("\n");
                text = text ? `${text}\n${imgText}` : imgText;
            }
            if (!text) continue;
            const tag = step.done ? `Item_${itemIndex}_Excluded` : `Item_${itemIndex}`;
            sections.push(`<${tag}>\n${text}\n</${tag}>`);
            itemIndex++;
        }
    }

    // Details / Note
    let noteText = (task.note || "").trim();
    if (task.images && task.images.length > 0) {
        const noteImages = task.images
            .filter(img => !noteText.includes(img))
            .map(img => `![[${img}]]`)
            .join("\n");
        if (noteImages) {
            noteText = noteText ? `${noteText}\n${noteImages}` : noteImages;
        }
    }
    if (noteText) {
        sections.push(`<Details>\n${noteText}\n</Details>`);
    }

    // Why / Core Reasoning
    const whys = task.whys && task.whys.length > 0
        ? task.whys.filter(w => w && w.trim())
        : (task.why && task.why.trim() ? [task.why.trim()] : []);
    if (whys.length > 0) {
        sections.push(`<Why>\n${whys.join("\n")}\n</Why>`);
    }

    // Linked Notes
    const linkedNotes: string[] = [];
    if (task.task_note && task.task_note.trim()) linkedNotes.push(task.task_note.trim());
    if (task.note_links && task.note_links.length > 0) {
        for (const link of task.note_links) {
            if (link && link.trim() && !linkedNotes.includes(link.trim())) {
                linkedNotes.push(link.trim());
            }
        }
    } else if (task.note_link && task.note_link.trim() && !linkedNotes.includes(task.note_link.trim())) {
        linkedNotes.push(task.note_link.trim());
    }
    if (linkedNotes.length > 0) {
        sections.push(`<LinkedNote>\n${linkedNotes.join("\n")}\n</LinkedNote>`);
    }

    // Due date
    if (task.dueDate && task.dueDate.trim()) {
        sections.push(`<DueDate>\n${task.dueDate.trim()}\n</DueDate>`);
    }

    return sections.join("\n\n");
}
