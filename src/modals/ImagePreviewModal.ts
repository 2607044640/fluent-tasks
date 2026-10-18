import { Modal, App } from "obsidian";
import ImagePreviewModalView from "./ImagePreviewModalView.svelte";

export interface ImagePreviewModalOptions {
    onCut?: () => void;
    onDelete?: () => void;
}

export class ImagePreviewModal extends Modal {
    private component: ImagePreviewModalView | null = null;
    private imageRef: string;
    private options?: ImagePreviewModalOptions;

    constructor(app: App, imageRef: string, options?: ImagePreviewModalOptions) {
        super(app);
        this.imageRef = imageRef;
        this.options = options;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.addClass("task-img-preview-modal-shell");

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

    onClose() {
        if (this.component) {
            this.component.$destroy();
            this.component = null;
        }
    }
}
