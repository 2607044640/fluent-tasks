# Fluent Tasks

A beautiful, drag-and-drop task manager for Obsidian, inspired by Microsoft To-Do and Microsoft's Fluent Design principles.

> [!NOTE]
> If you are looking for a local alternative to **Microsoft To-Do**, **Todoist**, **TickTick (滴答清单)**, **Things 3**, or **Google Tasks** directly inside your Obsidian vault, Fluent Tasks provides a beautiful drag-and-drop workflow that stores all your lists and tasks in standard Markdown files.

<context>
For underlying architecture modifications, data flow sequence, component boundaries, and AI-assisted development ("vibe coding"), please refer to: [fluent-tasks_Architecture.md](file:///C:/ObsidianPublish/fluent-tasks/fluent-tasks_Architecture.md).
</context>

## Features

### 1. Hierarchical Lists & Group Management
- **Lists & Groups**: Organize your task lists into drag-and-drop groups. Easily reorder lists, create groups, or drag lists out of groups in the sidebar.
- **F2 Hover Rename & Context Menu**: Hover over any list or group and press <kbd>F2</kbd> (or right-click -> `Rename List/Group`) to rename it inline immediately without disrupting your workflow.

![Lists and Groups Demo](https://raw.githubusercontent.com/2607044640/fluent-tasks/main/docs/assets/lists_and_groups.gif)

### 2. Physics-Based Drag & Drop System
- **In-List Reordering**: Grab and drag tasks up and down with physics animations and uniform auto-scrolling when approaching list edges.
- **Cross-Pane Task Transfer**: Drag any task from the center task list directly across onto any list or group in the left sidebar to move it instantly.
- **Sidebar Hierarchy Organization**: Drag lists into groups to nest them, reorder groups, or pull nested lists back to the root level.

### 3. Task Quick Peek, Subtask Badges & Full-Screen Visuals
- **Multi-line Title Wrapping (`wrapTaskTitles`)**: Enabled by default (`true`). Long task titles automatically wrap onto multiple lines in the center list without truncating or requiring the right detail sidebar to be opened.
- **Sticky Ctrl + Hover Quick Peek**: Pressing <kbd>Ctrl</kbd> (or <kbd>Cmd</kbd> on macOS) while hovering over any task title displays a rich Quick Peek card containing full unclipped titles, subtasks checklist progress, notes, and due dates. Releasing Ctrl keeps the card pinned until you right-click or preview another task.
- **Direct Hover Badges (Zero-Ctrl Required)**:
  - **Subtasks Checklist (`0/x steps`)**: Direct hover over the step counter on any task reveals an interactive checklist popover showing all step items, check status (`✓` / `○`), and completion stats.
  - **Why Rationale (`?`)**: Attach development instructions or causal reasoning to tasks with instant hover popovers.
  - **Visual Memory SVGs (`🖼️`)**: Attach vault or inline SVG diagrams. Hover for instant preview; click for an immersive full-screen (`96vw × 94vh`) zoom lightbox with auto-scaling vector diagrams and one-click "Open in Tab" navigation.
  - **Linked Notes (`📄`)**: Link Obsidian or OneNote notes (`[[Topic#^block]]`). Direct hover triggers native Page Preview without modifier keys; click to jump straight to the note.
  - **Custom Metadata Properties (`🏷️`)**: Add and manage arbitrary key-value tags with interactive popovers.

### 4. Due Dates, Reminders & Recurring Tasks
Set due dates, custom repeat intervals (daily, weekdays Mon–Fri, weekly on chosen days, or custom interval rollover), and schedule drawer toggles with automatic next occurrence advance upon completion.

![Recurring Tasks Demo](https://raw.githubusercontent.com/2607044640/fluent-tasks/main/docs/assets/recurring_tasks.gif)

### 5. Task Details, Subtasks & Priority Starring
Add multi-step checklist subtasks, star/pin priority items, write rich markdown notes, and toggle completed tasks with a clean accordion view.

![Task Details Demo](https://raw.githubusercontent.com/2607044640/fluent-tasks/main/docs/assets/task_features.gif)

### 6. Quick Task Modal (Keyboard-First Floating Manager)
- **Maximized Dual-Pane View**: Press your custom shortcut (or `Ctrl+P` -> `Open Quick Task Modal`) to summon an expansive (`92vw × 86vh`) floating manager.
- **Full Keyboard Navigation**: Navigate lists and tasks using <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd>, hit <kbd>Space</kbd> to toggle completion, press <kbd>Ctrl+N</kbd> to add tasks inline, and <kbd>Ctrl+Enter</kbd> to toggle priority star.
- **In-Modal Drag & Drop**: Freely reorder tasks or drag them across onto target lists in the left pane.
- **Hover Previews**: Direct hover previews for subtasks, why rationales, SVG memory aids, and note links.
- **Dual Operating Modes**: Switch in settings between *Direct in-modal management* (popup checklist) and *Workspace navigation* (opens list & details in main view).

### 7. Quick List Modal (List-Only Workspace Navigator)
- **Sidebar-Free Navigation**: Trigger `Open Quick List Modal (List only)` to browse all lists with fuzzy search and uncompleted task counters.
- **Clean Workspace Focus**: Selecting a list reveals it in the center task view **without opening or expanding the left sidebar**.

### 8. Instant Global Search
Click `🔍` in the category header or trigger Search Modal anytime to search through tasks across all lists in milliseconds.

### 9. Custom Accent Colors
Customize the primary accent color to match your personal theme preference.

![Custom Accent Color Demo](https://raw.githubusercontent.com/2607044640/fluent-tasks/main/docs/assets/custom_colors.gif)

---

## How to Use

1. **Install & Enable**: Install Fluent Tasks from the Obsidian Community Store and enable it.
2. **Open Sidebar**: The task sidebar is opened automatically on startup. You can also open it via the Command Palette (`Ctrl+P` -> `Fluent Tasks: Open Sidebar`).
3. **Assign Quick Hotkeys**: Go to **Settings → Hotkeys** to bind shortcuts to `Fluent Tasks: Open Quick Task Modal` or `Fluent Tasks: Open Quick List Modal`.
4. **Create Lists & Groups**: Create a new task list or group from the bottom of the sidebar.
5. **Manage & Drag Tasks**: Click a list to view its tasks, drag them to reorder or drag onto sidebar lists to move, or click a task to view and edit its details.
6. **Quick Shortcuts**: Hover over task titles with <kbd>Ctrl</kbd> for quick peeks; hover badges for instant metadata previews; right-click anywhere to dismiss popovers.
7. **Features & Shortcuts Guide**: Click the `?` icon in the pane header action bar (next to `⋮`) anytime to open the complete interactive guide.

---

## Markdown Data Storage

Fluent Tasks respects your data ownership. All lists are stored as `.md` files inside the `TodoData/` folder in your vault. Tasks are saved in standard checklist formatting, with metadata stored inside discrete HTML/Markdown comments:

```markdown
- [ ] Buy groceries %%{"id":"t-1234","starred":false,"steps":[],"note":"","createdAt":"2026-07-17T08:00:00Z"}%%
- [x] Walk the dog %%{"id":"t-5678","starred":true,"steps":[{"text":"Grab leash","done":true}],"note":"Likes the park.","createdAt":"2026-07-16T09:00:00Z"}%%
```

---

## Contributing & Vibe Coding

We welcome contributions! Whether you are writing TypeScript code directly or using AI agents ("vibe coding"), follow these steps to get started:

1. **Clone & Install**:
   ```bash
   git clone https://github.com/2607044640/fluent-tasks.git
   cd fluent-tasks
   npm install
   ```
2. **Build & Watch**:
   - Development watch mode: `npm run dev`
   - Production build: `npm run build`
3. **Architecture Reference**:
   Read [fluent-tasks_Architecture.md](file:///C:/ObsidianPublish/fluent-tasks/fluent-tasks_Architecture.md) to understand state flows, EventBus events, and strict system invariants before submitting pull requests.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

###### Keywords
`microsoft todo` `todoist alternative` `ticktick` `滴答清单` `things3` `google tasks` `task manager` `checklist` `task planner` `todo list` `kanban` `fluent design` `glassmorphism`
