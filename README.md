# Fluent Tasks - A beautiful task manager for Obsidian

**Author**: Jeff1024  
**Framework**: TypeScript + Svelte  
**Build**: `npm run build`

---

## 部署方法：NTFS Junction 链接

此插件的源码位于 `C:\ObsidianDev\plugins\MStodo`，需要通过 NTFS Junction（目录符号链接）映射到 Obsidian Vault 的插件目录中，Obsidian 才能识别并加载它。

### 执行步骤

**前提**：确认你的 Obsidian Vault 路径。以下示例假设 Vault 在 `C:\ObsidianNote`。

**1. 以管理员身份打开 PowerShell 或 CMD**

**2. 执行以下命令（二选一）：**

PowerShell：
```powershell
New-Item -ItemType Junction -Path "C:\ObsidianNote\.obsidian\plugins\MStodo" -Target "C:\ObsidianDev\plugins\MStodo"
```

CMD：
```cmd
mklink /J "C:\ObsidianNote\.obsidian\plugins\MStodo" "C:\ObsidianDev\plugins\MStodo"
```

**3. 验证**：在 Obsidian 中打开 设置 → 社区插件，应该能看到 MStodo。启用后按 `Ctrl+P` 搜索 `Open MStodo`。

### 注意事项
- Junction 的 **第一个参数是目标位置**（Vault 插件目录内），**第二个参数是源码位置**（本项目）。
- 如果目标路径已存在同名文件夹，必须先删除它再创建 Junction。
- Junction 不需要管理员权限（与 symlink 不同），但如果报权限错误，请用管理员终端。

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
