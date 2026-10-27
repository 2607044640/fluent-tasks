import { Modal, App } from "obsidian";
import ImagePreviewModalView from "./ImagePreviewModalView.svelte";

export interface ImagePreviewModalOptions {
    onCut?: () => void;
    onDelete?: () => void;
}

export class ImagePreviewModal extends Modal {
    public static isOpen = false;
    public static lastClosedAt = 0;

    public static isImagePreviewActive(): boolean {
        if (this.isOpen) return true;
        if (Date.now() - this.lastClosedAt < 300) return true;
        return !!(
            document.querySelector(".task-img-preview-modal-shell") ||
            document.querySelector(".task-img-preview-backdrop") ||
            document.body?.classList?.contains("has-active-image-preview")
        );
    }

    private component: ImagePreviewModalView | null = null;
    private imageRef: string;
    private options?: ImagePreviewModalOptions;

    constructor(app: App, imageRef: string, options?: ImagePreviewModalOptions) {
        super(app);
        this.imageRef = imageRef;
        this.options = options;
    }

    onOpen() {
        ImagePreviewModal.isOpen = true;
        document.body?.classList?.add("has-active-image-preview");

        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("task-img-preview-modal-shell");

        // Intercept Escape key on this modal's scope and return false to completely halt Obsidian Keymap from propagating to lower scopes
        this.scope.register([], "Escape", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            this.close();
            return false;
        });

        this.component = new ImagePreviewModalView({
            target: contentEl,
            props: {
                app: this.app,
                imageRef: this.imageRef,
                onCut: this.options?.onCut,
                onDelete: this.options?.onDelete,
                closeModal: () => this.close(),
            },
        });
    }

    close() {
        ImagePreviewModal.isOpen = false;
        ImagePreviewModal.lastClosedAt = Date.now();
        setTimeout(() => {
            document.body?.classList?.remove("has-active-image-preview");
        }, 300);
        super.close();
    }

    onClose() {
        ImagePreviewModal.isOpen = false;
        ImagePreviewModal.lastClosedAt = Date.now();
        setTimeout(() => {
            document.body?.classList?.remove("has-active-image-preview");
        }, 300);
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }
}
