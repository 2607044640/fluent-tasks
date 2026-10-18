import type { SidebarItem, CategoryInfo, GroupInfo } from "../types";

/**
 * Resolves a unique display name against a list of existing names.
 * If desiredName does not exist in existingNames, returns desiredName.
 * If desiredName already exists in existingNames, returns desiredName(1), desiredName(2), etc.
 */
export function resolveUniqueName(existingNames: string[], desiredName: string): string {
    const trimmed = desiredName.trim();
    if (!existingNames.includes(trimmed)) {
        return trimmed;
    }

    // Check if trimmed already ends with (number)
    const match = trimmed.match(/^(.*?)(?:\s*\(([0-9]+)\))?$/);
    const base = (match && match[1]) ? match[1].trim() : trimmed;
    let index = (match && match[2]) ? parseInt(match[2], 10) + 1 : 1;

    while (existingNames.includes(`${base}(${index})`)) {
        index++;
    }

    return `${base}(${index})`;
}

/**
 * Ensures that if a moving category has a name conflict in destinationCategoryNames,
 * its name is auto-disambiguated with (1), (2), etc.
 */
function ensureUniqueCategoryName(
    item: SidebarItem | CategoryInfo,
    destinationCategoryNames: string[]
): SidebarItem | CategoryInfo {
    if (item.type === "category" || ("filepath" in item && !("items" in item))) {
        const cat = item as CategoryInfo;
        if (destinationCategoryNames.includes(cat.name)) {
            const uniqueName = resolveUniqueName(destinationCategoryNames, cat.name);
            return { ...cat, name: uniqueName };
        }
    }
    return item;
}

/**
 * Moves an item (list or group) to a new position relative to targetId.
 * Supports 'top', 'bottom', and 'inside' (placing a category into a group).
 */
export function moveSidebarItem(
    items: SidebarItem[],
    movedItemId: string,
    targetId: string,
    position: "top" | "bottom" | "inside"
): SidebarItem[] {
    if (!movedItemId || !targetId || movedItemId === targetId) return items;

    let listToMove: SidebarItem | CategoryInfo | null = null;

    // 1. Extract item from tree recursively
    const extractItem = (list: SidebarItem[]): SidebarItem[] => {
        const nextList: SidebarItem[] = [];
        for (const item of list) {
            if (item.id === movedItemId) {
                listToMove = item;
            } else if (item.type === "group") {
                const childIdx = item.items.findIndex(c => c.id === movedItemId);
                if (childIdx !== -1) {
                    listToMove = item.items[childIdx];
                    nextList.push({
                        ...item,
                        items: item.items.filter(c => c.id !== movedItemId)
                    });
                } else {
                    nextList.push(item);
                }
            } else {
                nextList.push(item);
            }
        }
        return nextList;
    };

    let tempItems = extractItem(items);
    if (!listToMove) return items;

    // Special case: moving to root level when targetId is "__root__" or "root"
    if (targetId === "__root__" || targetId === "root") {
        const rootCategoryNames = tempItems.filter(i => i.type === "category").map(c => c.name);
        const resolvedItem = ensureUniqueCategoryName(listToMove, rootCategoryNames) as SidebarItem;
        if (position === "top") {
            return [resolvedItem, ...tempItems];
        } else {
            return [...tempItems, resolvedItem];
        }
    }

    // 2. Drop inside a group
    if (position === "inside") {
        return tempItems.map(item => {
            if (item.type === "group" && item.id === targetId) {
                const groupNames = item.items.map(c => c.name);
                const resolvedItem = ensureUniqueCategoryName(listToMove!, groupNames) as CategoryInfo;
                return {
                    ...item,
                    isExpanded: true,
                    items: [...item.items, resolvedItem]
                };
            }
            return item;
        });
    }

    // 3. Drop top / bottom next to target
    const insertNextTo = (list: SidebarItem[], tId: string, itemToInsert: SidebarItem, p: "top" | "bottom"): SidebarItem[] => {
        const nextList: SidebarItem[] = [];
        for (const item of list) {
            if (item.id === tId) {
                const rootNames = list.filter(i => i.type === "category").map(c => c.name);
                const resolved = ensureUniqueCategoryName(itemToInsert, rootNames) as SidebarItem;
                if (p === "top") {
                    nextList.push(resolved);
                    nextList.push(item);
                } else {
                    nextList.push(item);
                    nextList.push(resolved);
                }
            } else if (item.type === "group") {
                const targetIdx = item.items.findIndex(c => c.id === tId);
                if (targetIdx !== -1) {
                    const newChildren = [...item.items];
                    const filtered = newChildren.filter(c => c.id !== itemToInsert.id);
                    const insertIdx = filtered.findIndex(c => c.id === tId);

                    const groupNames = filtered.map(c => c.name);
                    const resolvedChild = ensureUniqueCategoryName(itemToInsert, groupNames) as CategoryInfo;

                    if (p === "top") {
                        filtered.splice(insertIdx, 0, resolvedChild);
                    } else {
                        filtered.splice(insertIdx + 1, 0, resolvedChild);
                    }
                    
                    nextList.push({
                        ...item,
                        items: filtered
                    });
                } else {
                    nextList.push(item);
                }
            } else {
                nextList.push(item);
            }
        }
        return nextList;
    };

    return insertNextTo(tempItems, targetId, listToMove, position);
}

/**
 * Toggles expanded/collapsed state of a group.
 */
export function toggleGroupExpandedState(items: SidebarItem[], groupId: string): SidebarItem[] {
    return items.map(item => {
        if (item.type === "group" && item.id === groupId) {
            return {
                ...item,
                isExpanded: !item.isExpanded
            };
        }
        return item;
    });
}

/**
 * Extracts a flat array of all CategoryInfo items from a hierarchical SidebarItem tree.
 */
export function getFlatCategories(items: SidebarItem[]): CategoryInfo[] {
    const result: CategoryInfo[] = [];
    for (const item of items) {
        if (item.type === "category") {
            result.push(item);
        } else if (item.type === "group" && Array.isArray(item.items)) {
            for (const child of item.items) {
                result.push(child);
            }
        }
    }
    return result;
}

/**
 * Moves a list item directly into a target group or out to the root list.
 */
export function moveListToGroupOrRoot(
    items: SidebarItem[],
    listId: string,
    targetGroupId: string
): SidebarItem[] {
    let listToMove: SidebarItem | CategoryInfo | null = null;
    let nextItems: SidebarItem[] = [];

    // 1. Extract item from tree
    for (const item of items) {
        if (item.id === listId) {
            listToMove = item;
        } else if (item.type === "group") {
            const childIdx = item.items.findIndex(c => c.id === listId);
            if (childIdx !== -1) {
                listToMove = item.items[childIdx];
                nextItems.push({
                    ...item,
                    items: item.items.filter(c => c.id !== listId)
                });
            } else {
                nextItems.push(item);
            }
        } else {
            nextItems.push(item);
        }
    }

    if (!listToMove) return items;

    // 2. Insert into target group or append to root
    if (targetGroupId === "root") {
        const rootNames = nextItems.filter(i => i.type === "category").map(c => c.name);
        const resolved = ensureUniqueCategoryName(listToMove, rootNames);
        return [...nextItems, resolved as SidebarItem];
    }

    return nextItems.map(item => {
        if (item.type === "group" && item.id === targetGroupId) {
            const groupNames = item.items.map(c => c.name);
            const resolved = ensureUniqueCategoryName(listToMove!, groupNames) as CategoryInfo;
            return {
                ...item,
                isExpanded: true,
                items: [...item.items, resolved]
            };
        }
        return item;
    });
}

/**
 * Deletes a group from the tree and unwraps its child lists to the same position in the root hierarchy.
 */
export function deleteGroupFromTree(items: SidebarItem[], groupId: string): SidebarItem[] {
    const groupIdx = items.findIndex(i => i.id === groupId && i.type === "group");
    if (groupIdx === -1) return items;

    const group = items[groupIdx] as GroupInfo;
    const children = group.items || [];

    const nextItems = [...items];
    nextItems.splice(groupIdx, 1);

    const rootNames = nextItems.filter(i => i.type === "category").map(c => c.name);
    const resolvedChildren: CategoryInfo[] = [];
    for (const child of children) {
        const uniqueName = resolveUniqueName(rootNames, child.name);
        rootNames.push(uniqueName);
        resolvedChildren.push({
            ...child,
            name: uniqueName
        });
    }

    nextItems.splice(groupIdx, 0, ...resolvedChildren);
    return nextItems;
}

/**
 * Filters a hierarchical SidebarItem tree by search query.
 * When matching children in a group, returns the group with isExpanded=true and filtered children.
 * If the group name matches, preserves all its children.
 */
export function filterSidebarTree(items: SidebarItem[], query: string): SidebarItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return items;

    const result: SidebarItem[] = [];
    for (const item of items) {
        if (item.type === "category") {
            if (item.name.toLowerCase().includes(q)) {
                result.push(item);
            }
        } else if (item.type === "group") {
            const matchingChildren = (item.items || []).filter(c => c.name.toLowerCase().includes(q));
            if (item.name.toLowerCase().includes(q) || matchingChildren.length > 0) {
                result.push({
                    ...item,
                    isExpanded: true,
                    items: matchingChildren.length > 0 ? matchingChildren : item.items
                });
            }
        }
    }
    return result;
}

