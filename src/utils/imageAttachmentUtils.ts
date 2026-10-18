import { App, Notice, TFile } from "obsidian";
import { t } from "../lang/helpers";

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
    const cleanA = a.replace(/^!*\[\[(.*?)\]\]$/, "$1").split("|")[0].trim().toLowerCase();
    const cleanB = b.replace(/^!*\[\[(.*?)\]\]$/, "$1").split("|")[0].trim().toLowerCase();
    if (cleanA === cleanB) return true;
    const baseA = cleanA.split("/").pop();
    const baseB = cleanB.split("/").pop();
    return !!baseA && baseA === baseB;
}
