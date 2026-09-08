import { App, TFile, TFolder } from "obsidian";
import { DATA_FOLDER, type TaskItem, EventName } from "../types";
import { EventBus } from "../EventBus";
import { Logger } from "../Logger";
import type { DataService } from "../DataService";

export class LinkedNoteService {
    private static internalRenames: Map<string, number> = new Map();

    /** Mark a file rename as internal to prevent echo update loops */
    static markInternalRename(oldPath: string, newPath: string, windowMs = 2000): void {
        const expiry = Date.now() + windowMs;
        this.internalRenames.set(`${oldPath}->${newPath}`, expiry);
        this.internalRenames.set(oldPath, expiry);
        this.internalRenames.set(newPath, expiry);
    }

    /** Check if a rename was triggered internally */
    static isInternalRename(oldPath: string, newPath: string): boolean {
        const key = `${oldPath}->${newPath}`;
        const now = Date.now();
        const expKey = this.internalRenames.get(key);
        if (expKey && now <= expKey) return true;
        const expOld = this.internalRenames.get(oldPath);
        if (expOld && now <= expOld) return true;
        const expNew = this.internalRenames.get(newPath);
        if (expNew && now <= expNew) return true;
        return false;
    }

    /**
     * Sanitize task title into a safe Windows / Obsidian filename
     * Removes / \\ : * ? " < > | \r \n and cleans whitespace
     */
    static sanitizeNoteTitle(title: string): string {
        if (!title) return "Untitled Note";
        const cleaned = title
            .replace(/[\r\n]+/g, " ")
            .replace(/[\\/:*?"<>|]/g, "-")
            .replace(/\s+/g, " ")
            .replace(/^[\s.-]+|[\s.-]+$/g, "")
            .trim();
        return cleaned.slice(0, 100) || "Untitled Note";
    }

    /**
     * Determine dedicated note directory for a category list
     * e.g. TodoData/安全中转待办.md -> TodoData/安全中转待办
     */
    static getTaskNotesFolder(categoryFilepath: string): string {
        const listName = categoryFilepath
            .replace(/\\/g, "/")
            .split("/")
            .pop()
            ?.replace(/\.md$/, "") || "General";
        return `${DATA_FOLDER}/${listName}`;
    }

    /**
     * Ensure a vault folder exists, creating parents if missing
     */
    static async ensureFolderExists(app: App, folderPath: string): Promise<void> {
        const cleanPath = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
        const existing = app.vault.getAbstractFileByPath(cleanPath);
        if (existing && existing instanceof TFolder) return;

        const parts = cleanPath.split("/");
        let current = "";
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const item = app.vault.getAbstractFileByPath(current);
            if (!item) {
                try {
                    await app.vault.createFolder(current);
                } catch (e) {
                    // Folder may have been created concurrently
                }
            }
        }
    }

    /**
     * Resolve a note link string (e.g. [[Path/Note|Alias]] or Path/Note) to a physical TFile
     */
    static resolveLinkedNoteFile(app: App, noteLink?: string, sourcePath?: string): TFile | null {
        if (!noteLink || !app) return null;
        const clean = noteLink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        if (!clean) return null;

        // 1. Direct path lookup
        let file = app.vault.getAbstractFileByPath(clean);
        if (file instanceof TFile) return file;

        // 2. Direct path with .md extension
        if (!clean.endsWith(".md")) {
            file = app.vault.getAbstractFileByPath(`${clean}.md`);
            if (file instanceof TFile) return file;
        }

        // 3. Resolve via Obsidian metadataCache
        if (app.metadataCache) {
            const cached = app.metadataCache.getFirstLinkpathDest(clean, sourcePath || "");
            if (cached instanceof TFile) return cached;
        }

        return null;
    }

    /**
     * Generate an available non-colliding file path in the target folder
     * Appends (1), (2), etc. if title collisions occur
     */
    static getAvailableNotePath(app: App, targetFolder: string, baseTitle: string): string {
        const candidate = `${targetFolder}/${baseTitle}.md`;
        if (!app.vault.getAbstractFileByPath(candidate)) {
            return candidate;
        }
        let counter = 1;
        while (app.vault.getAbstractFileByPath(`${targetFolder}/${baseTitle} (${counter}).md`)) {
            counter++;
        }
        return `${targetFolder}/${baseTitle} (${counter}).md`;
    }

    /**
     * Create or retrieve the linked note for a task
     */
    static async createOrGetLinkedNote(
        app: App,
        task: TaskItem,
        categoryFilepath: string
    ): Promise<{ file: TFile; noteLink: string; cleanPath: string }> {
        // 1. If task already has a valid linked note on disk, return it
        if (task.note_link) {
            const existingFile = this.resolveLinkedNoteFile(app, task.note_link, categoryFilepath);
            if (existingFile) {
                return {
                    file: existingFile,
                    noteLink: task.note_link,
                    cleanPath: existingFile.path.replace(/\.md$/, ""),
                };
            }
        }

        // 2. Ensure target folder exists
        const targetFolder = this.getTaskNotesFolder(categoryFilepath);
        await this.ensureFolderExists(app, targetFolder);

        // 3. Determine unique filename with collision avoidance
        const baseTitle = this.sanitizeNoteTitle(task.title);
        const finalPath = this.getAvailableNotePath(app, targetFolder, baseTitle);

        // 4. Initial note content with frontmatter metadata & heading
        const noteBody = task.note ? task.note.trim() : "";
        const content = `---\ntaskId: "${task.id}"\n---\n\n# ${task.title}\n\n${noteBody}\n`.trim() + "\n";

        // 5. Create note file in vault
        const file = await app.vault.create(finalPath, content);
        const cleanPath = finalPath.replace(/\.md$/, "");
        const noteLink = `[[${cleanPath}]]`;

        void Logger.log(`[LinkedNote] Created note at ${finalPath} for task ${task.id}`);
        return { file, noteLink, cleanPath };
    }

    /**
     * Synchronize Task Title -> Note Title
     * When task title is modified in Fluent Tasks, renames note file and heading
     */
    static async syncTaskTitleToNote(
        app: App,
        task: TaskItem,
        categoryFilepath: string
    ): Promise<{ newNoteLink?: string; noteRenamed: boolean }> {
        if (!task.note_link) return { noteRenamed: false };

        const file = this.resolveLinkedNoteFile(app, task.note_link, categoryFilepath);
        if (!file) return { noteRenamed: false };

        const cleanNewTitle = this.sanitizeNoteTitle(task.title);
        if (!cleanNewTitle || file.basename === cleanNewTitle) {
            return { noteRenamed: false };
        }

        const parentFolder = file.parent ? file.parent.path : this.getTaskNotesFolder(categoryFilepath);
        let newPath = `${parentFolder}/${cleanNewTitle}.md`;

        // Handle collision if another file occupies this name
        if (newPath !== file.path && app.vault.getAbstractFileByPath(newPath)) {
            let counter = 1;
            while (app.vault.getAbstractFileByPath(`${parentFolder}/${cleanNewTitle} (${counter}).md`)) {
                counter++;
            }
            newPath = `${parentFolder}/${cleanNewTitle} (${counter}).md`;
        }

        if (newPath === file.path) return { noteRenamed: false };

        this.markInternalRename(file.path, newPath);

        try {
            await app.fileManager.renameFile(file, newPath);

            // Update first markdown header if present
            try {
                await app.vault.process(file, (content: string) => {
                    if (/^#\s+[^\r\n]+/m.test(content)) {
                        return content.replace(/^#\s+[^\r\n]+/m, `# ${task.title}`);
                    }
                    return content;
                });
            } catch (e) {
                // Non-critical header update
            }

            const cleanPath = newPath.replace(/\.md$/, "");
            const newNoteLink = `[[${cleanPath}]]`;
            return { newNoteLink, noteRenamed: true };
        } catch (err) {
            Logger.log("Failed to rename linked note file:", err);
            return { noteRenamed: false };
        }
    }

    /**
     * Synchronize Note Rename -> Task Title
     * When note is renamed in Obsidian, updates task title & note_link in real-time
     */
    static async syncNoteRenameToTasks(
        app: App,
        dataService: DataService,
        oldPath: string,
        newFile: TFile
    ): Promise<boolean> {
        if (!newFile || newFile.extension !== "md") return false;

        const oldClean = oldPath.replace(/\.md$/, "");
        const oldBasename = oldClean.split("/").pop() || "";
        const newClean = newFile.path.replace(/\.md$/, "");
        const newTitle = newFile.basename;

        // Check frontmatter taskId if available for instant pinpointing
        const cache = app.metadataCache.getFileCache(newFile);
        const frontmatterTaskId = cache?.frontmatter?.taskId;

        // Get all categories in TodoData
        const categories = await dataService.getCategories();
        let anyUpdated = false;

        for (const cat of categories) {
            let tasks: TaskItem[];
            try {
                tasks = await dataService.getTasks(cat.filepath);
            } catch {
                continue;
            }

            let catChanged = false;
            for (const task of tasks) {
                let isMatch = false;

                if (frontmatterTaskId && task.id === frontmatterTaskId) {
                    isMatch = true;
                } else if (task.note_link) {
                    const taskClean = task.note_link.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
                    if (
                        taskClean === oldClean ||
                        taskClean === oldPath ||
                        taskClean.split("/").pop() === oldBasename
                    ) {
                        isMatch = true;
                    }
                }

                if (isMatch) {
                    task.title = newTitle;
                    task.note_link = `[[${newClean}]]`;
                    catChanged = true;
                    anyUpdated = true;

                    // Update task atomically
                    await dataService.updateTask(cat.filepath, task);
                    EventBus.emit(EventName.TASK_UPDATED, {
                        task,
                        categoryFilepath: cat.filepath,
                    });
                }
            }
        }

        return anyUpdated;
    }
}
