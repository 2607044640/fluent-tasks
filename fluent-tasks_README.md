# Fluent Tasks - External Usage Guide

<context>
For underlying architecture modifications, data flow, and troubleshooting, please refer to: `fluent-tasks_Architecture.md`.
</context>

## Public Integration APIs

<api_reference>
| Method | Signature | Side-Effects |
| :--- | :--- | :--- |
| `TaskMainViewWrapper.file` | `get file(): TFile | null` | Pure getter. Returns the underlying markdown `TFile` of the currently active category (e.g. `TodoData/ag.md`). |
| `TaskMainViewWrapper.component.getCurrentCategory()` | `() => CategoryInfo | null` | Pure getter. Returns the metadata of the currently selected category in the main Svelte view. |
</api_reference>

<adding_new_item_recipe>
To fetch the current task file from an external plugin (e.g. `open-vscode`):
1. Query the active leaf or specific `fluent-tasks-main` leaf.
2. Access the `.file` property on the view instance.
```javascript
const mainLeaf = this.app.workspace.getLeavesOfType("fluent-tasks-main")[0];
if (mainLeaf && mainLeaf.view && mainLeaf.view.file) {
    const taskFile = mainLeaf.view.file; // Returns TFile
}
```
</adding_new_item_recipe>

## Image Frames & Icons (AI Agent Integration)

<image_frames_guide>
Fluent Tasks allows AI agents or users to inject visual "Image Frames" into tasks using Markdown metadata `%%{...}%%`. The rendering engine supports both Obsidian's official Lucide icons and raw SVG code.

### 1. Obsidian Official Icons (Lucide) - Recommended
To display Obsidian's native Lucide icons, prefix the icon name with `lucide-`. This method is highly recommended because it uses native API `setIcon()` for perfect theme matching and performance.
```markdown
- [ ] Research new logo designs %%{"id":"t1","frames":[["lucide-pencil", "lucide-palette"], ["lucide-image"]]}%%
```

### 2. Custom SVG Injection (Fallback)
If a specific icon is not available in Lucide, you can inject raw SVG code directly into the frame array.
```markdown
- [ ] Deploy server %%{"id":"t2","frames":[["<svg viewBox='0 0 24 24' fill='currentColor'><path d='M12 2L2 22h20L12 2z'/></svg>"]]}%%
```

### Limits & Configuration
- **Data Structure (`frames: string[][]`)**: Each inner array represents one "Frame" (a visual border box).
- **Settings Control**: Users can configure the `Max Image Frames` (default: 3) and `Max Icons Per Frame` (default: 5) via the plugin's Settings panel to prevent UI bloat.
</image_frames_guide>
