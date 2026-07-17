# 02_Publishing_to_Obsidian_Store (上架官方商店流程)

上架 Obsidian 商店**完全免费**，但由于是人工审核代码，需要严格遵守他们的提交流程。

## 前置准备 (Preparation)
1. **完善 GitHub 仓库**：你的插件必须开源托管在 GitHub 上。
2. **打标签发版 (Create a Release)**：
   - 确保 `manifest.json` 里的 `version` 已经更新（例如 `1.0.0`）。
   - 在 GitHub 的 Releases 页面新建一个 release，Tag 必须与 version 保持一致。
   - 上传三个编译好的核心文件到该 release 的附件中：`main.js`, `manifest.json`, `styles.css`。

## 提交审核 (Submission)
1. 访问 Obsidian 的官方发布仓库：[obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)。
2. Fork 这个仓库到你自己的 GitHub 账号下。
3. 在你 Fork 后的仓库里，找到 `community-plugins.json` 这个大列表，把你的插件信息按 JSON 格式加到**文件最底部**。
   ```json
   {
       "id": "fluent-tasks",
       "name": "Fluent Tasks",
       "author": "YourName",
       "description": "A beautiful, drag-and-drop task manager inspired by Fluent Design.",
       "repo": "YourName/obsidian-fluent-tasks"
   }
   ```
4. 提交一个 **Pull Request (PR)** 给官方仓库。
5. **填写 PR 模板**：PR 描述里会有一长串官方要求的“检查清单 (Checklist)”，你必须逐字阅读并打勾确认你没有违规（例如没有恶意联网、没有滥用底层的 DOM API）。

## 等待审核 (Wait for Review)
- Obsidian 官方开发者（如 Licat）会逐行人工 Review 你的代码。
- 审核周期大概在 1~3 周左右。
- 如果代码被退回，他们会在 PR 留言里告诉你需要修改哪里。你只需修改自己的代码并重新发一个 Release，然后在 PR 里回复 "Done" 即可。
- 一旦他们点下 "Merge"，你的插件就会瞬间出现在全球用户的 Obsidian 插件搜索列表里！
