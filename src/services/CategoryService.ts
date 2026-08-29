import { App, TFile, TFolder } from "obsidian";
import { Logger } from "../Logger";
import { CategoryInfo, DATA_FOLDER, SidebarItem, SidebarItemState, GroupInfo, EventName } from "../types";
import { EventBus } from "../EventBus";
import { AtomicIOPipeline } from "./AtomicIOPipeline";

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
                for (const childName of itemState.children || []) {
                    if (usedFiles.has(childName)) {
                        hasDuplicateMetadata = true;
                        continue;
                    }
                    const file = fileMap.get(childName);
                    if (file) {
                        groupItems.push({
                            id: file.path,
                            type: "category",
                            name: file.basename,
                            filepath: file.path
                        });
                        usedFiles.add(childName);
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
                if (usedFiles.has(itemState.name)) {
                    hasDuplicateMetadata = true;
                    continue;
                }
                const file = fileMap.get(itemState.name);
                if (file) {
                    sidebarItems.push({
                        id: file.path,
                        type: "category",
                        name: file.basename,
                        filepath: file.path
                    });
                    usedFiles.add(itemState.name);
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
        
        const seenCategories = new Set<string>();
        const seenGroupIds = new Set<string>();
        const state: SidebarItemState[] = [];

        // Convert UI model back to persistent model with strict deduplication
        for (const item of items) {
            if (item.type === "group") {
                if (seenGroupIds.has(item.id)) continue;
                seenGroupIds.add(item.id);

                const children: string[] = [];
                for (const child of item.items || []) {
                    if (!seenCategories.has(child.name)) {
                        seenCategories.add(child.name);
                        children.push(child.name);
                    }
                }
                state.push({
                    type: "group",
                    id: item.id,
                    name: item.name,
                    isExpanded: item.isExpanded,
                    children
                });
            } else if (item.type === "category") {
                if (!seenCategories.has(item.name)) {
                    seenCategories.add(item.name);
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
        const filepath = `${DATA_FOLDER}/${name}.md`;
        if (this.app.vault.getAbstractFileByPath(filepath)) {
            throw new Error(`Category "${name}" already exists.`);
        }

        // 1. Update metadata state FIRST to place new category at the top
        const state = await this.loadSidebarState();
        const filteredState = state.filter(s => !(s.type === "category" && s.name === name));
        filteredState.unshift({ type: "category", name });

        const metadataPath = this.getMetadataPath();
        this.io.markInternalWrite(metadataPath);
        await this.app.vault.adapter.write(metadataPath, JSON.stringify({ sidebar: filteredState }, null, 2));

        // 2. Create the file on disk
        this.io.markInternalWrite(filepath);
        await this.app.vault.create(filepath, "");
        void Logger.log("Created category:", name);

        const newCat: CategoryInfo = { id: filepath, type: "category", name, filepath };
        const items = await this.getSidebarItems();

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

    async deleteCategory(filepath: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filepath);
        const basename = filepath.split("/").pop()?.replace(/\.md$/, "") || "";

        if (file && file instanceof TFile) {
            this.io.markInternalWrite(filepath);
            await this.app.fileManager.trashFile(file);
            Logger.log("Moved category to trash:", filepath);
        }

        // Always clean up from sidebar state, even if file on disk was already missing/trashed
        if (basename) {
            const items = await this.getSidebarItems();
            const cleanup = (list: SidebarItem[]) => {
                for (let i = list.length - 1; i >= 0; i--) {
                    const item = list[i];
                    if (item.type === "category" && item.name === basename) {
                        list.splice(i, 1);
                    } else if (item.type === "group") {
                        item.items = item.items.filter(c => c.name !== basename);
                    }
                }
            };
            cleanup(items);
            await this.saveSidebarState(items);
            EventBus.emit(EventName.CATEGORY_LIST_CHANGED, { sidebarItems: items });
        }
    }

    async renameCategory(filepath: string, newName: string): Promise<CategoryInfo> {
        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`Category file not found: ${filepath}`);
        }
        const oldName = file.basename;
        const newPath = `${DATA_FOLDER}/${newName}.md`;

        // CRITICAL: Update persistent sidebar metadata BEFORE renaming the file on disk.
        // If the file is renamed first, getSidebarItems() / loadSidebarState() during vault rename events
        // will fail to find oldName.md, discard it from its group, and dump newName at the bottom as an orphan.
        const state = await this.loadSidebarState();
        for (const item of state) {
            if (item.type === "category" && item.name === oldName) {
                item.name = newName;
            } else if (item.type === "group" && item.children) {
                item.children = item.children.map(child => child === oldName ? newName : child);
            }
        }
        const metadataPath = this.getMetadataPath();
        await this.app.vault.adapter.write(metadataPath, JSON.stringify({ sidebar: state }, null, 2));

        // Perform the physical file rename
        await this.app.vault.rename(file, newPath);
        void Logger.log("Renamed category:", filepath, "->", newPath);

        const newCat: CategoryInfo = { id: newPath, type: "category", name: newName, filepath: newPath };
        EventBus.emit(EventName.CATEGORY_LIST_CHANGED, {});
        return newCat;
    }
}
