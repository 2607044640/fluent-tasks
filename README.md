# Fluent Tasks

A beautiful, drag-and-drop task manager for Obsidian, inspired by Microsoft To-Do and Microsoft's Fluent Design principles.

> [!NOTE]
> If you are looking for a local alternative to **Microsoft To-Do**, **Todoist**, **TickTick (滴答清单)**, **Things 3**, or **Google Tasks** directly inside your Obsidian vault, Fluent Tasks provides a beautiful drag-and-drop workflow that stores all your lists and tasks in standard Markdown files.

## Features

### 1. Hierarchical Lists & Group Management
Organize your task lists into drag-and-drop groups. Easily reorder lists, create groups, or drag lists out of groups in the sidebar.

![Lists and Groups Demo](https://raw.githubusercontent.com/2607044640/fluent-tasks/main/docs/assets/lists_and_groups.gif)

### 2. Task Details, Subtasks & Starring
Add multi-step checklist subtasks, star/pin priority items, write notes, and mark tasks as complete with real-time UI updates.

![Task Features Demo](https://raw.githubusercontent.com/2607044640/fluent-tasks/main/docs/assets/task_features.gif)

### 3. Custom Accent Colors
Customize the primary accent color to match your personal theme preference.

![Custom Accent Color Demo](https://raw.githubusercontent.com/2607044640/fluent-tasks/main/docs/assets/custom_colors.gif)

---

## How to Use

1. **Install & Enable**: Install Fluent Tasks from the Obsidian Community Store and enable it.
2. **Open Sidebar**: The task sidebar is opened automatically on startup. You can also open it via the Command Palette (`Ctrl+P` -> `Fluent Tasks: Open Sidebar`).
3. **Create Lists & Groups**: Create a new task list or group from the bottom of the sidebar.
4. **Manage Tasks**: Click a list to view its tasks, drag them to reorder, or click a task to view and edit its details.

---

## Markdown Data Storage

Fluent Tasks respects your data ownership. All lists are stored as `.md` files inside the `TodoData/` folder in your vault. Tasks are saved in standard checklist formatting, with metadata stored inside discrete HTML/Markdown comments:

```markdown
- [ ] Buy groceries %%{"id":"t-1234","starred":false,"steps":[],"note":"","createdAt":"2026-07-17T08:00:00Z"}%%
- [x] Walk the dog %%{"id":"t-5678","starred":true,"steps":[{"text":"Grab leash","done":true}],"note":"Likes the park.","createdAt":"2026-07-16T09:00:00Z"}%%
```

---

## License

This project is licensed under the [MIT License](LICENSE).

---

###### Keywords
`microsoft todo` `todoist alternative` `ticktick` `滴答清单` `things3` `google tasks` `task manager` `checklist` `task planner` `todo list` `kanban` `fluent design` `glassmorphism`
