import { App, Notice, TFile } from "obsidian";
import { t } from "../lang/helpers";
import type { TaskItem, TaskStep, TrashedImageBackup } from "../types";
import { Logger } from "../Logger";

/**
 * Cleanly format current timestamp for attachment filenames: YYYYMMDDHHmmss
 */
function getTimestampString(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Save an image File/Blob into Obsidian vault attachments according to user settings or TodoData/attachments.
 * Returns the normalized vault relative path of the created attachment.
 */
export async function saveImageAttachment(
    file: File | Blob,
    app: App,
    sourceFilepath?: string
): Promise<string | null> {
    try {
        const arrayBuffer = await file.arrayBuffer();

        // Determine file extension
        let ext = "png";
        if (file.type === "image/jpeg") ext = "jpg";
        else if (file.type === "image/webp") ext = "webp";
        else if (file.type === "image/gif") ext = "gif";
        else if (file.type === "image/svg+xml") ext = "svg";
        else if ("name" in file && typeof file.name === "string" && file.name.includes(".")) {
            const parts = file.name.split(".");
            ext = parts[parts.length - 1].toLowerCase();
        }

        const filename = `Pasted image ${getTimestampString()}.${ext}`;

        let availablePath: string;
        const fileManager = app.fileManager as any;

        if (fileManager && typeof fileManager.getAvailablePathForAttachment === "function") {
            try {
                availablePath = await fileManager.getAvailablePathForAttachment(filename, sourceFilepath);
            } catch (err) {
                console.warn("[FluentTasks] getAvailablePathForAttachment fallback:", err);
                availablePath = await fallbackAttachmentPath(app, filename);
            }
        } else {
            availablePath = await fallbackAttachmentPath(app, filename);
        }

        // Ensure parent directory exists before creating binary
        const lastSlash = availablePath.lastIndexOf("/");
        if (lastSlash > 0) {
            const parentDir = availablePath.substring(0, lastSlash);
            if (!(await app.vault.adapter.exists(parentDir))) {
                await app.vault.createFolder(parentDir).catch(() => {});
            }
        }

        const createdFile = await app.vault.createBinary(availablePath, arrayBuffer);
        return createdFile.path;
    } catch (error) {
        console.error("[FluentTasks] Failed to save image attachment:", error);
        new Notice("Failed to save image attachment / 保存图片附件失败");
        return null;
    }
}

async function fallbackAttachmentPath(app: App, filename: string): Promise<string> {
    const defaultFolder = "TodoData/attachments";
    if (!(await app.vault.adapter.exists(defaultFolder))) {
        try {
            await app.vault.createFolder(defaultFolder);
        } catch {
            // Folder might already exist
        }
    }

    let targetPath = `${defaultFolder}/${filename}`;
    let counter = 1;
    while (await app.vault.adapter.exists(targetPath)) {
        const extIdx = filename.lastIndexOf(".");
        const base = extIdx > 0 ? filename.slice(0, extIdx) : filename;
        const ext = extIdx > 0 ? filename.slice(extIdx) : ".png";
        targetPath = `${defaultFolder}/${base} ${counter}${ext}`;
        counter++;
    }
    return targetPath;
}

/**
 * Resolves an image reference (vault path, wikilink, or web URL) to a usable resource URL for <img src>.
 */
export function resolveImageResourceUrl(imageRef: string, app: App): string {
    if (!imageRef) return "";

    const trimmed = imageRef.trim();
    if (
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://") ||
        trimmed.startsWith("data:") ||
        trimmed.startsWith("app://")
    ) {
        return trimmed;
    }

    // Strip ![[...]] or [[...]] or markdown syntax
    let clean = trimmed.replace(/^!*\[\[(.*?)\]\]$/, "$1").trim();
    if (clean.includes("|")) {
        clean = clean.split("|")[0].trim();
    }
    // Also check standard markdown format ![alt](path)
    const mdMatch = clean.match(/^!\[.*?\]\((.*?)\)$/);
    if (mdMatch) {
        clean = mdMatch[1].trim();
    }

    // 1. Direct path lookup in vault
    const directFile = app.vault.getAbstractFileByPath(clean);
    if (directFile instanceof TFile) {
        return app.vault.getResourcePath(directFile);
    }

    // 2. MetadataCache linkpath lookup (resolves wikilinks / basenames)
    const linkFile = app.metadataCache.getFirstLinkpathDest(clean, "");
    if (linkFile instanceof TFile) {
        return app.vault.getResourcePath(linkFile);
    }

    // 3. Adapter getResourcePath fallback
    if (app.vault?.adapter?.getResourcePath) {
        try {
            return app.vault.adapter.getResourcePath(clean);
        } catch {
            // ignore
        }
    }

    return clean;
}

/**
 * Copies the referenced image to the system clipboard with dual-pipeline:
 * 1. Electron native clipboard writeImage (highest desktop fidelity, compatible with native apps).
 * 2. Web Clipboard API (navigator.clipboard.write) fallback.
 */
export async function copyImageToClipboard(
    imageRef: string,
    app: App,
    noticeMsg?: string
): Promise<boolean> {
    if (!imageRef) return false;

    let clean = imageRef.trim().replace(/^!*\[\[(.*?)\]\]$/, "$1").trim();
    if (clean.includes("|")) {
        clean = clean.split("|")[0].trim();
    }
    const mdMatch = clean.match(/^!\[.*?\]\((.*?)\)$/);
    if (mdMatch) {
        clean = mdMatch[1].trim();
    }

    let file = app.vault.getAbstractFileByPath(clean);
    if (!(file instanceof TFile)) {
        file = app.metadataCache.getFirstLinkpathDest(clean, "");
    }

    let copied = false;
    const electron = (window as any).require ? (window as any).require("electron") : null;

    // 1. Fast path: nativeImage.createFromPath for direct bitmap files
    if (file instanceof TFile && electron?.clipboard && electron?.nativeImage) {
        try {
            const ext = file.extension.toLowerCase();
            if (ext !== "svg" && (app.vault.adapter as any).getFullPath) {
                const fullDiskPath = (app.vault.adapter as any).getFullPath(file.path);
                const nativeImg = electron.nativeImage.createFromPath(fullDiskPath);
                if (nativeImg && !nativeImg.isEmpty()) {
                    electron.clipboard.writeImage(nativeImg);
                    copied = true;
                }
            }
        } catch {
            // fallback to canvas/buffer
        }
    }

    // 2. Canvas-based rasterization (handles SVGs, JPGs, data URLs, web URLs, and Web Clipboard API)
    const resourceUrl = resolveImageResourceUrl(imageRef, app);
    if (resourceUrl) {
        try {
            await new Promise<void>((resolve) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    try {
                        const canvas = createEl("canvas");
                        canvas.width = img.naturalWidth || img.width || 400;
                        canvas.height = img.naturalHeight || img.height || 300;
                        const ctx = canvas.getContext("2d");
                        if (ctx) {
                            ctx.imageSmoothingEnabled = true;
                            ctx.imageSmoothingQuality = "high";
                            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                            // Electron write via PNG Data URL
                            if (!copied && electron?.clipboard && electron?.nativeImage) {
                                try {
                                    const dataUrl = canvas.toDataURL("image/png");
                                    const nativeImg = electron.nativeImage.createFromDataURL(dataUrl);
                                    if (nativeImg && !nativeImg.isEmpty()) {
                                        electron.clipboard.writeImage(nativeImg);
                                        copied = true;
                                    }
                                } catch (e) {
                                    console.warn("[FluentTasks] Canvas to nativeImage failed:", e);
                                }
                            }

                            // Web Clipboard API write via image/png blob
                            canvas.toBlob(async (blob) => {
                                if (blob && navigator.clipboard && navigator.clipboard.write) {
                                    try {
                                        await navigator.clipboard.write([
                                            new ClipboardItem({ "image/png": blob }),
                                        ]);
                                        copied = true;
                                    } catch (err) {
                                        if (!copied) console.warn("[FluentTasks] Web Clipboard write failed:", err);
                                    }
                                }
                                resolve();
                            }, "image/png");
                            return;
                        }
                    } catch (e) {
                        console.warn("[FluentTasks] Canvas processing error:", e);
                    }
                    resolve();
                };
                img.onerror = () => resolve();
                img.src = resourceUrl;
            });
        } catch (err) {
            console.warn("[FluentTasks] Canvas copy error:", err);
        }
    }

    // 3. Fallback: buffer reading for Electron
    if (!copied && file instanceof TFile && electron?.clipboard && electron?.nativeImage) {
        try {
            const arrayBuf = await app.vault.readBinary(file);
            const winBuf = (window as any).Buffer;
            const nodeBuf = winBuf ? winBuf.from(arrayBuf) : null;
            if (nodeBuf) {
                const nativeImg = electron.nativeImage.createFromBuffer(nodeBuf);
                if (nativeImg && !nativeImg.isEmpty()) {
                    electron.clipboard.writeImage(nativeImg);
                    copied = true;
                }
            }
        } catch (err) {
            console.warn("[FluentTasks] Buffer copy fallback error:", err);
        }
    }

    if (copied) {
        new Notice(noticeMsg || t("image_copied") || "Image copied to clipboard / 图片已复制到剪贴板");
        return true;
    } else {
        new Notice("Failed to copy image / 复制图片失败");
        return false;
    }
}

/**
 * Extracts markdown image embed references from a text block.
 */
export function extractImageRefs(text: string): string[] {
    if (!text) return [];
    const results: string[] = [];

    // Match ![[filename.png]] or ![[filename.png|...]]
    const wikiRegex = /!\[\[([^\]\n]+)\]\]/g;
    let match;
    while ((match = wikiRegex.exec(text)) !== null) {
        let ref = match[1].trim();
        if (ref.includes("|")) {
            ref = ref.split("|")[0].trim();
        }
        if (isImageExtension(ref) && !results.includes(ref)) {
            results.push(ref);
        }
    }

    // Match ![alt](path)
    const mdRegex = /!\[.*?\]\(([^)\n]+)\)/g;
    while ((match = mdRegex.exec(text)) !== null) {
        const ref = match[1].trim();
        if (isImageExtension(ref) && !results.includes(ref)) {
            results.push(ref);
        }
    }

    return results;
}

function isImageExtension(path: string): boolean {
    const lower = path.toLowerCase().split("?")[0].split("#")[0];
    return (
        lower.endsWith(".png") ||
        lower.endsWith(".jpg") ||
        lower.endsWith(".jpeg") ||
        lower.endsWith(".webp") ||
        lower.endsWith(".gif") ||
        lower.endsWith(".svg") ||
        lower.endsWith(".bmp")
    );
}

/**
 * Removes an image embed wikilink or markdown link from text.
 */
export function removeImageRefFromText(text: string, imageRef: string): string {
    if (!text || !imageRef) return text;

    let clean = imageRef.replace(/^!*\[\[(.*?)\]\]$/, "$1").trim();
    if (clean.includes("|")) clean = clean.split("|")[0].trim();

    // Regex to match ![[clean]] or ![[clean|...]]
    const escapedClean = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wikiPattern = new RegExp(`!\\s*\\[\\[${escapedClean}(?:\\|[^\\]]*)?\\]\\]`, "gi");
    let updated = text.replace(wikiPattern, "");

    // Regex to match ![...](clean)
    const mdPattern = new RegExp(`!\\s*\\[[^\\]]*\\]\\(${escapedClean}\\)`, "gi");
    updated = updated.replace(mdPattern, "");

    // Clean up double newlines or leading/trailing whitespace
    return updated.replace(/\n\s*\n\s*\n/g, "\n\n").trim();
}

/**
 * Returns a human-friendly base filename for tooltips and badges.
 */
export function getImageBaseName(imageRef: string): string {
    if (!imageRef) return "";
    let clean = imageRef.replace(/^!*\[\[(.*?)\]\]$/, "$1").trim();
    if (clean.includes("|")) clean = clean.split("|")[0].trim();
    const parts = clean.split("/");
    return parts[parts.length - 1] || clean;
}

/**
 * Checks clipboard event data for image files or native clipboard image synchronously.
 * Must be synchronous so callers can call e.preventDefault() before event dispatch finishes.
 */
export function getImagesFromClipboard(e: ClipboardEvent): File[] {
    const result: File[] = [];
    const clipboardData = e.clipboardData;

    if (clipboardData) {
        const items = clipboardData.items;
        if (items && items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith("image/")) {
                    const file = items[i].getAsFile();
                    if (file) result.push(file);
                }
            }
        }

        if (result.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
            for (let i = 0; i < clipboardData.files.length; i++) {
                if (clipboardData.files[i].type.startsWith("image/")) {
                    result.push(clipboardData.files[i]);
                }
            }
        }
    }

    // Desktop Electron fallback if web clipboard returned empty
    if (result.length === 0) {
        try {
            const electron = (window as any).require ? (window as any).require("electron") : null;
            if (electron?.clipboard) {
                const nativeImg = electron.clipboard.readImage();
                if (nativeImg && !nativeImg.isEmpty()) {
                    const buf = nativeImg.toPNG();
                    const file = new File([buf], `Pasted image ${getTimestampString()}.png`, {
                        type: "image/png",
                    });
                    result.push(file);
                }
            }
        } catch {
            // ignore
        }
    }

    return result;
}

/**
 * Determines whether two image references refer to the same image.
 * Handles vault paths, bare basenames, and wikilink syntaxes.
 */
export function isSameImageRef(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;

    const normalize = (ref: string) => {
        let s = ref.trim();
        // Strip markdown image syntax ![alt](url)
        const mdMatch = s.match(/^!\[.*?\]\((.*?)\)$/);
        if (mdMatch) s = mdMatch[1].trim();
        // Strip wikilink syntax ![[url|...]] or [[url|...]]
        s = s.replace(/^!*\[\[(.*?)\]\]$/, "$1").trim();
        if (s.includes("|")) s = s.split("|")[0].trim();
        try {
            s = decodeURIComponent(s);
        } catch { /* ignore */ }
        s = s.replace(/\\/g, "/").toLowerCase();
        return s;
    };

    const cleanA = normalize(a);
    const cleanB = normalize(b);
    if (cleanA === cleanB) return true;
    const baseA = cleanA.split("/").pop();
    const baseB = cleanB.split("/").pop();
    return !!baseA && baseA === baseB;
}

/**
 * Extracts all unique image references associated with a task's title.
 * Combines task.titleImages and embedded image markdown from task.title.
 */
export function getTitleImages(t: TaskItem | null | undefined): string[] {
    if (!t) return [];
    const fromArray = t.titleImages || [];
    const fromText = extractImageRefs(t.title || "");
    const combined = [...fromArray];
    for (const ref of fromText) {
        if (!combined.some(existing => isSameImageRef(existing, ref))) {
            combined.push(ref);
        }
    }
    return combined;
}

/**
 * Extracts all unique image references associated with a task's note/detail.
 * Combines task.images and embedded image markdown from task.note.
 */
export function getNoteImages(t: TaskItem | null | undefined): string[] {
    if (!t) return [];
    const fromArray = t.images || [];
    const fromText = extractImageRefs(t.note || "");
    const combined = [...fromArray];
    for (const ref of fromText) {
        if (!combined.some(existing => isSameImageRef(existing, ref))) {
            combined.push(ref);
        }
    }
    return combined;
}

/**
 * Extracts all unique image references associated with a subtask step.
 * Combines step.images and embedded image markdown from step.text.
 */
export function getStepImages(step: TaskStep | null | undefined): string[] {
    if (!step) return [];
    const fromArray = step.images || [];
    const fromText = extractImageRefs(step.text || "");
    const combined = [...fromArray];
    for (const ref of fromText) {
        if (!combined.some(existing => isSameImageRef(existing, ref))) {
            combined.push(ref);
        }
    }
    return combined;
}

/**
 * Strips raw markdown image embeds (![[...]] or ![...](...)) from titles for clean display.
 */
export function cleanDisplayTitle(title: string): string {
    if (!title) return "";
    return title
        .replace(/!\[\[([^\]\n]+)\]\]/g, "")
        .replace(/!\[.*?\]\(([^)\n]+)\)/g, "")
        .replace(/\n\s*\n\s*\n/g, "\n\n")
        .trim();
}

/**
 * Removes an image reference from a task's titleImages array and title text.
 */
export function removeImageFromTaskTitle(task: TaskItem, imageRef: string): void {
    if (!task || !imageRef) return;
    if (task.titleImages) {
        task.titleImages = task.titleImages.filter(img => !isSameImageRef(img, imageRef));
    }
    task.title = removeImageRefFromText(task.title || "", imageRef);
}

/**
 * Removes an image reference from a task's images array and note text.
 */
export function removeImageFromTaskNote(task: TaskItem, imageRef: string): void {
    if (!task || !imageRef) return;
    if (task.images) {
        task.images = task.images.filter(img => !isSameImageRef(img, imageRef));
    }
    task.note = removeImageRefFromText(task.note || "", imageRef);
}

/**
 * Removes an image reference from a step's images array and text.
 */
export function removeImageFromStepItem(step: TaskStep, imageRef: string): void {
    if (!step || !imageRef) return;
    if (step.images) {
        step.images = step.images.filter(img => !isSameImageRef(img, imageRef));
    }
    step.text = removeImageRefFromText(step.text || "", imageRef);
}

/**
 * Extracts all unique image references across a task (title, note, and all steps).
 */
export function getAllImagesInTask(task: TaskItem | null | undefined): string[] {
    if (!task) return [];
    const images: string[] = [];
    const addAll = (refs: string[]) => {
        for (const r of refs) {
            if (r && !images.some(existing => isSameImageRef(existing, r))) {
                images.push(r);
            }
        }
    };
    addAll(getTitleImages(task));
    addAll(getNoteImages(task));
    if (task.steps && Array.isArray(task.steps)) {
        for (const s of task.steps) {
            addAll(getStepImages(s));
        }
    }
    return images;
}

/**
 * Resolves an image reference string to a physical TFile in the vault if it exists.
 */
export function resolveImageTFile(imageRef: string, app: App): TFile | null {
    if (!imageRef || !app) return null;
    let clean = imageRef.trim().replace(/^!*\[\[(.*?)\]\]$/, "$1").trim();
    if (clean.includes("|")) clean = clean.split("|")[0].trim();
    const mdMatch = clean.match(/^!\[.*?\]\((.*?)\)$/);
    if (mdMatch) clean = mdMatch[1].trim();

    try {
        clean = decodeURIComponent(clean);
    } catch {
        // ignore
    }
    clean = clean.replace(/^\/+/, "");

    const file = app.vault.getAbstractFileByPath(clean);
    if (file instanceof TFile) return file;
    const linkFile = app.metadataCache.getFirstLinkpathDest(clean, "");
    if (linkFile instanceof TFile) return linkFile;

    const baseName = clean.includes("/") ? clean.substring(clean.lastIndexOf("/") + 1) : clean;
    if (baseName && baseName !== clean) {
        const linkFileBase = app.metadataCache.getFirstLinkpathDest(baseName, "");
        if (linkFileBase instanceof TFile) return linkFileBase;
    }

    return null;
}

/**
 * Checks whether an image is referenced anywhere in any task in any category,
 * or in any other markdown note across the entire Obsidian vault.
 * If excludeTaskId or excludeStepId is provided, that task/step is ignored when checking.
 */
export async function isImageReferencedAcrossVault(
    imageRef: string,
    app: App,
    dataService: any,
    excludeTaskId?: string,
    excludeStepId?: string
): Promise<boolean> {
    if (!imageRef || !app) return false;

    // 1. Check all tasks across all categories in DataService
    let categories: any[] = [];
    if (dataService && typeof dataService.getCategories === "function") {
        try {
            categories = await dataService.getCategories();
            for (const cat of categories) {
                const tasks = await dataService.getTasks(cat.filepath);
                for (const t of tasks) {
                    if (excludeTaskId && t.id === excludeTaskId) continue;

                    const titleImgs = getTitleImages(t);
                    if (titleImgs.some(r => isSameImageRef(r, imageRef))) return true;

                    const noteImgs = getNoteImages(t);
                    if (noteImgs.some(r => isSameImageRef(r, imageRef))) return true;

                    if (t.steps && Array.isArray(t.steps)) {
                        for (const s of t.steps) {
                            if (excludeStepId && s.id === excludeStepId) continue;
                            const stepImgs = getStepImages(s);
                            if (stepImgs.some(r => isSameImageRef(r, imageRef))) return true;
                        }
                    }
                }
            }
        } catch (err) {
            console.warn("[FluentTasks] Error checking tasks for image references:", err);
        }
    }

    // 2. Check external vault notes in Obsidian's metadataCache.resolvedLinks
    try {
        const targetFile = resolveImageTFile(imageRef, app);
        if (targetFile) {
            const resolvedLinks = app.metadataCache?.resolvedLinks;
            if (resolvedLinks) {
                const categoryPaths = new Set(categories.map(c => c.filepath));
                for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
                    // Ignore category list files as we checked tasks directly with fresh authoritative data above
                    if (!categoryPaths.has(sourcePath) && !sourcePath.endsWith("/.metadata.json")) {
                        if (links && (links[targetFile.path] || links[targetFile.name])) {
                            return true;
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn("[FluentTasks] Error checking metadataCache for image references:", err);
    }

    return false;
}

/**
 * Checks if an image is an orphan (0 references anywhere in tasks or vault notes).
 * If zero references remain, the physical image file is trashed via app.fileManager.trashFile.
 * Returns the trashed image backup (path + binary) if it was trashed, so undo can restore it.
 */
export async function cleanupOrphanImageAttachment(
    imageRef: string,
    app: App,
    dataService: any,
    excludeTaskId?: string,
    excludeStepId?: string
): Promise<TrashedImageBackup | null> {
    if (!imageRef || !app) return null;

    const targetFile = resolveImageTFile(imageRef, app);
    if (!targetFile) return null;

    // Safety guard: only delete attachment files (TodoData/attachments, /attachments/, or Pasted image)
    const isAttachment =
        targetFile.path.startsWith("TodoData/attachments/") ||
        targetFile.path.includes("/attachments/") ||
        targetFile.name.startsWith("Pasted image ");

    if (!isAttachment) {
        return null;
    }

    const isReferenced = await isImageReferencedAcrossVault(imageRef, app, dataService, excludeTaskId, excludeStepId);
    if (!isReferenced) {
        try {
            let binary: ArrayBuffer | undefined = undefined;
            try {
                binary = await app.vault.readBinary(targetFile);
            } catch { /* ignore */ }

            const originalPath = targetFile.path;
            await app.fileManager.trashFile(targetFile);
            Logger.log(`[FluentTasks] Trashed orphan image attachment (0 references): ${originalPath}`);

            return {
                path: originalPath,
                binary: binary || new ArrayBuffer(0),
            };
        } catch (err) {
            console.error(`[FluentTasks] Failed to trash orphan image ${targetFile.path}:`, err);
        }
    }
    return null;
}

/**
 * Cleans up all orphan images in a list.
 * Returns array of backups for trashed images (for undo).
 */
export async function cleanupOrphanImages(
    imageRefs: string[],
    app: App,
    dataService: any,
    excludeTaskId?: string,
    excludeStepId?: string
): Promise<TrashedImageBackup[]> {
    if (!imageRefs || imageRefs.length === 0 || !app) return [];
    const trashed: TrashedImageBackup[] = [];
    for (const ref of imageRefs) {
        const backup = await cleanupOrphanImageAttachment(ref, app, dataService, excludeTaskId, excludeStepId);
        if (backup) {
            trashed.push(backup);
        }
    }
    return trashed;
}
