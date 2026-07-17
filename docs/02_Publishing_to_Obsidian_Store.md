# 02_Publishing_to_Obsidian_Store (上架官方商店流程)

上架 Obsidian 商店**完全免费**，但由于是人工审核代码，需要严格遵守他们的提交流程。

## 前置准备 (Preparation)
1. **完善 GitHub 仓库**：你的插件必须开源托管在 GitHub 上。
2. **打标签发版 (Create a Release)**：
   - 确保 `manifest.json` 里的 `version` 已经更新（例如 `1.0.0`）。
   - 在 GitHub 的 Releases 页面新建一个 release，Tag 必须与 version 保持一致。
   - 上传三个编译好的核心文件到该 release 的附件中：`main.js`, `manifest.json`, `styles.css`。

## 提交审核 (Submission)
Obsidian 官方已于 2024 年关闭了 GitHub 手动 Pull Request 提交通道，所有新插件必须通过官方的新版开发者门户进行提交。

1. **创建 GitHub Release**：
   - 在你的插件 GitHub 仓库中，创建一个对应版本号的 Release（例如 `1.0.0`）。
   - 必须在 Release 附件中上传编译好的 3 个核心文件：`main.js`、`manifest.json`、`styles.css` (如有)。
2. **登录开发者门户**：
   - 访问并登录 **[Obsidian Developer Portal (community.obsidian.md)](https://community.obsidian.md/)**。
3. **绑定与提交**：
   - 登录你的 Obsidian 账号，并在门户设置中绑定你的 GitHub 账号。
   - 导航至 **Plugins** 标签页，点击 **New plugin**（新插件）。
   - 输入你的插件 GitHub 仓库 URL，确认信息并提交审核！

## 等待审核 (Wait for Review)
- Obsidian 官方开发者（如 Licat）会逐行人工 Review 你的代码。
- 审核周期大概在 1~3 周左右。
- 如果代码被退回，他们会在 PR 留言里告诉你需要修改哪里。你只需修改自己的代码并重新发一个 Release，然后在 PR 里回复 "Done" 即可。
- 一旦他们点下 "Merge"，你的插件就会瞬间出现在全球用户的 Obsidian 插件搜索列表里！
