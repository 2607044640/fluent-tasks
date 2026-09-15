// Simplified Chinese language dictionary
import type en from "./en";

const zhCn: typeof en = {
    // Action ribbon & Commands
    action_multi_select: "多选任务 (批量删除/收藏)",
    action_backup_manager: "数据备份器 (快照与恢复)",
    cmd_backup_manager: "打开备份管理器 (数据备份与恢复)",

    // Backup Service
    backup_dir: "备份目录: {0}",
    backup_file_not_found: "未找到指定的备份文件",
    backup_invalid_format: "❌ 备份文件格式无效：缺少 files 数据项",
    backup_restore_success: "✅ 成功还原备份：共恢复 {0} 个文件，包含 {1} 项任务",
    backup_restore_failed: "❌ 还原失败: {0}",
    backup_deleted: "🗑️ 备份已删除",
    backup_import_dialog_title: "选择要导入的备份文件",
    backup_file_filter_name: "Fluent Tasks 备份文件 (*.json)",

    // Backup Modal UI
    backup_modal_title: "任务数据备份器",
    daily_backup_title: "每日自动备份",
    daily_backup_desc: "每天首次打开时自动在本地生成快照",
    daily_backup_enabled: "✅ 已开启每日自动备份",
    daily_backup_disabled: "⚠️ 已关闭每日自动备份",
    backup_now: "现在备份",
    backing_up: "备份中...",
    data_saved_to: "数据已保存到 {0}",
    backup_failed: "❌ 备份失败: {0}",
    import_backup: "导入备份",
    backup_history_title: "历史备份记录 ({0})",
    open_backup_folder: "📂 打开目录",
    open_backup_folder_tooltip: "在文件管理器中打开备份所在文件夹",
    delete_all_backups: "🗑️ 删除全部备份",
    delete_all_backups_tooltip: "清空并删除全部本地备份文件",
    no_backups_to_delete: "暂无备份可删除",
    refresh_list: "刷新列表",
    loading_backups: "正在读取备份记录...",
    no_local_backups: "📦 暂无本地备份文件",
    no_local_backups_hint: "点击上方「现在备份」即可创建第一个完整数据快照",
    daily_backup_badge: "每日备份",
    manual_backup_badge: "手动备份",
    task_count_label: "{0} 项任务",
    list_count_label: "{0} 个列表",
    restore_snapshot_tooltip: "还原此快照",
    restore: "还原",
    delete_backup_tooltip: "删除备份",
    confirm_restore_backup: "确认还原备份「{0}」？\n此操作将用备份中的数据恢复所有任务列表。",
    confirm_delete_backup: "确认删除备份「{0}」？",
    confirm_delete_all_backups: "⚠️ 危险操作：确认清空并删除全部 {0} 个本地备份文件？\n此操作不可撤销！",
    all_backups_deleted: "🗑️ 已清空删除全部 {0} 个备份文件",

    // Linked Note Modal
    confirm_delete_linked_note_title: "是否删除链接笔记（title：{0}）？",
    confirm_delete_linked_note_p1: "待删除的任务绑定了专属笔记：",
    confirm_delete_linked_note_p2: "您可以选择仅删除任务本身，或同时将该链接笔记移入回收站。",
    cancel: "取消",
    delete_task_only_keep_note: "仅删除任务（保留笔记）",
    delete_task_and_note: "删除任务与链接笔记",

    // Linked Note Tooltips & Notices (TaskDetailView)
    linked_note_tooltip_exists: "打开链接笔记: {0} (点击跳转，悬停预览，右键管理)",
    linked_note_tooltip_create: "链接专属笔记 (点击自动创建并跳转)",
    linked_note_recreated: "已重新创建并打开链接笔记: {0}",
    linked_note_created: "已创建并打开链接笔记: {0}",
    open_linked_note: "打开链接笔记",
    unlink_note: "取消关联笔记",
    unlink_note_success: "已取消笔记关联",

    // TaskMainView Multi-Select & Batch
    multi_select_mode_enabled: "☑️ 多选模式已开启：可勾选任务进行批量操作",
    batch_starred_tasks: "⭐ 已收藏选中的 {0} 项任务",
    batch_unstarred_tasks: "已取消收藏选中的 {0} 项任务",
    confirm_batch_delete_tasks: "确认批量删除选中的 {0} 项任务？此操作不可逆。",
    batch_deleted_tasks_notice: "🗑️ 已批量删除 {0} 项任务",
    multi_select_tooltip: "多选任务 (批量删除/收藏)",
    backup_btn_tooltip: "数据备份器",
    linked_note_preview_tooltip: "专属链接笔记: {0} (点击跳转，悬停预览)",
    selected_items_label: "已选 {0} 项",
    deselect_all: "取消全选",
    select_all: "全选",
    batch_star: "批量收藏",
    batch_delete: "批量删除",
    exit: "✕ 退出",

    // Quick Task Modal
    quick_task_tip: "💡 提示: 在 <b>设置 → 快捷键</b> 中为 <code>Fluent Tasks: Open Quick Task Modal</code> 设置快捷键即可秒级呼出 (剩余 {0} 次提醒)",

    // Quick List Modal
    focus_pick_mode_enabled: "🎯 选择模式已开启：请点击想要设为默认聚焦的列表 (按 ESC 取消)",
    focus_default_set: "🎯 已将 \"{0}\" 设为打开时的默认聚焦列表",
    focus_cancel_default: "取消默认聚焦 (恢复首项)",
    focus_set_default: "设为默认聚焦 (打开时首选)",
    focus_restored_default: "已恢复默认聚焦 (左上角首项)",
    focus_restored_default_notice: "🎯 已恢复默认聚焦：左上角首项",
    focus_pick_cancelled: "已取消选择默认聚焦列表",
    quick_list_tip: "💡 提示: 在 <b>设置 → 快捷键</b> 中为 <code>Fluent Tasks: Open Quick List Modal</code> 设置快捷键 (剩余 {0} 次提醒)",
    focus_btn_aria_label: "设置默认聚焦列表：点击进入选择模式，右键可重置为左上角首项",
    focus_picking_target: "选择目标列表...",
    focus_target_label: "聚焦: {0}",
    focus_set_btn: "设置聚焦",
    focus_popover_title: "🎯 初始默认聚焦设置",
    focus_current_prefix: "当前默认聚焦：",
    focus_unset_prefix: "当前未设置，默认聚焦：",
    focus_top_left_default: "左上角首项",
    focus_instruction_desc: "点击按钮进入选择模式后点击目标列表；右键此按钮可重置为左上角首项。",
    focus_tag_tooltip: "默认聚焦目标",
};

export default zhCn;
