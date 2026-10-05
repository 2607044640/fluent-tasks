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
     * Strips <br>, HTML tags, \r, \n and illegal characters / \\ : * ? " < > |
     */
    static sanitizeNoteTitle(title: string): string {
        if (!title) return "Untitled Note";
        const cleaned = title
            .replace(/<br\s*\/?>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/[\r\n]+/g, " ")
            .replace(/[\\/:*?"<>|]/g, " ")
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
                } catch {
                    // Folder may have been created concurrently
                }
            }
        }
    }

    /**
     * Search for a note file by its YAML frontmatter taskId in category's folder or all DATA_FOLDER
     */
    static findFileByTaskId(app: App, taskId: string, categoryFilepath?: string): TFile | null {
        if (!app || !taskId) return null;

        // 1. Search in category's dedicated notes folder first (fastest & most targeted)
        if (categoryFilepath) {
            const folderPath = this.getTaskNotesFolder(categoryFilepath).replace(/\\/g, "/");
            const folder = app.vault.getAbstractFileByPath(folderPath);
            if (folder && folder instanceof TFolder) {
                for (const child of folder.children) {
                    if (child instanceof TFile && child.extension === "md") {
                        const cache = app.metadataCache?.getFileCache(child);
                        if (cache?.frontmatter?.taskId === taskId) {
                            return child;
                        }
                    }
                }
            }
        }

        // 2. Fallback: Search all markdown files in DATA_FOLDER
        const dataFolder = app.vault.getAbstractFileByPath(DATA_FOLDER);
        if (dataFolder && dataFolder instanceof TFolder) {
            const stack: TFolder[] = [dataFolder];
            while (stack.length > 0) {
                const cur = stack.pop()!;
                for (const child of cur.children) {
                    if (child instanceof TFolder) {
                        stack.push(child);
                    } else if (child instanceof TFile && child.extension === "md") {
                        const cache = app.metadataCache?.getFileCache(child);
                        if (cache?.frontmatter?.taskId === taskId) {
                            return child;
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Async fallback for findFileByTaskId checking file contents directly if metadataCache is stale
     */
    static async findFileByTaskIdAsync(app: App, taskId: string, categoryFilepath?: string): Promise<TFile | null> {
        const syncMatch = this.findFileByTaskId(app, taskId, categoryFilepath);
        if (syncMatch) return syncMatch;

        if (categoryFilepath && app) {
            const folderPath = this.getTaskNotesFolder(categoryFilepath).replace(/\\/g, "/");
            const folder = app.vault.getAbstractFileByPath(folderPath);
            if (folder && folder instanceof TFolder) {
                for (const child of folder.children) {
                    if (child instanceof TFile && child.extension === "md") {
                        try {
                            const content = await app.vault.read(child);
                            const match = content.slice(0, 300).match(/^---\r?\n[\s\S]*?taskId:\s*["']?([^"'\r\n]+)["']?[\s\S]*?\r?\n---/);
                            if (match && match[1].trim() === taskId) {
                                return child;
                            }
                        } catch { /* ignore */ }
                    }
                }
            }
        }
        return null;
    }

    /**
     * Resolve a note link string (e.g. [[Path/Note|Alias]] or Path/Note) to a physical TFile,
     * with automatic fallback to taskId matching if link is stale or broken.
     */
    static resolveLinkedNoteFile(app: App, noteLink?: string, sourcePath?: string, taskId?: string): TFile | null {
        if (!app) return null;
        if (noteLink) {
            const clean = noteLink.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
            if (clean) {
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
            }
        }

        // 4. Fallback: Search by taskId if provided
        if (taskId) {
            const fileByTaskId = this.findFileByTaskId(app, taskId, sourcePath);
            if (fileByTaskId) return fileByTaskId;
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
        // 1. If task already has a valid linked note on disk (or resolvable by taskId), return it
        const existingFile = this.resolveLinkedNoteFile(app, task.note_link, categoryFilepath, task.id)
            || (task.id ? await this.findFileByTaskIdAsync(app, task.id, categoryFilepath) : null);
        if (existingFile) {
            const cleanPath = existingFile.path.replace(/\.md$/, "");
            const noteLink = `[[${cleanPath}]]`;
            return {
                file: existingFile,
                noteLink,
                cleanPath,
            };
        }

        // 2. Ensure target folder exists
        const targetFolder = this.getTaskNotesFolder(categoryFilepath);
        await this.ensureFolderExists(app, targetFolder);

        // 3. Determine unique filename with collision avoidance
        const baseTitle = this.sanitizeNoteTitle(task.title);
        const finalPath = this.getAvailableNotePath(app, targetFolder, baseTitle);

        // 4. Initial note content with frontmatter metadata
        const noteBody = task.note ? task.note.trim() : "";
        const content = noteBody
            ? `---\ntaskId: "${task.id}"\n---\n\n${noteBody}\n`
            : `---\ntaskId: "${task.id}"\n---\n\n`;

        // 5. Create note file in vault
        const file = await app.vault.create(finalPath, content);
        const cleanPath = finalPath.replace(/\.md$/, "");
        const noteLink = `[[${cleanPath}]]`;

        void Logger.log(`[LinkedNote] Created note at ${finalPath} for task ${task.id}`);
        return { file, noteLink, cleanPath };
    }

    /**
     * Synchronize Task Title -> Note Title
     * When task title is modified in Fluent Tasks, renames note file
     */
    static async syncTaskTitleToNote(
        app: App,
        task: TaskItem,
        categoryFilepath: string,
        dataService?: DataService
    ): Promise<{ newNoteLink?: string; noteRenamed: boolean }> {
        if (!task.note_link && !task.id) return { noteRenamed: false };

        let file = this.resolveLinkedNoteFile(app, task.note_link, categoryFilepath, task.id);
        if (!file && task.id) {
            file = await this.findFileByTaskIdAsync(app, task.id, categoryFilepath);
        }
        if (!file) return { noteRenamed: false };

        // Auto-heal task.note_link if it pointed to a stale/broken path
        const currentCleanPath = file.path.replace(/\.md$/, "");
        const expectedNoteLink = `[[${currentCleanPath}]]`;
        let linkHealed = false;
        if (task.note_link !== expectedNoteLink) {
            task.note_link = expectedNoteLink;
            linkHealed = true;
        }

        const cleanNewTitle = this.sanitizeNoteTitle(task.title);
        const baseExistingTitle = this.stripCollisionSuffix(file.basename);

        // If base title matches (even if disambiguated with (1), (2)), task title did NOT change
        if (!cleanNewTitle || file.basename === cleanNewTitle || baseExistingTitle === cleanNewTitle) {
            return { newNoteLink: linkHealed ? expectedNoteLink : undefined, noteRenamed: false };
        }

        const parentFolder = file.parent ? file.parent.path : this.getTaskNotesFolder(categoryFilepath);
        const newPath = this.getAvailableNotePath(app, parentFolder, cleanNewTitle, file.path);

        if (newPath === file.path) {
            return { newNoteLink: linkHealed ? expectedNoteLink : undefined, noteRenamed: false };
        }

        this.markInternalRename(file.path, newPath);
        if (dataService) {
            dataService.markInternalWrite(file.path, 3000);
            dataService.markInternalWrite(newPath, 3000);
            if (categoryFilepath) {
                dataService.markInternalWrite(categoryFilepath, 3000);
            }
        }

        try {
            await app.fileManager.renameFile(file, newPath);

            const cleanPath = newPath.replace(/\.md$/, "");
            const newNoteLink = `[[${cleanPath}]]`;
            return { newNoteLink, noteRenamed: true };
        } catch (err) {
            void Logger.log("Failed to rename linked note file:", err);
            // Check if file was already renamed on disk despite link update error (e.g. EBUSY on category file)
            const checkFile = app.vault.getAbstractFileByPath(newPath);
            if (checkFile instanceof TFile) {
                const cleanPath = newPath.replace(/\.md$/, "");
                return { newNoteLink: `[[${cleanPath}]]`, noteRenamed: true };
            }
            return { newNoteLink: linkHealed ? expectedNoteLink : undefined, noteRenamed: false };
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
                    const cleanNewTitle = this.stripCollisionSuffix(newTitle) || newTitle;

                    // Preserve multi-line structure: if existing task has line breaks (\n or <br>), update only line 1
                    const hasLineBreaks = task.title && (task.title.includes("\n") || /<br\s*\/?>/i.test(task.title));
                    if (hasLineBreaks) {
                        const lines = task.title.split(/\r?\n|<br\s*\/?>/i);
                        lines[0] = cleanNewTitle;
                        task.title = lines.join("\n");
                    } else {
                        task.title = cleanNewTitle;
                    }

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

        return anyUpdated;
    }
}
