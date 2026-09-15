import type { SidebarItem, CategoryInfo, GroupInfo } from "../types";

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

    // 2. Drop inside a group
    if (position === "inside") {
        return tempItems.map(item => {
            if (item.type === "group" && item.id === targetId) {
                return {
                    ...item,
                    isExpanded: true,
                    items: [...item.items, listToMove as CategoryInfo]
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
                if (p === "top") {
                    nextList.push(itemToInsert);
                    nextList.push(item);
                } else {
                    nextList.push(item);
                    nextList.push(itemToInsert);
                }
            } else if (item.type === "group") {
                const targetIdx = item.items.findIndex(c => c.id === tId);
                if (targetIdx !== -1) {
                    const newChildren = [...item.items];
                    const filtered = newChildren.filter(c => c.id !== itemToInsert.id);
                    const insertIdx = filtered.findIndex(c => c.id === tId);
                    
                    if (p === "top") {
                        filtered.splice(insertIdx, 0, itemToInsert as CategoryInfo);
                    } else {
                        filtered.splice(insertIdx + 1, 0, itemToInsert as CategoryInfo);
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

    return insertNextTo(tempItems, targetId, listToMove as SidebarItem, position);
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
        return [...nextItems, listToMove];
    }

    return nextItems.map(item => {
        if (item.type === "group" && item.id === targetGroupId) {
            return {
                ...item,
                isExpanded: true,
                items: [...item.items, listToMove as CategoryInfo]
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
    nextItems.splice(groupIdx, 1, ...children);
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

