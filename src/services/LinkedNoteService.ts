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
     * Extract category name from category filepath
     * e.g. TodoData/编程.md -> 编程
     */
    static getCategoryName(categoryFilepath: string): string {
        return categoryFilepath
            .replace(/\\/g, "/")
            .split("/")
            .pop()
            ?.replace(/\.md$/, "") || "General";
    }

    /**
     * Determine dedicated note directory for a category list
     * e.g. TodoData/安全中转待办.md -> TodoData/安全中转待办
     */
    static getTaskNotesFolder(categoryFilepath: string): string {
        const listName = this.getCategoryName(categoryFilepath);
        return `${DATA_FOLDER}/${listName}`;
    }

    /**
     * Determine standard note path for a task: TodoData/<CategoryName>/<CategoryName> <taskId>.md
     * e.g. TodoData/编程/编程 ge20uj.md
     */
    static getStandardNotePath(categoryFilepath: string, taskId: string): string {
        const categoryName = this.getCategoryName(categoryFilepath);
        const targetFolder = `${DATA_FOLDER}/${categoryName}`;
        return `${targetFolder}/${categoryName} ${taskId}.md`;
    }

    /**
     * Extract task ID from note filename
     * Matches `<CategoryName> <taskId>` where taskId is the last space-separated token
     */
    static extractTaskIdFromFilename(basename: string): string | null {
        const clean = basename.replace(/\.md$/, "").trim();
        const lastSpace = clean.lastIndexOf(" ");
        if (lastSpace === -1) return null;
        const candidate = clean.slice(lastSpace + 1).trim();
        return candidate || null;
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
     * Search for a note file by taskId (checking standard filename ending or YAML frontmatter taskId)
     */
    static findFileByTaskId(app: App, taskId: string, categoryFilepath?: string): TFile | null {
        if (!app || !taskId) return null;

        // 1. Direct standard path lookup if categoryFilepath is provided (O(1))
        if (categoryFilepath) {
            const stdPath = this.getStandardNotePath(categoryFilepath, taskId);
            const file = app.vault.getAbstractFileByPath(stdPath);
            if (file instanceof TFile) return file;
        }

        // 2. Search in category's dedicated notes folder first (fastest & most targeted)
        if (categoryFilepath) {
            const folderPath = this.getTaskNotesFolder(categoryFilepath).replace(/\\/g, "/");
            const folder = app.vault.getAbstractFileByPath(folderPath);
            if (folder && folder instanceof TFolder) {
                for (const child of folder.children) {
                    if (child instanceof TFile && child.extension === "md") {
                        if (child.basename.endsWith(` ${taskId}`)) {
                            return child;
                        }
                        const cache = app.metadataCache?.getFileCache(child);
                        if (cache?.frontmatter?.taskId === taskId) {
                            return child;
                        }
                    }
                }
            }
        }

        // 3. Fallback: Search all markdown files in DATA_FOLDER
        const dataFolder = app.vault.getAbstractFileByPath(DATA_FOLDER);
        if (dataFolder && dataFolder instanceof TFolder) {
            const stack: TFolder[] = [dataFolder];
            while (stack.length > 0) {
                const cur = stack.pop()!;
                for (const child of cur.children) {
                    if (child instanceof TFolder) {
                        stack.push(child);
                    } else if (child instanceof TFile && child.extension === "md") {
                        if (child.basename.endsWith(` ${taskId}`)) {
                            return child;
                        }
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
                        if (child.basename.endsWith(` ${taskId}`)) {
                            return child;
                        }
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
     * Sanitize a linkpath string to ensure it contains no illegal characters like drive letters (C:)
     * or backslashes before being passed to Obsidian workspace APIs.
     */
    static sanitizeLinkpath(raw?: string): string {
        if (!raw) return "";
        let clean = raw.trim()
            .replace(/^\[\[/, "")
            .replace(/\]\]$/, "")
            .split("|")[0]
            .trim()
            .replace(/\\/g, "/")
            .replace(/\/+/g, "/")
            .replace(/^["']|["']$/g, "")
            .replace(/^[\s\-—–_•*#~]+\s*/, "")
            .trim();

        // If it starts with Windows drive letter like C:/, strip it
        clean = clean.replace(/^[a-zA-Z]:\//, "");
        return clean;
    }

    /**
     * Normalize a note link input for saving in task metadata:
     * Returns a clean wikilink `[[path]]`.
     */
    static normalizeNoteLinkInput(raw?: string): string {
        if (!raw) return "";
        const clean = this.sanitizeLinkpath(raw);
        if (!clean) return "";
        const noExt = clean.replace(/\.md$/, "");
        return `[[${noExt}]]`;
    }

    /**
     * Internal multi-stage resolution from raw note link string or filename query
     */
    static resolveNoteLinkInternal(app: App, raw: string, sourcePath?: string): TFile | null {
        if (!app || !raw) return null;

        // 1. Clean brackets, aliases, anchors, and normalize slashes
        let cleaned = raw.trim();
        // Extract from markdown link [title](path) if present
        const mdLinkMatch = cleaned.match(/^\[(.*?)\]\((.*?)\)$/);
        if (mdLinkMatch) {
            cleaned = mdLinkMatch[2].trim() || mdLinkMatch[1].trim();
        }
        // Strip wikilink brackets
        cleaned = cleaned.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
        // Strip alias
        cleaned = cleaned.split("|")[0].trim();
        // Strip heading anchor or block anchor
        cleaned = cleaned.split("#")[0].split("^")[0].trim();
        // Replace Windows backslashes with forward slashes
        cleaned = cleaned.replace(/\\/g, "/");
        // Collapse multiple slashes
        cleaned = cleaned.replace(/\/+/g, "/");
        // Strip outer quotes
        cleaned = cleaned.replace(/^["']|["']$/g, "").trim();

        if (!cleaned) return null;

        // 2. Strip Absolute Filesystem Root (Vault Base Path or Drive Letters)
        let relativeCandidate = cleaned;
        try {
            const adapter = app.vault.adapter as any;
            const basePath = (adapter?.basePath || adapter?.path || "").replace(/\\/g, "/").replace(/\/+$/, "");
            if (basePath && relativeCandidate.toLowerCase().startsWith(basePath.toLowerCase())) {
                relativeCandidate = relativeCandidate.slice(basePath.length).replace(/^\/+/, "");
            } else {
                // Check for Windows drive letter e.g. C:/...
                const driveMatch = relativeCandidate.match(/^[a-zA-Z]:\/(.*)$/);
                if (driveMatch) {
                    const afterDrive = driveMatch[1];
                    const vaultName = app.vault.getName();
                    if (vaultName && afterDrive.toLowerCase().startsWith(`${vaultName.toLowerCase()}/`)) {
                        relativeCandidate = afterDrive.slice(vaultName.length + 1).replace(/^\/+/, "");
                    } else {
                        relativeCandidate = afterDrive;
                    }
                }
            }
        } catch {
            // fallback if adapter throws
        }
        relativeCandidate = relativeCandidate.replace(/^\/+/, "");

        // 3. Stage 1: Direct vault path lookup (O(1))
        if (relativeCandidate) {
            let file = app.vault.getAbstractFileByPath(relativeCandidate);
            if (file instanceof TFile) return file;

            if (!relativeCandidate.endsWith(".md")) {
                file = app.vault.getAbstractFileByPath(`${relativeCandidate}.md`);
                if (file instanceof TFile) return file;
            } else {
                file = app.vault.getAbstractFileByPath(relativeCandidate.replace(/\.md$/, ""));
                if (file instanceof TFile) return file;
            }
        }

        // 4. Stage 2: Obsidian metadataCache linkpath lookup
        if (app.metadataCache && relativeCandidate) {
            let cached = app.metadataCache.getFirstLinkpathDest(relativeCandidate, sourcePath || "");
            if (cached instanceof TFile) return cached;

            const noExt = relativeCandidate.replace(/\.md$/, "");
            if (noExt !== relativeCandidate) {
                cached = app.metadataCache.getFirstLinkpathDest(noExt, sourcePath || "");
                if (cached instanceof TFile) return cached;
            }
        }

        // 5. Stage 3: Handle stripped prefix candidates (leading -, ——, —, •, *, #, ~)
        const strippedPrefix = relativeCandidate.replace(/^[\s\-—–_•*#~]+\s*/, "").trim();
        if (strippedPrefix && strippedPrefix !== relativeCandidate) {
            let file = app.vault.getAbstractFileByPath(strippedPrefix);
            if (file instanceof TFile) return file;
            if (!strippedPrefix.endsWith(".md")) {
                file = app.vault.getAbstractFileByPath(`${strippedPrefix}.md`);
                if (file instanceof TFile) return file;
            }
            if (app.metadataCache) {
                const cached = app.metadataCache.getFirstLinkpathDest(strippedPrefix, sourcePath || "");
                if (cached instanceof TFile) return cached;
            }
        }

        // 6. Stage 4: Vault-wide scan across all markdown files ("自动寻找第一个找到的笔记")
        const allMdFiles = app.vault.getMarkdownFiles();
        if (!allMdFiles || allMdFiles.length === 0) return null;

        // Extract segments for comparison
        const lastSegment = relativeCandidate.split("/").pop() || relativeCandidate;
        const candidateBasename = lastSegment.replace(/\.md$/i, "").trim();
        const cleanCandidateBasename = candidateBasename.replace(/^[\s\-—–_•*#~]+\s*/, "").trim();
        const lowerCleanBasename = cleanCandidateBasename.toLowerCase();
        const lowerRelative = relativeCandidate.toLowerCase().replace(/\.md$/i, "");

        // 6a. Priority A: Path ending match (e.g. C:/ObsidianNote/OneNote/... ends with file.path)
        if (relativeCandidate.includes("/")) {
            for (const file of allMdFiles) {
                const filePathLower = file.path.toLowerCase();
                const filePathNoExt = filePathLower.replace(/\.md$/, "");
                if (filePathLower === lowerRelative || filePathNoExt === lowerRelative) {
                    return file;
                }
                if (cleaned.toLowerCase().endsWith(filePathLower) || cleaned.toLowerCase().endsWith(filePathNoExt)) {
                    return file;
                }
                if (filePathLower.endsWith(lowerRelative) || filePathNoExt.endsWith(lowerRelative)) {
                    return file;
                }
            }
        }

        // 6b. Priority B: Exact basename match
        if (cleanCandidateBasename) {
            for (const file of allMdFiles) {
                if (file.basename === cleanCandidateBasename || file.basename === candidateBasename) {
                    return file;
                }
            }
        }

        // 6c. Priority C: Case-insensitive basename match
        if (lowerCleanBasename) {
            for (const file of allMdFiles) {
                if (file.basename.toLowerCase() === lowerCleanBasename || file.basename.toLowerCase() === candidateBasename.toLowerCase()) {
                    return file;
                }
            }
        }

        // 6d. Priority D: Normalized CJK / Punctuation match (ignoring colons, dashes, spaces, full-width vs half-width)
        // e.g. "休闲采集与猫咪料理循环设计：轻量星露谷时钟" vs "休闲采集与猫咪料理循环设计:轻量星露谷时钟"
        const normTarget = cleanCandidateBasename.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
        if (normTarget && normTarget.length >= 2) {
            for (const file of allMdFiles) {
                const normFile = file.basename.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
                if (normFile === normTarget) {
                    return file;
                }
            }
        }

        // 6e. Priority E: Substring match (either file.basename contains target or target contains file.basename)
        if (lowerCleanBasename && lowerCleanBasename.length >= 3) {
            for (const file of allMdFiles) {
                const fileBaseLower = file.basename.toLowerCase();
                if (fileBaseLower.includes(lowerCleanBasename)) {
                    return file;
                }
            }
            for (const file of allMdFiles) {
                const fileBaseLower = file.basename.toLowerCase();
                if (fileBaseLower.length >= 4 && lowerCleanBasename.includes(fileBaseLower)) {
                    return file;
                }
            }
        }

        if (normTarget && normTarget.length >= 4) {
            for (const file of allMdFiles) {
                const normFile = file.basename.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
                if (normFile.length >= 4 && (normFile.includes(normTarget) || normTarget.includes(normFile))) {
                    return file;
                }
            }
        }

        return null;
    }

    /**
     * Resolve a note link string (e.g. [[Path/Note|Alias]] or Path/Note or bare note title) to a physical TFile,
     * with automatic fallback to taskId matching if link is stale or broken.
     */
    static resolveLinkedNoteFile(app: App, noteLink?: string, sourcePath?: string, taskId?: string): TFile | null {
        if (!app) return null;

        // 1. If noteLink is provided, attempt multi-stage resolution first (highest priority)
        if (noteLink && typeof noteLink === "string") {
            const raw = noteLink.trim();
            if (raw) {
                const resolved = this.resolveNoteLinkInternal(app, raw, sourcePath);
                if (resolved) return resolved;
            }
        }

        // 2. Fallback: Direct standard path lookup if sourcePath and taskId are known (O(1))
        if (sourcePath && taskId) {
            const stdPath = this.getStandardNotePath(sourcePath, taskId);
            const stdFile = app.vault.getAbstractFileByPath(stdPath);
            if (stdFile instanceof TFile) return stdFile;
        }

        // 3. Fallback: Search by taskId if provided
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
     * Update frontmatter title property in note file, removing legacy taskId property
     */
    static async updateNoteFrontmatterTitle(app: App, file: TFile, title: string): Promise<void> {
        try {
            await app.fileManager.processFrontMatter(file, (fm) => {
                fm.title = title;
                if ("taskId" in fm) {
                    delete fm.taskId;
                }
            });
        } catch (err) {
            // Fallback via vault.process if processFrontMatter throws
            await app.vault.process(file, (content) => {
                const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---/;
                const match = content.match(fmRegex);
                const escapedTitle = JSON.stringify(title);
                if (match) {
                    let lines = match[1].split(/\r?\n/).filter(l => !l.trim().startsWith("taskId:"));
                    const titleIdx = lines.findIndex(l => l.trim().startsWith("title:"));
                    if (titleIdx >= 0) {
                        lines[titleIdx] = `title: ${escapedTitle}`;
                    } else {
                        lines.push(`title: ${escapedTitle}`);
                    }
                    return content.replace(fmRegex, `---\n${lines.join("\n")}\n---`);
                } else {
                    return `---\ntitle: ${escapedTitle}\n---\n\n${content}`;
                }
            });
        }
    }

    /**
     * Create or retrieve the linked note for a task.
     * Note file format: TodoData/<CategoryName>/<CategoryName> <taskId>.md
     * Frontmatter contains `title: <taskTitle>` property.
     */
    static async createOrGetLinkedNote(
        app: App,
        task: TaskItem,
        categoryFilepath: string
    ): Promise<{ file: TFile; noteLink: string; cleanPath: string }> {
        const categoryName = this.getCategoryName(categoryFilepath);
        const standardPath = this.getStandardNotePath(categoryFilepath, task.id);

        // 1. Check if standard note file already exists
        const stdFile = app.vault.getAbstractFileByPath(standardPath);
        if (stdFile instanceof TFile) {
            const cleanPath = stdFile.path.replace(/\.md$/, "");
            const noteLink = `[[${cleanPath}]]`;
            return { file: stdFile, noteLink, cleanPath };
        }

        // 2. Check if an existing note exists via link or taskId (e.g. old note format)
        const existingFile = this.resolveLinkedNoteFile(app, task.note_link, categoryFilepath, task.id)
            || (task.id ? await this.findFileByTaskIdAsync(app, task.id, categoryFilepath) : null);

        if (existingFile) {
            // If it's an internal note under DATA_FOLDER with a non-standard path, migrate it to standardPath!
            if (existingFile.path.startsWith(`${DATA_FOLDER}/`) && existingFile.path !== standardPath) {
                await this.ensureFolderExists(app, this.getTaskNotesFolder(categoryFilepath));
                this.markInternalRename(existingFile.path, standardPath);
                try {
                    await app.fileManager.renameFile(existingFile, standardPath);
                    const renamedFile = app.vault.getAbstractFileByPath(standardPath);
                    if (renamedFile instanceof TFile) {
                        await this.updateNoteFrontmatterTitle(app, renamedFile, task.title);
                        const cleanPath = standardPath.replace(/\.md$/, "");
                        const noteLink = `[[${cleanPath}]]`;
                        return { file: renamedFile, noteLink, cleanPath };
                    }
                } catch (err) {
                    void Logger.log(`[LinkedNote] Failed to rename old note to standard path:`, err);
                }
            }
            const cleanPath = existingFile.path.replace(/\.md$/, "");
            const noteLink = `[[${cleanPath}]]`;
            return { file: existingFile, noteLink, cleanPath };
        }

        // 3. Ensure target folder exists
        const targetFolder = this.getTaskNotesFolder(categoryFilepath);
        await this.ensureFolderExists(app, targetFolder);

        // 4. Initial note content with frontmatter title property
        const escapedTitle = JSON.stringify(task.title || "");
        const noteBody = task.note ? task.note.trim() : "";
        const content = noteBody
            ? `---\ntitle: ${escapedTitle}\n---\n\n${noteBody}\n`
            : `---\ntitle: ${escapedTitle}\n---\n\n`;

        // 5. Create note file in vault at standardPath
        const file = await app.vault.create(standardPath, content);
        const cleanPath = standardPath.replace(/\.md$/, "");
        const noteLink = `[[${cleanPath}]]`;

        void Logger.log(`[LinkedNote] Created note at ${standardPath} for task ${task.id}`);
        return { file, noteLink, cleanPath };
    }

    /**
     * Synchronize Task Title -> Note Property
     * When task title is modified in Fluent Tasks:
     * - Does NOT rename the note file on disk! (Filename stays `<Category> <taskId>.md`)
     * - Only updates the YAML frontmatter `title` property in the note.
     * - Auto-migrates legacy non-standard notes if found.
     */
    static async syncTaskTitleToNote(
        app: App,
        task: TaskItem,
        categoryFilepath: string,
        dataService?: DataService
    ): Promise<{ newNoteLink?: string; noteRenamed: boolean }> {
        if (!task.note_link && !task.id) return { noteRenamed: false };

        const standardPath = this.getStandardNotePath(categoryFilepath, task.id);
        let file = this.resolveLinkedNoteFile(app, task.note_link, categoryFilepath, task.id);
        if (!file && task.id) {
            file = await this.findFileByTaskIdAsync(app, task.id, categoryFilepath);
        }
        if (!file) return { noteRenamed: false };

        let noteRenamed = false;
        // If file is an internal note under DATA_FOLDER at a non-standard path, rename to standardPath
        if (file.path.startsWith(`${DATA_FOLDER}/`) && file.path !== standardPath) {
            const targetFolder = this.getTaskNotesFolder(categoryFilepath);
            await this.ensureFolderExists(app, targetFolder);
            this.markInternalRename(file.path, standardPath);
            if (dataService) {
                dataService.markInternalWrite(file.path, 3000);
                dataService.markInternalWrite(standardPath, 3000);
                if (categoryFilepath) dataService.markInternalWrite(categoryFilepath, 3000);
            }
            try {
                await app.fileManager.renameFile(file, standardPath);
                const renamed = app.vault.getAbstractFileByPath(standardPath);
                if (renamed instanceof TFile) file = renamed;
                noteRenamed = true;
            } catch (err) {
                void Logger.log("[LinkedNote] Failed to rename old note to standard path:", err);
            }
        }

        // Auto-heal task.note_link to standard link ONLY for internal notes
        let linkHealed = false;
        if (file.path.startsWith(`${DATA_FOLDER}/`)) {
            const cleanPath = file.path.replace(/\.md$/, "");
            const expectedNoteLink = `[[${cleanPath}]]`;
            if (task.note_link !== expectedNoteLink) {
                task.note_link = expectedNoteLink;
                linkHealed = true;
            }

            // Update YAML frontmatter title property (No disk file rename needed!)
            if (dataService) {
                dataService.markInternalWrite(file.path, 3000);
            }
            await this.updateNoteFrontmatterTitle(app, file, task.title);
        }

        return {
            newNoteLink: (noteRenamed || linkHealed) ? task.note_link : undefined,
            noteRenamed,
        };
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
                    const fmTitle = app.metadataCache?.getFileCache(newFile)?.frontmatter?.title;
                    const isStandardIdFilename = newTitle.endsWith(` ${task.id}`);
                    if (!isStandardIdFilename && fmTitle === undefined) {
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
                    } else if (fmTitle && typeof fmTitle === "string" && fmTitle.trim() && task.title !== fmTitle.trim()) {
                        task.title = fmTitle.trim();
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

    /**
     * Synchronize Note Frontmatter Property -> Task Title
     * When note frontmatter is modified in Obsidian, updates task.title in real-time
     */
    static async syncNotePropertyToTask(
        app: App,
        dataService: DataService,
        file: TFile
    ): Promise<boolean> {
        if (!file || file.extension !== "md") return false;
        const normalizedPath = file.path.replace(/\\/g, "/");
        if (!normalizedPath.startsWith(DATA_FOLDER + "/")) return false;
        const parts = normalizedPath.slice(DATA_FOLDER.length + 1).split("/");
        if (parts.length < 2) return false; // Directly in TodoData root (category list file) -> skip

        const categoryName = parts[0];
        const categoryFilepath = `${DATA_FOLDER}/${categoryName}.md`;

        // 1. Get note frontmatter title property
        let noteTitle: string | undefined = app.metadataCache?.getFileCache(file)?.frontmatter?.title;
        let oldTaskId: string | undefined = app.metadataCache?.getFileCache(file)?.frontmatter?.taskId;

        if (noteTitle === undefined && oldTaskId === undefined) {
            try {
                const raw = await app.vault.read(file);
                const matchTitle = raw.match(/^---\r?\n[\s\S]*?title:\s*["']?([^"'\r\n]+)["']?[\s\S]*?\r?\n---/);
                if (matchTitle) noteTitle = matchTitle[1].trim();
                const matchTask = raw.match(/^---\r?\n[\s\S]*?taskId:\s*["']?([^"'\r\n]+)["']?[\s\S]*?\r?\n---/);
                if (matchTask) oldTaskId = matchTask[1].trim();
            } catch {
                return false;
            }
        }

        if (noteTitle === undefined) return false;

        // 2. Identify task ID: either from frontmatter taskId (old) or filename ending (new)
        const taskId = oldTaskId || this.extractTaskIdFromFilename(file.basename);
        if (!taskId) return false;

        // 3. Find the task in category
        let tasks: TaskItem[];
        try {
            tasks = await dataService.getTasks(categoryFilepath);
        } catch {
            return false;
        }

        let targetTask = tasks.find(t => t.id === taskId);
        let targetCatPath = categoryFilepath;

        if (!targetTask) {
            const categories = await dataService.getCategories();
            for (const cat of categories) {
                if (cat.filepath === categoryFilepath) continue;
                try {
                    const catTasks = await dataService.getTasks(cat.filepath);
                    const found = catTasks.find(t => t.id === taskId);
                    if (found) {
                        targetTask = found;
                        targetCatPath = cat.filepath;
                        break;
                    }
                } catch { /* ignore */ }
            }
        }

        if (!targetTask) return false;

        // 4. If title differs, update task title
        if (targetTask.title !== noteTitle) {
            targetTask.title = noteTitle;
            dataService.markInternalWrite(targetCatPath, 3000);
            await dataService.updateTask(targetCatPath, targetTask);
            EventBus.emit(EventName.TASK_UPDATED, {
                task: targetTask,
                categoryFilepath: targetCatPath,
            });
            void Logger.log(`[LinkedNote] Synced note frontmatter title "${noteTitle}" to task ${targetTask.id}`);
            return true;
        }

        return false;
    }

    /**
     * Handle category list rename:
     * When a list (Category) name changes from OldName to NewName:
     * 1. Renames dedicated note folder TodoData/OldName -> TodoData/NewName
     * 2. Renames all notes inside from `<OldName> <taskId>.md` -> `<NewName> <taskId>.md`
     * 3. Updates `note_link` in tasks of the renamed category file
     * 4. Updates open markdown tabs if any were open
     */
    static async handleCategoryRename(
        app: App,
        dataService: DataService,
        oldCategoryFilepath: string,
        newCategoryFilepath: string
    ): Promise<{ renamedNotesCount: number; updatedTasksCount: number }> {
        const oldName = this.getCategoryName(oldCategoryFilepath);
        const newName = this.getCategoryName(newCategoryFilepath);
        if (oldName === newName) return { renamedNotesCount: 0, updatedTasksCount: 0 };

        const oldNotesFolderPath = `${DATA_FOLDER}/${oldName}`.replace(/\\/g, "/");
        const newNotesFolderPath = `${DATA_FOLDER}/${newName}`.replace(/\\/g, "/");

        let renamedNotesCount = 0;
        let updatedTasksCount = 0;

        // 1. Rename folder if it exists
        const oldFolder = app.vault.getAbstractFileByPath(oldNotesFolderPath);
        const newFolder = app.vault.getAbstractFileByPath(newNotesFolderPath);

        if (oldFolder && oldFolder instanceof TFolder) {
            if (!newFolder) {
                this.markInternalRename(oldNotesFolderPath, newNotesFolderPath);
                dataService.markInternalWrite(oldNotesFolderPath, 4000);
                dataService.markInternalWrite(newNotesFolderPath, 4000);
                try {
                    await app.fileManager.renameFile(oldFolder, newNotesFolderPath);
                    void Logger.log(`[LinkedNote] Renamed category folder: ${oldNotesFolderPath} -> ${newNotesFolderPath}`);
                } catch (e) {
                    void Logger.log(`[LinkedNote] Error renaming folder ${oldNotesFolderPath} to ${newNotesFolderPath}:`, e);
                }
            } else if (newFolder instanceof TFolder) {
                // Target folder already exists: move children
                const children = [...oldFolder.children];
                for (const child of children) {
                    if (child instanceof TFile && child.extension === "md") {
                        const targetPath = `${newNotesFolderPath}/${child.name}`;
                        this.markInternalRename(child.path, targetPath);
                        dataService.markInternalWrite(child.path, 4000);
                        dataService.markInternalWrite(targetPath, 4000);
                        try {
                            await app.fileManager.renameFile(child, targetPath);
                        } catch (e) {
                            void Logger.log(`[LinkedNote] Error moving child file ${child.path}:`, e);
                        }
                    }
                }
                if (oldFolder.children.length === 0) {
                    try {
                        await app.fileManager.trashFile(oldFolder);
                    } catch {}
                }
            }
        }

        // 2. Auto-sync all tasks & notes in the new category
        const syncRes = await this.autoSyncCategoryLinkedNotes(app, dataService, newCategoryFilepath);
        renamedNotesCount += syncRes.healedNotesCount;
        updatedTasksCount += syncRes.updatedTasksCount;

        return { renamedNotesCount, updatedTasksCount };
    }

    /**
     * Auto-detect and heal all tasks and linked notes in a category:
     * - Scans all tasks in the category file
     * - For each task with a linked note (or matching taskId):
     *   Ensures the note file is named `<CategoryName> <taskId>.md` inside `TodoData/<CategoryName>/`
     *   If named after an old list name or in an old folder, renames it to standard path
     *   Ensures `task.note_link` points to standard wikilink `[[TodoData/<CategoryName>/<CategoryName> <taskId>]]`
     * - Scans `TodoData/<CategoryName>/` folder for any notes with stale list prefixes and updates them
     */
    static async autoSyncCategoryLinkedNotes(
        app: App,
        dataService: DataService,
        categoryFilepath: string
    ): Promise<{ healedNotesCount: number; updatedTasksCount: number }> {
        const categoryName = this.getCategoryName(categoryFilepath);
        const targetFolderPath = this.getTaskNotesFolder(categoryFilepath).replace(/\\/g, "/");

        let healedNotesCount = 0;
        let updatedTasksCount = 0;

        let tasks: TaskItem[];
        try {
            tasks = await dataService.getTasks(categoryFilepath);
        } catch {
            return { healedNotesCount: 0, updatedTasksCount: 0 };
        }

        let tasksChanged = false;

        // 1. Check each task in category
        for (const task of tasks) {
            // CRITICAL: Skip external linked notes (e.g. in OneNote/) - never rename or move them
            if (task.note_link && !this.isHardBoundNote(task.note_link)) {
                continue;
            }

            const standardPath = this.getStandardNotePath(categoryFilepath, task.id);
            const standardClean = standardPath.replace(/\.md$/, "");
            const standardNoteLink = `[[${standardClean}]]`;

            let noteFile = app.vault.getAbstractFileByPath(standardPath);
            if (!(noteFile instanceof TFile)) {
                noteFile = this.resolveLinkedNoteFile(app, task.note_link, categoryFilepath, task.id)
                    || (task.id ? await this.findFileByTaskIdAsync(app, task.id, categoryFilepath) : null);
            }

            if (noteFile instanceof TFile && noteFile.path.startsWith(`${DATA_FOLDER}/`)) {
                if (noteFile.path !== standardPath) {
                    await this.ensureFolderExists(app, targetFolderPath);
                    this.markInternalRename(noteFile.path, standardPath);
                    dataService.markInternalWrite(noteFile.path, 4000);
                    dataService.markInternalWrite(standardPath, 4000);
                    dataService.markInternalWrite(categoryFilepath, 4000);
                    try {
                        await app.fileManager.renameFile(noteFile, standardPath);
                        healedNotesCount++;
                        void Logger.log(`[LinkedNote AutoSync] Renamed note: ${noteFile.path} -> ${standardPath}`);
                    } catch (e) {
                        void Logger.log(`[LinkedNote AutoSync] Failed to rename ${noteFile.path} to ${standardPath}:`, e);
                    }
                }

                if (task.note_link !== standardNoteLink) {
                    task.note_link = standardNoteLink;
                    tasksChanged = true;
                    updatedTasksCount++;
                }

                const freshFile = app.vault.getAbstractFileByPath(standardPath);
                if (freshFile instanceof TFile) {
                    const cache = app.metadataCache?.getFileCache(freshFile);
                    if (cache?.frontmatter?.title === undefined && task.title) {
                        await this.updateNoteFrontmatterTitle(app, freshFile, task.title);
                    }
                }
            }
        }

        // 2. Scan notes folder directly for any notes whose filename doesn't start with categoryName
        const targetFolder = app.vault.getAbstractFileByPath(targetFolderPath);
        if (targetFolder && targetFolder instanceof TFolder) {
            const children = [...targetFolder.children];
            for (const child of children) {
                if (!(child instanceof TFile) || child.extension !== "md") continue;

                let taskId = this.extractTaskIdFromFilename(child.basename);
                if (!taskId) {
                    const cache = app.metadataCache?.getFileCache(child);
                    taskId = cache?.frontmatter?.taskId || null;
                }
                if (!taskId) {
                    try {
                        const raw = await app.vault.read(child);
                        const m = raw.slice(0, 500).match(/^---\r?\n[\s\S]*?taskId:\s*["']?([^"'\r\n]+)["']?[\s\S]*?\r?\n---/);
                        if (m) taskId = m[1].trim();
                    } catch {}
                }

                if (taskId) {
                    const expectedBasename = `${categoryName} ${taskId}`;
                    const expectedPath = `${targetFolderPath}/${expectedBasename}.md`;
                    if (child.path !== expectedPath) {
                        this.markInternalRename(child.path, expectedPath);
                        dataService.markInternalWrite(child.path, 4000);
                        dataService.markInternalWrite(expectedPath, 4000);
                        try {
                            await app.fileManager.renameFile(child, expectedPath);
                            healedNotesCount++;
                            void Logger.log(`[LinkedNote AutoSync] Re-aligned folder note: ${child.path} -> ${expectedPath}`);
                        } catch (e) {
                            void Logger.log(`[LinkedNote AutoSync] Error re-aligning ${child.path}:`, e);
                        }
                    }

                    const matchingTask = tasks.find(t => t.id === taskId);
                    if (matchingTask) {
                        const cleanPath = expectedPath.replace(/\.md$/, "");
                        const expectedLink = `[[${cleanPath}]]`;
                        if (matchingTask.note_link !== expectedLink) {
                            matchingTask.note_link = expectedLink;
                            tasksChanged = true;
                            updatedTasksCount++;
                        }
                    }
                }
            }
        }

        if (tasksChanged) {
            dataService.markInternalWrite(categoryFilepath, 4000);
            await dataService.saveTasks(categoryFilepath, tasks);
            EventBus.emit(EventName.TASK_UPDATED, { categoryFilepath });
        }

        return { healedNotesCount, updatedTasksCount };
    }

    /**
     * Handle moving a task from one category to another:
     * If the task has a linked note, moves/renames it from:
     * TodoData/<SourceCategory>/<SourceCategory> <taskId>.md ->
     * TodoData/<TargetCategory>/<TargetCategory> <taskId>.md
     * And updates task.note_link accordingly.
     */
    static async handleTaskMove(
        app: App,
        dataService: DataService,
        task: TaskItem,
        sourceCategoryFilepath: string,
        targetCategoryFilepath: string
    ): Promise<boolean> {
        if (sourceCategoryFilepath === targetCategoryFilepath) return false;
        const sourceCatName = this.getCategoryName(sourceCategoryFilepath);
        const targetCatName = this.getCategoryName(targetCategoryFilepath);
        if (sourceCatName === targetCatName) return false;

        // CRITICAL: Skip external linked notes (e.g. in OneNote/) - never rename or move them
        if (task.note_link && !this.isHardBoundNote(task.note_link)) {
            return false;
        }

        const noteFile = this.resolveLinkedNoteFile(app, task.note_link, sourceCategoryFilepath, task.id)
            || (task.id ? await this.findFileByTaskIdAsync(app, task.id, sourceCategoryFilepath) : null);

        if (!noteFile || !(noteFile instanceof TFile) || !noteFile.path.startsWith(`${DATA_FOLDER}/`)) return false;

        const targetFolder = this.getTaskNotesFolder(targetCategoryFilepath);
        await this.ensureFolderExists(app, targetFolder);

        const newStandardPath = this.getStandardNotePath(targetCategoryFilepath, task.id);
        if (noteFile.path === newStandardPath) return false;

        this.markInternalRename(noteFile.path, newStandardPath);
        dataService.markInternalWrite(noteFile.path, 4000);
        dataService.markInternalWrite(newStandardPath, 4000);
        try {
            await app.fileManager.renameFile(noteFile, newStandardPath);
            const cleanPath = newStandardPath.replace(/\.md$/, "");
            task.note_link = `[[${cleanPath}]]`;
            void Logger.log(`[LinkedNote] Moved task note: ${noteFile.path} -> ${newStandardPath}`);
            return true;
        } catch (e) {
            void Logger.log(`[LinkedNote] Failed to move note on task move:`, e);
            return false;
        }
    }

    /**
     * Automatically scan and migrate legacy linked notes:
     * - Detects old documents by checking if frontmatter has `taskId`
     * - Replaces `taskId` with `title: <taskTitle>` in YAML frontmatter
     * - Renames file to standard format: `<CategoryName> <taskId>.md`
     * - Updates corresponding task's `note_link` to standard wikilink
     * - Auto-syncs all categories to ensure note filenames match current category names
     */
    static async migrateOldLinkedNotes(
        app: App,
        dataService: DataService
    ): Promise<{ migratedCount: number; details: string[] }> {
        const details: string[] = [];
        let migratedCount = 0;

        const dataFolder = app.vault.getAbstractFileByPath(DATA_FOLDER);
        if (!dataFolder || !(dataFolder instanceof TFolder)) {
            return { migratedCount: 0, details: [] };
        }

        for (const child of dataFolder.children) {
            if (!(child instanceof TFolder)) continue; // skip root category files
            const categoryName = child.name;
            const categoryFilepath = `${DATA_FOLDER}/${categoryName}.md`;

            for (const noteFile of child.children) {
                if (!(noteFile instanceof TFile) || noteFile.extension !== "md") continue;

                // Check if file has taskId in frontmatter
                let oldTaskId: string | null = app.metadataCache?.getFileCache(noteFile)?.frontmatter?.taskId ?? null;
                if (!oldTaskId) {
                    try {
                        const raw = await app.vault.read(noteFile);
                        const m = raw.slice(0, 500).match(/^---\r?\n[\s\S]*?taskId:\s*["']?([^"'\r\n]+)["']?[\s\S]*?\r?\n---/);
                        if (m) oldTaskId = m[1].trim();
                    } catch { /* ignore */ }
                }

                if (!oldTaskId) continue; // Not a legacy document with taskId

                // LEGACY DOCUMENT DETECTED!
                const standardFilename = `${categoryName} ${oldTaskId}.md`;
                const standardPath = `${child.path}/${standardFilename}`;

                // 1. Locate corresponding task
                let targetTask: TaskItem | null = null;
                let targetCatPath = categoryFilepath;
                try {
                    const tasks = await dataService.getTasks(categoryFilepath);
                    targetTask = tasks.find(t => t.id === oldTaskId) ?? null;
                } catch { /* ignore */ }

                if (!targetTask) {
                    const allCats = await dataService.getCategories();
                    for (const cat of allCats) {
                        if (cat.filepath === categoryFilepath) continue;
                        try {
                            const tasks = await dataService.getTasks(cat.filepath);
                            const found = tasks.find(t => t.id === oldTaskId);
                            if (found) {
                                targetTask = found;
                                targetCatPath = cat.filepath;
                                break;
                            }
                        } catch { /* ignore */ }
                    }
                }

                const taskTitle = targetTask ? targetTask.title : noteFile.basename;

                // 2. Update frontmatter: replace taskId with title
                await this.updateNoteFrontmatterTitle(app, noteFile, taskTitle);

                // 3. Rename file if path differs
                let finalFile = noteFile;
                if (noteFile.path !== standardPath) {
                    this.markInternalRename(noteFile.path, standardPath);
                    dataService.markInternalWrite(noteFile.path, 4000);
                    dataService.markInternalWrite(standardPath, 4000);
                    try {
                        await app.fileManager.renameFile(noteFile, standardPath);
                        const renamed = app.vault.getAbstractFileByPath(standardPath);
                        if (renamed instanceof TFile) finalFile = renamed;
                    } catch (err) {
                        void Logger.log(`[LinkedNote Migration] Failed to rename ${noteFile.path} to ${standardPath}:`, err);
                    }
                }

                // 4. Update task note_link
                if (targetTask) {
                    const cleanPath = finalFile.path.replace(/\.md$/, "");
                    const newNoteLink = `[[${cleanPath}]]`;
                    if (targetTask.note_link !== newNoteLink) {
                        targetTask.note_link = newNoteLink;
                        dataService.markInternalWrite(targetCatPath, 4000);
                        await dataService.updateTask(targetCatPath, targetTask);
                        EventBus.emit(EventName.TASK_UPDATED, {
                            task: targetTask,
                            categoryFilepath: targetCatPath,
                        });
                    }
                }

                migratedCount++;
                details.push(`${noteFile.path} -> ${finalFile.path} (title: "${taskTitle}")`);
                void Logger.log(`[LinkedNote Migration] Migrated old note: ${noteFile.path} -> ${finalFile.path}`);
            }
        }

        // 5. Also auto-sync all categories in vault
        try {
            const categories = await dataService.getCategories();
            for (const cat of categories) {
                const res = await this.autoSyncCategoryLinkedNotes(app, dataService, cat.filepath);
                if (res.healedNotesCount > 0) {
                    migratedCount += res.healedNotesCount;
                    details.push(`Auto-synced ${res.healedNotesCount} note(s) in category "${cat.name}"`);
                }
            }
        } catch (e) {
            void Logger.log("[LinkedNote Migration] Error running autoSyncCategoryLinkedNotes across categories:", e);
        }

        return { migratedCount, details };
    }
}
