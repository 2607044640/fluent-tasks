import { App, TFile, TFolder } from "obsidian";
import { Logger } from "../Logger";
import { CategoryInfo, DATA_FOLDER, SidebarItem, SidebarItemState, GroupInfo, EventName } from "../types";
import { EventBus } from "../EventBus";
import { AtomicIOPipeline } from "./AtomicIOPipeline";
import { resolveUniqueName } from "../utils/sidebarTreeUtils";

export class CategoryService {
    private app: App;
    private io: AtomicIOPipeline;

    constructor(app: App, io: AtomicIOPipeline) {
        this.app = app;
        this.io = io;
    }

    private getMetadataPath(): string {
        return `${DATA_FOLDER}/.metadata.json`;
    }

    /**
     * Resolves an available physical file path on disk within DATA_FOLDER.
     * If TodoData/<baseName>.md exists, tries <baseName>(1).md, <baseName>(2).md, etc.
     */
    getAvailableDiskFilepath(baseName: string, currentFilepath?: string): { filepath: string; basename: string } {
        let candidateBasename = baseName;
        let candidatePath = `${DATA_FOLDER}/${candidateBasename}.md`;

        if (currentFilepath && candidatePath === currentFilepath) {
            return { filepath: candidatePath, basename: candidateBasename };
        }

        let file = this.app.vault.getAbstractFileByPath(candidatePath);
        if (!file || (currentFilepath && file.path === currentFilepath)) {
            return { filepath: candidatePath, basename: candidateBasename };
        }

        const match = baseName.match(/^(.*?)(?:\s*\(([0-9]+)\))?$/);
        const rawBase = (match && match[1]) ? match[1].trim() : baseName;
        let index = (match && match[2]) ? parseInt(match[2], 10) + 1 : 1;

        while (true) {
            candidateBasename = `${rawBase}(${index})`;
            candidatePath = `${DATA_FOLDER}/${candidateBasename}.md`;
            file = this.app.vault.getAbstractFileByPath(candidatePath);
            if (!file || (currentFilepath && file.path === currentFilepath)) {
                return { filepath: candidatePath, basename: candidateBasename };
            }
            index++;
        }
    }

    async getSidebarItems(): Promise<SidebarItem[]> {
        await this.io.ensureDataFolder();
        const folder = this.app.vault.getAbstractFileByPath(DATA_FOLDER);
        if (!folder || !(folder instanceof TFolder)) return [];

        // 1. Gather all physical markdown files
        const fileMap = new Map<string, TFile>();
        for (const child of folder.children) {
            if (child instanceof TFile && child.extension === "md" && !child.name.startsWith(".")) {
                fileMap.set(child.basename, child);
            }
        }

        // 2. Load sidebar state from metadata
        const state = await this.loadSidebarState();
        const sidebarItems: SidebarItem[] = [];
        const usedFiles = new Set<string>();
        const seenGroupIds = new Set<string>();
        let hasDuplicateMetadata = false;

        // 3. Reconstruct tree with strict deduplication guards
        for (const itemState of state) {
            if (itemState.type === "group") {
                const groupId = itemState.id || Date.now().toString() + Math.random().toString(36).substring(2, 7);
                if (seenGroupIds.has(groupId)) {
                    hasDuplicateMetadata = true;
                    continue;
                }
                seenGroupIds.add(groupId);

                const groupItems: CategoryInfo[] = [];
                for (const rawChild of itemState.children || []) {
                    const childName = typeof rawChild === "string" ? rawChild : rawChild.name;
                    const childFile = typeof rawChild === "string" ? rawChild : (rawChild.file || rawChild.name);
                    if (!childName) continue;

                    // Deduplicate by physical file basename
                    if (usedFiles.has(childFile)) {
                        hasDuplicateMetadata = true;
                        continue;
                    }

                    let file = fileMap.get(childFile);
                    if (!file && childName !== childFile) {
                        file = fileMap.get(childName);
                    }

                    if (file) {
                        groupItems.push({
                            id: file.path,
                            type: "category",
                            name: childName,
                            filepath: file.path
                        });
                        usedFiles.add(file.basename);
                    }
                }
                sidebarItems.push({
                    id: groupId,
                    type: "group",
                    name: itemState.name,
                    items: groupItems,
                    isExpanded: itemState.isExpanded ?? true
                });
            } else if (itemState.type === "category") {
                const childName = itemState.name;
                const childFile = itemState.file || itemState.name;

                if (usedFiles.has(childFile)) {
                    hasDuplicateMetadata = true;
                    continue;
                }

                let file = fileMap.get(childFile);
                if (!file && childName !== childFile) {
                    file = fileMap.get(childName);
                }

                if (file) {
                    sidebarItems.push({
                        id: file.path,
                        type: "category",
                        name: childName,
                        filepath: file.path
                    });
                    usedFiles.add(file.basename);
                }
            }
        }

        // 4. Append orphaned files that weren't in metadata
        for (const [basename, file] of fileMap.entries()) {
            if (!usedFiles.has(basename)) {
                sidebarItems.push({
                    id: file.path,
                    type: "category",
                    name: basename,
                    filepath: file.path
                });
                usedFiles.add(basename);
            }
        }

        // Auto-heal: if corrupt duplicate entries existed in .metadata.json, clean them up
        if (hasDuplicateMetadata) {
            void this.saveSidebarState(sidebarItems);
        }

        return sidebarItems;
    }

    async loadSidebarState(): Promise<SidebarItemState[]> {
        try {
            const path = this.getMetadataPath();
            // CRITICAL: Use adapter (raw FS) because Obsidian's Vault API ignores dotfiles (.metadata.json)
            const exists = await this.app.vault.adapter.exists(path);
            if (!exists) return [];
            const content = await this.app.vault.adapter.read(path);
            if (!content) return [];
            const parsed = JSON.parse(content) as { sidebar?: SidebarItemState[]; categoryOrder?: string[] } | null;
            if (parsed?.sidebar) {
                return parsed.sidebar;
            } else if (parsed?.categoryOrder) {
                // Migrate from legacy format
                return parsed.categoryOrder.map((name: string) => ({ type: "category", name }));
            }
            return [];
        } catch (e) {
            void Logger.log("ERROR reading sidebar state:", e);
            return [];
        }
    }

    async saveSidebarState(items: SidebarItem[]): Promise<void> {
        await this.io.ensureDataFolder();
        const path = this.getMetadataPath();
        
        const seenFilepaths = new Set<string>();
        const seenGroupIds = new Set<string>();
        const state: SidebarItemState[] = [];

        // Convert UI model back to persistent model with strict deduplication
        for (const item of items) {
            if (item.type === "group") {
                if (seenGroupIds.has(item.id)) continue;
                seenGroupIds.add(item.id);

                const children: Array<string | { name: string; file: string }> = [];
                for (const child of item.items || []) {
                    if (seenFilepaths.has(child.filepath)) continue;
                    seenFilepaths.add(child.filepath);

                    const fileBasename = child.filepath.split("/").pop()?.replace(/\.md$/, "") || child.name;
                    if (fileBasename !== child.name) {
                        children.push({ name: child.name, file: fileBasename });
                    } else {
                        children.push(child.name);
                    }
                }
                state.push({
                    type: "group",
                    id: item.id,
                    name: item.name,
                    isExpanded: item.isExpanded,
                    children: children
                });
            } else if (item.type === "category") {
                if (seenFilepaths.has(item.filepath)) continue;
                seenFilepaths.add(item.filepath);

                const fileBasename = item.filepath.split("/").pop()?.replace(/\.md$/, "") || item.name;
                if (fileBasename !== item.name) {
                    state.push({
                        type: "category",
                        name: item.name,
                        file: fileBasename
                    } as any);
                } else {
                    state.push({
                        type: "category",
                        name: item.name
                    });
                }
            }
        }

        const content = JSON.stringify({ sidebar: state }, null, 2);
        
        // CRITICAL: Use adapter.write (raw FS) because Obsidian's Vault API ignores dotfiles
        this.io.markInternalWrite(path);
        await this.app.vault.adapter.write(path, content);
    }

    async createCategory(name: string): Promise<CategoryInfo> {
        await this.io.ensureDataFolder();
        const trimmed = name.trim();
        if (!trimmed) {
            throw new Error("Category name cannot be empty");
        }

        const items = await this.getSidebarItems();
        const rootNames = items.filter((i): i is CategoryInfo => i.type === "category").map(c => c.name);
        const resolvedDisplayName = resolveUniqueName(rootNames, trimmed);

        const { filepath } = this.getAvailableDiskFilepath(resolvedDisplayName);

        // 1. Update in-memory sidebar items and save metadata FIRST
        const newCat: CategoryInfo = { id: filepath, type: "category", name: resolvedDisplayName, filepath };
        items.unshift(newCat);
        await this.saveSidebarState(items);

        // 2. Create the file on disk
        this.io.markInternalWrite(filepath);
        await this.app.vault.create(filepath, "");
        void Logger.log("Created category:", filepath);

        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems: items });
        return newCat;
    }

    async createGroup(name: string): Promise<GroupInfo> {
        const newGroup: GroupInfo = {
            id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
            type: "group",
            name,
            items: [],
            isExpanded: true
        };
        const items = await this.getSidebarItems();
        items.unshift(newGroup);
        await this.saveSidebarState(items);
        void Logger.log("Created group:", name);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems: items });
        return newGroup;
    }

    async renameGroup(groupId: string, newName: string): Promise<void> {
        const items = await this.getSidebarItems();
        for (const item of items) {
            if (item.type === "group" && item.id === groupId) {
                item.name = newName;
                break;
            }
        }
        await this.saveSidebarState(items);
        void Logger.log("Renamed group:", groupId, "->", newName);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems: items });
    }

    async deleteGroup(groupId: string): Promise<void> {
        const items = await this.getSidebarItems();
        const groupIdx = items.findIndex(i => i.id === groupId && i.type === "group");
        if (groupIdx === -1) return;

        const group = items[groupIdx] as GroupInfo;
        const children = group.items || [];
        items.splice(groupIdx, 1);

        const rootNames = items.filter((i): i is CategoryInfo => i.type === "category").map(c => c.name);
        const resolvedChildren: CategoryInfo[] = [];
        for (const child of children) {
            const uniqueName = resolveUniqueName(rootNames, child.name);
            rootNames.push(uniqueName);
            resolvedChildren.push({
                ...child,
                name: uniqueName
            });
        }
        items.splice(groupIdx, 0, ...resolvedChildren);

        await this.saveSidebarState(items);
        void Logger.log("Deleted group:", groupId);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems: items });
    }

    async deleteCategory(filepath: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filepath);
        const basename = filepath.split("/").pop()?.replace(/\.md$/, "") || "";

        let fileContent = "";
        if (file && file instanceof TFile) {
            try {
                fileContent = await this.app.vault.read(file);
            } catch (e) {
                console.error("Failed to read category file before deletion:", e);
            }
        }

        let groupName: string | undefined;
        let index: number = -1;
        let categoryDisplayName = basename;
        try {
            const currentItems = await this.getSidebarItems();
            for (let i = 0; i < currentItems.length; i++) {
                const item = currentItems[i];
                if (item.type === "category" && (item.filepath === filepath || item.id === filepath)) {
                    categoryDisplayName = item.name;
                    index = i;
                    break;
                } else if (item.type === "group" && item.items) {
                    const subIdx = item.items.findIndex(c => c.filepath === filepath || c.id === filepath);
                    if (subIdx !== -1) {
                        categoryDisplayName = item.items[subIdx].name;
                        groupName = item.name;
                        index = subIdx;
                        break;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to locate category in sidebar before deletion:", e);
        }

        if (file && file instanceof TFile) {
            this.io.markInternalWrite(filepath);
            await this.app.fileManager.trashFile(file);
            Logger.log("Moved category to trash:", filepath);
        }

        // Always clean up from sidebar state, even if file on disk was already missing/trashed
        const items = await this.getSidebarItems();
        const cleanup = (list: SidebarItem[]) => {
            for (let i = list.length - 1; i >= 0; i--) {
                const item = list[i];
                if (item.type === "category" && (item.filepath === filepath || item.id === filepath)) {
                    list.splice(i, 1);
                } else if (item.type === "group" && item.items) {
                    item.items = item.items.filter(c => c.filepath !== filepath && c.id !== filepath);
                }
            }
        };
        cleanup(items);
        await this.saveSidebarState(items);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems: items });

        EventBus.emit(EventName.CATEGORY_DELETED, {
            categoryName: categoryDisplayName,
            categoryFilepath: filepath,
            fileContent,
            groupName,
            index,
        });
    }

    async restoreCategory(
        categoryName: string,
        categoryFilepath: string,
        fileContent: string,
        groupName?: string,
        index?: number
    ): Promise<CategoryInfo> {
        await this.io.ensureDataFolder();
        let file = this.app.vault.getAbstractFileByPath(categoryFilepath);
        if (!file) {
            this.io.markInternalWrite(categoryFilepath);
            file = await this.app.vault.create(categoryFilepath, fileContent);
            Logger.log("Restored category file from undo:", categoryFilepath);
        } else if (file instanceof TFile) {
            this.io.markInternalWrite(categoryFilepath);
            await this.app.vault.modify(file, fileContent);
            Logger.log("Overwrote category file from undo:", categoryFilepath);
        }

        const restoredCat: CategoryInfo = {
            id: categoryFilepath,
            type: "category",
            name: categoryName,
            filepath: categoryFilepath,
        };

        const items = await this.getSidebarItems();

        // Extract the category if it was appended as an orphan by getSidebarItems()
        let existingItem: CategoryInfo | null = null;
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item.type === "category" && (item.filepath === categoryFilepath || item.id === categoryFilepath)) {
                existingItem = item;
                items.splice(i, 1);
                break;
            } else if (item.type === "group" && item.items) {
                const subIdx = item.items.findIndex(c => c.filepath === categoryFilepath || c.id === categoryFilepath);
                if (subIdx !== -1) {
                    existingItem = item.items[subIdx];
                    item.items.splice(subIdx, 1);
                    break;
                }
            }
        }

        const catToInsert = existingItem || restoredCat;

        if (groupName) {
            const targetGroup = items.find(item => item.type === "group" && item.name === groupName);
            if (targetGroup && targetGroup.type === "group") {
                if (!targetGroup.items) targetGroup.items = [];
                const siblingNames = targetGroup.items.map(c => c.name);
                catToInsert.name = resolveUniqueName(siblingNames, catToInsert.name);
                const insertIdx = typeof index === "number" && index >= 0 && index <= targetGroup.items.length
                    ? index
                    : targetGroup.items.length;
                targetGroup.items.splice(insertIdx, 0, catToInsert);
            } else {
                const rootNames = items.filter((i): i is CategoryInfo => i.type === "category").map(c => c.name);
                catToInsert.name = resolveUniqueName(rootNames, catToInsert.name);
                const insertIdx = typeof index === "number" && index >= 0 && index <= items.length
                    ? index
                    : items.length;
                items.splice(insertIdx, 0, catToInsert);
            }
        } else {
            const rootNames = items.filter((i): i is CategoryInfo => i.type === "category").map(c => c.name);
            catToInsert.name = resolveUniqueName(rootNames, catToInsert.name);
            const insertIdx = typeof index === "number" && index >= 0 && index <= items.length
                ? index
                : items.length;
            items.splice(insertIdx, 0, catToInsert);
        }

        await this.saveSidebarState(items);
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems: items });
        EventBus.emit(EventName.CATEGORY_SELECTED, { category: catToInsert });

        return catToInsert;
    }

    async renameCategory(filepath: string, newName: string): Promise<CategoryInfo> {
        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`Category file not found: ${filepath}`);
        }

        const trimmedName = newName.trim();
        if (!trimmedName) {
            throw new Error("Category name cannot be empty");
        }

        const items = await this.getSidebarItems();

        // 1. Locate the category in the current tree structure
        let targetCat: CategoryInfo | null = null;
        let siblingNames: string[] = [];
        let containingGroup: GroupInfo | null = null;

        for (const item of items) {
            if (item.type === "category") {
                if (item.filepath === filepath || item.id === filepath) {
                    targetCat = item;
                }
            } else if (item.type === "group" && item.items) {
                const found = item.items.find(c => c.filepath === filepath || c.id === filepath);
                if (found) {
                    targetCat = found;
                    containingGroup = item;
                }
            }
        }

        if (!targetCat) {
            // Fallback if not found in sidebar tree
            targetCat = {
                id: filepath,
                type: "category",
                name: file.basename,
                filepath: filepath
            };
        }

        // 2. Determine sibling display names within the same container
        if (containingGroup) {
            siblingNames = containingGroup.items
                .filter(c => c.filepath !== filepath && c.id !== filepath)
                .map(c => c.name);
        } else {
            siblingNames = items
                .filter((i): i is CategoryInfo => i.type === "category" && i.filepath !== filepath && i.id !== filepath)
                .map(c => c.name);
        }

        // 3. Resolve unique display name within this group/root (same group collisions -> name(1))
        const resolvedDisplayName = resolveUniqueName(siblingNames, trimmedName);

        // 4. Resolve an available disk filename under TodoData/
        const { filepath: newPath } = this.getAvailableDiskFilepath(resolvedDisplayName, filepath);

        // 5. Update the in-memory item
        targetCat.name = resolvedDisplayName;
        targetCat.id = newPath;
        targetCat.filepath = newPath;

        // 6. Save sidebar state FIRST (ensures metadata is synchronized before disk event fires)
        await this.saveSidebarState(items);

        // 7. If disk path changed, rename the physical file
        if (newPath !== filepath) {
            this.io.markInternalWrite(filepath);
            this.io.markInternalWrite(newPath);
            await this.app.vault.rename(file, newPath);
            void Logger.log("Renamed category file:", filepath, "->", newPath);
        }

        const newCat: CategoryInfo = {
            id: newPath,
            type: "category",
            name: resolvedDisplayName,
            filepath: newPath
        };

        EventBus.emit(EventName.CATEGORY_RENAMED, { oldFilepath: filepath, category: newCat });
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems: items });
        return newCat;
    }
}
