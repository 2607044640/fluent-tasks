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
     * Strip collision disambiguation suffix like ' (1)', ' (2)'
     */
    static stripCollisionSuffix(title: string): string {
        return title.replace(/\s+\(\d+\)$/, "").trim();
    }

    /**
     * Check if a note link is a dedicated hard-bound task note under TodoData/
     */
    static isHardBoundNote(noteLink?: string): boolean {
        if (!noteLink) return false;
        const clean = noteLink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
        return clean.startsWith(`${DATA_FOLDER}/`) || clean.startsWith(`${DATA_FOLDER}\\`);
    }

    /**
     * Open or focus a linked note file in a tab without displacing active view
     */
    static async openLinkedNoteFile(app: App, file: TFile): Promise<void> {
        const leaves = app.workspace.getLeavesOfType("markdown");
        const existingLeaf = leaves.find((l: any) => l.view?.file?.path === file?.path);
        if (existingLeaf) {
            app.workspace.setActiveLeaf(existingLeaf, { focus: true });
        } else {
            const leaf = app.workspace.getLeaf("tab");
            await leaf.openFile(file);
            app.workspace.setActiveLeaf(leaf, { focus: true });
        }
    }

    /**
     * Generate an available non-colliding file path in the target folder
     * Appends (1), (2), etc. if title collisions occur. Ignores currentFilePath if specified.
     */
    static getAvailableNotePath(app: App, targetFolder: string, baseTitle: string, currentFilePath?: string): string {
        const candidate = `${targetFolder}/${baseTitle}.md`;
        const existingFirst = app.vault.getAbstractFileByPath(candidate);
        if (!existingFirst || (currentFilePath && existingFirst.path === currentFilePath)) {
            return candidate;
        }
        let counter = 1;
        while (true) {
            const numberedCandidate = `${targetFolder}/${baseTitle} (${counter}).md`;
            const existingNumbered = app.vault.getAbstractFileByPath(numberedCandidate);
            if (!existingNumbered || (currentFilePath && existingNumbered.path === currentFilePath)) {
                return numberedCandidate;
            }
            counter++;
        }
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
        categoryFilepath: string,
        dataService?: DataService
    ): Promise<{ newNoteLink?: string; noteRenamed: boolean }> {
        if (!task.note_link) return { noteRenamed: false };

        const file = this.resolveLinkedNoteFile(app, task.note_link, categoryFilepath);
        if (!file) return { noteRenamed: false };

        const cleanNewTitle = this.sanitizeNoteTitle(task.title);
        const baseExistingTitle = this.stripCollisionSuffix(file.basename);

        // If base title matches (even if disambiguated with (1), (2)), task title did NOT change
        if (!cleanNewTitle || file.basename === cleanNewTitle || baseExistingTitle === cleanNewTitle) {
            return { noteRenamed: false };
        }

        const parentFolder = file.parent ? file.parent.path : this.getTaskNotesFolder(categoryFilepath);
        const newPath = this.getAvailableNotePath(app, parentFolder, cleanNewTitle, file.path);

        if (newPath === file.path) return { noteRenamed: false };

        this.markInternalRename(file.path, newPath);
        if (dataService) {
            dataService.markInternalWrite(file.path, 3000);
            dataService.markInternalWrite(newPath, 3000);
        }

        try {
            await app.fileManager.renameFile(file, newPath);

            // Update first markdown header if present
            try {
                if (dataService) dataService.markInternalWrite(newPath, 2000);
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
            void Logger.log("Failed to rename linked note file:", err);
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
        const newClean = newFile.path.replace(/\.md$/, "");
        const newTitle = newFile.basename;
        const normalizedOldClean = oldClean.replace(/\\/g, "/");
        const normalizedOldPath = oldPath.replace(/\\/g, "/");

        // Check frontmatter taskId: 1st via metadataCache, 2nd via direct file read fallback
        let frontmatterTaskId = app.metadataCache?.getFileCache(newFile)?.frontmatter?.taskId;
        if (!frontmatterTaskId) {
            try {
                const content = await app.vault.read(newFile);
                const match = content.match(/^---\r?\n[\s\S]*?taskId:\s*["']?([^"'\r\n]+)["']?[\s\S]*?\r?\n---/);
                if (match) {
                    frontmatterTaskId = match[1].trim();
                }
            } catch {
                // Fallback to path matching below
            }
        }

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

            const categoryNotesFolder = this.getTaskNotesFolder(cat.filepath).replace(/\\/g, "/");

            for (const task of tasks) {
                let isMatch = false;

                if (frontmatterTaskId && task.id === frontmatterTaskId) {
                    isMatch = true;
                } else if (task.note_link) {
                    const taskClean = task.note_link.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim().replace(/\\/g, "/");
                    // Exact path match
                    if (taskClean === normalizedOldClean || taskClean === normalizedOldPath || `${taskClean}.md` === normalizedOldPath) {
                        isMatch = true;
                    } else if (!taskClean.includes("/") && normalizedOldPath.startsWith(categoryNotesFolder + "/")) {
                        // Short link without slash: only match if old file belongs to this category's folder
                        const oldBase = normalizedOldClean.split("/").pop();
                        if (taskClean === oldBase) {
                            isMatch = true;
                        }
                    }
                }

                if (isMatch) {
                    task.title = this.stripCollisionSuffix(newTitle) || newTitle;
                    task.note_link = `[[${newClean}]]`;
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

        // Keep the top markdown heading in the note file in sync with the new note title
        try {
            dataService.markInternalWrite(newFile.path, 2000);
            await app.vault.process(newFile, (content: string) => {
                if (/^#\s+[^\r\n]+/m.test(content)) {
                    return content.replace(/^#\s+[^\r\n]+/m, `# ${this.stripCollisionSuffix(newTitle) || newTitle}`);
                }
                return content;
            });
        } catch {
            // Non-critical
        }

        return anyUpdated;
    }
}
