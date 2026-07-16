import { App, TFile, TFolder } from "obsidian";
import { Logger } from "../Logger";
import { CategoryInfo, DATA_FOLDER, SidebarItem, SidebarItemState, GroupInfo } from "../types";
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
        if (!folder || !("children" in folder)) return [];

        // 1. Gather all physical markdown files
        const fileMap = new Map<string, TFile>();
        for (const child of (folder as TFolder).children) {
            if (child instanceof TFile && child.extension === "md" && !child.name.startsWith(".")) {
                fileMap.set(child.basename, child);
            }
        }

        // 2. Load sidebar state from metadata
        const state = await this.loadSidebarState();
        const sidebarItems: SidebarItem[] = [];
        const usedFiles = new Set<string>();

        // 3. Reconstruct tree
        for (const itemState of state) {
            if (itemState.type === "group") {
                const groupItems: CategoryInfo[] = [];
                for (const childName of itemState.children || []) {
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
                    id: itemState.id || Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    type: "group",
                    name: itemState.name,
                    items: groupItems,
                    isExpanded: itemState.isExpanded ?? true
                });
            } else if (itemState.type === "category") {
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
            }
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
            const data = JSON.parse(content);
            if (data.sidebar) {
                return data.sidebar;
            } else if (data.categoryOrder) {
                // Migrate from legacy format
                return data.categoryOrder.map((name: string) => ({ type: "category", name }));
            }
            return [];
        } catch (e) {
            Logger.log("ERROR reading sidebar state:", e);
            return [];
        }
    }

    async saveSidebarState(items: SidebarItem[]): Promise<void> {
        await this.io.ensureDataFolder();
        const path = this.getMetadataPath();
        
        // Convert UI model back to persistent model
        const state: SidebarItemState[] = items.map(item => {
            if (item.type === "group") {
                return {
                    type: "group",
                    id: item.id,
                    name: item.name,
                    isExpanded: item.isExpanded,
                    children: item.items.map(child => child.name)
                };
            } else {
                return {
                    type: "category",
                    name: item.name
                };
            }
        });

        const content = JSON.stringify({ sidebar: state }, null, 2);
        
        // CRITICAL: Use adapter.write (raw FS) because Obsidian's Vault API ignores dotfiles
        await this.app.vault.adapter.write(path, content);
    }

    async createCategory(name: string): Promise<CategoryInfo> {
        await this.io.ensureDataFolder();
        const filepath = `${DATA_FOLDER}/${name}.md`;
        if (this.app.vault.getAbstractFileByPath(filepath)) {
            throw new Error(`Category "${name}" already exists.`);
        }
        await this.app.vault.create(filepath, "");
        Logger.log("Created category:", name);
        return { id: filepath, type: "category", name, filepath };
    }

    async createGroup(name: string): Promise<GroupInfo> {
        const items = await this.getSidebarItems();
        const newGroup: GroupInfo = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            type: "group",
            name,
            items: [],
            isExpanded: true
        };
        items.push(newGroup);
        await this.saveSidebarState(items);
        Logger.log("Created group:", name);
        return newGroup;
    }

    async deleteCategory(filepath: string): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (file && file instanceof TFile) {
            await this.app.vault.trash(file, false);
            Logger.log("Moved category to local trash:", filepath);
            // Optimization: Remove from sidebar state
            const items = await this.getSidebarItems();
            const basename = file.basename;
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
        }
    }

    async renameCategory(filepath: string, newName: string): Promise<CategoryInfo> {
        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (!file || !(file instanceof TFile)) {
            throw new Error(`Category file not found: ${filepath}`);
        }
        const oldName = file.basename;
        const newPath = `${DATA_FOLDER}/${newName}.md`;
        await this.app.vault.rename(file, newPath);
        Logger.log("Renamed category:", filepath, "->", newPath);

        // Fix Bug: Update sidebar state with new name
        const items = await this.getSidebarItems();
        const updateName = (list: SidebarItem[]) => {
            for (const item of list) {
                if (item.type === "category" && item.name === oldName) {
                    item.name = newName;
                    item.id = newPath;
                    item.filepath = newPath;
                } else if (item.type === "group") {
                    for (const child of item.items) {
                        if (child.name === oldName) {
                            child.name = newName;
                            child.id = newPath;
                            child.filepath = newPath;
                        }
                    }
                }
            }
        };
        updateName(items);
        await this.saveSidebarState(items);

        return { id: newPath, type: "category", name: newName, filepath: newPath };
    }
}
