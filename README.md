# Fluent Tasks

A beautiful, drag-and-drop task manager for Obsidian, inspired by Microsoft To-Do and Microsoft's Fluent Design principles.

![Fluent Tasks Presentation](https://raw.githubusercontent.com/Jeff1024/obsidian-fluent-tasks/main/docs/assets/preview.png)

## ✨ Features

- **Stunning UI/UX**: Clean light and dark modes with elegant glassmorphism, tailored HSL color palettes, and smooth animations.
- **Drag-and-Drop Simplicity**: 
  - Easily reorder tasks within a list.
  - Move tasks instantly between lists.
  - Reorder, group, or drag lists out of groups in the sidebar.
- **Hierarchical Groups**: Keep your sidebar organized by grouping task lists together.
- **Robust Task Detail Panel**: Add multi-step subtasks, star/pin important tasks, add notes, and track creation dates.
- **100% Offline & Local**: Your tasks are stored directly inside your vault as standard Markdown checklists.

## 🚀 How to Use

1. **Install & Enable**: Install Fluent Tasks from the Obsidian Community Store and enable it.
2. **Open Sidebar**: The task sidebar is opened automatically on startup. You can also open it via the Command Palette (`Ctrl+P` -> `Fluent Tasks: Open Sidebar`).
3. **Create Lists & Groups**: Create a new task list or group from the bottom of the sidebar.
4. **Manage Tasks**: Click a list to view its tasks, drag them to reorder, or click a task to view and edit its details.

## 💾 Markdown Data Storage

Fluent Tasks respects your data ownership. All lists are stored as `.md` files inside the `TodoData/` folder in your vault. Tasks are saved in standard checklist formatting, with metadata stored inside discrete HTML/Markdown comments:

```markdown
- [ ] Buy groceries %%{"id":"t-1234","starred":false,"steps":[],"note":"","createdAt":"2026-07-17T08:00:00Z"}%%
- [x] Walk the dog %%{"id":"t-5678","starred":true,"steps":[{"text":"Grab leash","done":true}],"note":"Likes the park.","createdAt":"2026-07-16T09:00:00Z"}%%
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
