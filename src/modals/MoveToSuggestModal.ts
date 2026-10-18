import { App, FuzzySuggestModal } from "obsidian";
import type { CategoryInfo } from "../types";
import { t } from "../lang/helpers";

export class MoveToSuggestModal extends FuzzySuggestModal<CategoryInfo> {
    private categories: CategoryInfo[];
    private onChoose: (category: CategoryInfo) => void;

    constructor(app: App, categories: CategoryInfo[], onChoose: (category: CategoryInfo) => void) {
        super(app);
        this.categories = categories;
        this.onChoose = onChoose;
        this.setPlaceholder(t("search_list_to_move") || "Search destination list...");
    }

    getItems(): CategoryInfo[] {
        return this.categories;
    }

    getItemText(item: CategoryInfo): string {
        return item.name;
    }

    onChooseItem(item: CategoryInfo, _evt: MouseEvent | KeyboardEvent): void {
        this.onChoose(item);
    }
}
