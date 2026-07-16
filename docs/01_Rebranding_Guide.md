# 01_Rebranding_Guide (插件重命名与重构指南)

在正式发布到社区之前，建议给插件取一个更专业的“商业化”名称。

## 1. 命名建议 (Naming Suggestions)
为了避免带有 "Microsoft" 或 "MS" 引发侵权或误导（用户可能会以为能云端同步微软账号），建议从以下名字中选择：

- **Fluent Tasks** (强烈推荐)：微软的 UI 设计语言就叫 Fluent Design，高级且无版权风险。
- **Tasks (Fluent UI)**：简单直接，说明是任务管理并附带 Fluent UI 界面。
- **A1 To-Do / A1 Tasks**：强化 "A1" 个人厂牌，打造系列插件。

## 2. 发布前需要替换的内容清单 (Refactoring Checklist)
一旦你决定了正式的名字（假设叫 `Fluent Tasks`），你需要全局搜索并替换以下内容：

- [ ] `manifest.json`：
  - `id`: 比如改成 `obsidian-fluent-tasks`
  - `name`: 比如改成 `Fluent Tasks`
  - `description`: 写一句精简干练的英文介绍，例如 "A beautiful, drag-and-drop task manager inspired by Fluent Design."
- [ ] `package.json`：修改项目的 `name` 字段。
- [ ] `src/main.ts` 等源码中的日志打印前缀 (e.g., `[MSTodo]` -> `[FluentTasks]`)
- [ ] UI 面板显示的标题（`getDisplayText()`）
