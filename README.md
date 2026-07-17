# Fluent Tasks - A beautiful task manager for Obsidian

**Author**: Jeff1024  
**Framework**: TypeScript + Svelte  
**Build**: `npm run build`

---

## 部署与发布架构：双 Junction 软链接
为了避免 GitHub Desktop 中的嵌套子仓库 (Submodule) 冲突与路径限制，本项目采用了**双 Junction 软链接架构**：
* **物理仓库 (Source of Truth)**: `C:\ObsidianPublish\fluent-tasks`（包含独立的 Git 历史，用于 GitHub Desktop 进行版本管理与推送）。
* **开发工作区 (Workspace Link)**: `C:\ObsidianDev\plugins\fluent-tasks`（通过 Junction 软链接指向物理仓库，保证 AI 编译与编辑权限）。
* **Obsidian 插件库 (Obsidian Vault Link)**: `C:\ObsidianNote\.obsidian\plugins\fluent-tasks`（通过 Junction 软链接指向物理仓库，保证实时加载运行）。

### 重新建立软链接步骤（如果链接损坏）
如果您需要重新生成这些软链接，请依次执行以下 PowerShell 命令：
```powershell
# 1. 清理可能存在的旧软链接（用 os.rmdir 保证物理文件安全）
python -c "import os; os.path.exists(r'C:\ObsidianDev\plugins\fluent-tasks') and os.rmdir(r'C:\ObsidianDev\plugins\fluent-tasks')"
python -c "import os; os.path.exists(r'C:\ObsidianNote\.obsidian\plugins\fluent-tasks') and os.rmdir(r'C:\ObsidianNote\.obsidian\plugins\fluent-tasks')"

# 2. 创建开发工作区软链接
New-Item -ItemType Junction -Path "C:\ObsidianDev\plugins\fluent-tasks" -Target "C:\ObsidianPublish\fluent-tasks"

# 3. 创建 Obsidian 库内软链接
New-Item -ItemType Junction -Path "C:\ObsidianNote\.obsidian\plugins\fluent-tasks" -Target "C:\ObsidianPublish\fluent-tasks"
```

---

## 架构简述

```
src/
├── types.ts              # 共享类型、常量、事件枚举
├── EventBus.ts           # 跨视图解耦通信（pub/sub）
├── DataService.ts        # 所有 Vault I/O 操作（CRUD + 跨区迁移）
├── MarkdownParser.ts     # 纯函数 Markdown ↔ TaskItem 序列化
├── Logger.ts             # 调试日志（输出到 TodoData/debug.log）
├── TaskSidebarView.svelte # 左侧列表栏
├── TaskMainView.svelte    # 中间任务视图
├── TaskDetailView.svelte  # 右侧详情面板
├── main.ts               # 插件入口
├── styles.css            # 全局样式（紫色主题）
└── svelte.d.ts           # Svelte 类型声明
```

## 数据存储

每个列表 = Vault 根目录下 `TodoData/` 文件夹中的一个 `.md` 文件。任务以标准 Markdown checklist 格式存储，元数据藏在 `%%{JSON}%%` 不可见注释中：

```markdown
- [ ] 买牛奶 %%{"id":"abc","starred":false,"steps":[],"note":"","createdAt":"2025-12-05T10:00:00Z"}%%
- [x] 遛狗 %%{"id":"def","starred":true,"steps":[{"text":"拿绳子","done":true}],"note":"他喜欢公园","createdAt":"2025-12-04T09:00:00Z"}%%
```
