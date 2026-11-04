import { App, PluginSettingTab, Setting } from "obsidian";
import type FluentTasksPlugin from "./main";
import { t } from "./lang/helpers";
import { MarkdownParser } from "./MarkdownParser";

export interface FluentTasksSettings {
    accentColor: string;
    openDetailInModal: boolean;
    fullscreenDetailModal: boolean;
    hideLeftSidebar: boolean;
    autoExpandSidebarOnDrag: boolean;
    autoExpandSidebar: boolean;
    autoCollapseSidebarOnSwitch: boolean;
    searchHideCompleted: boolean;
    hideRibbonIcon: boolean;
    wrapTaskTitles: boolean;
    quickModalAction: 'direct' | 'navigate';
    quickModalTipCount: number;
    quickListGridLayout: boolean;
    quickListMinColGap: number;
    quickListMinRowGap: number;
    quickListFocusCenter: boolean;
    defaultQuickListFocusFilepath: string;
    dailyBackupEnabled: boolean;
    lastDailyBackupDate: string;
    undoDurationSeconds: number;
    enableTaskWeightMode: boolean;
    quickListSearchMode: 'list' | 'task';
    centerAlignTasks: boolean;
    disableStars: boolean;
    hiddenStarMode: boolean;
    quickListTitleAlignment: 'center' | 'left';
    quickListMaxCardWidth: number;
    showStepsProgressPill: boolean;
    enableFocusedLists: boolean;
    focusedLists: string[];
    mainListTitleSize: 'small' | 'medium' | 'large';
    showListTitleInHeader: boolean;
    taskSeparatorWidth: number;
    collapseCompletedSteps: boolean;
    minimalPlaceholders: boolean;
    injectAiArchiveDirective: boolean;
}

export const DEFAULT_SETTINGS: FluentTasksSettings = {
    accentColor: "#8b5cf6",
    openDetailInModal: false,
    fullscreenDetailModal: true,
    collapseCompletedSteps: true,
    minimalPlaceholders: false,
    injectAiArchiveDirective: true,
    hideLeftSidebar: false,
    autoExpandSidebarOnDrag: false,
    autoExpandSidebar: true,
    autoCollapseSidebarOnSwitch: true,
    searchHideCompleted: true,
    hideRibbonIcon: false,
    wrapTaskTitles: true,
    centerAlignTasks: true,
    disableStars: false,
    hiddenStarMode: false,
    showStepsProgressPill: false,
    mainListTitleSize: 'medium',
    showListTitleInHeader: false,
    quickModalAction: 'direct',
    quickModalTipCount: 0,
    quickListGridLayout: true,
    quickListMinColGap: 14,
    quickListMinRowGap: 10,
    quickListMaxCardWidth: 380,
    quickListFocusCenter: false,
    defaultQuickListFocusFilepath: "",
    dailyBackupEnabled: true,
    lastDailyBackupDate: "",
    undoDurationSeconds: 2.5,
    enableTaskWeightMode: false,
    quickListSearchMode: 'list',
    quickListTitleAlignment: 'center',
    enableFocusedLists: false,
    focusedLists: [],
    taskSeparatorWidth: 90,
}

export class FluentTasksSettingTab extends PluginSettingTab {
    plugin: FluentTasksPlugin;

    constructor(app: App, plugin: FluentTasksPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // =============================================
        // 1. Appearance & Accent / 外观与主题
        // =============================================
        new Setting(containerEl)
            .setHeading()
            .setName(t("settings_section_appearance") || "Appearance & Accent");

        // Use Obsidian's native addColorPicker so the UI renders correctly
        const colorSetting = new Setting(containerEl)
            .setName(t("setting_accent_color_title") || "Appearance: Accent Color")
            .setDesc(t("setting_accent_color_desc") || "Choose the primary accent color for the plugin (e.g., active borders, stars).")
            .addColorPicker(color => color
                .setValue(this.plugin.settings.accentColor)
                .onChange(async (value) => {
                    this.plugin.settings.accentColor = value;
                    await this.plugin.saveSettings();
                    this.plugin.applySettings();
                }));

        // Also hook the underlying native input for real-time dragging
        const nativeInput = colorSetting.controlEl.querySelector('input[type="color"]');
        if (nativeInput) {
            nativeInput.addEventListener("input", async (e) => {
                const value = (e.target as HTMLInputElement).value;
                this.plugin.settings.accentColor = value;
                await this.plugin.saveSettings();
                this.plugin.applySettings();
            });
        }

        new Setting(containerEl)
            .setName(t("setting_list_title_size_title") || "Appearance: List Title Font Size")
            .setDesc(t("setting_list_title_size_desc") || "Choose the font size of the active list title in the main view (default: Medium 22px).")
            .addDropdown(dropdown => dropdown
                .addOption("small", "Small (18px)")
                .addOption("medium", "Medium (22px)")
                .addOption("large", "Large (28px - Classic)")
                .setValue(this.plugin.settings.mainListTitleSize ?? "medium")
                .onChange(async (value: string) => {
                    this.plugin.settings.mainListTitleSize = value as "small" | "medium" | "large";
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_show_list_title_header_title") || "Appearance: Show List Title in Top Header")
            .setDesc(t("setting_show_list_title_header_desc") || "Display the active list title in the pane's top navigation bar (replacing 'Tasks') with accent color, hiding the large in-body title to maximize vertical reading space.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showListTitleInHeader ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.showListTitleInHeader = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_focused_lists_title") || "Appearance: Focused Lists")
            .setDesc(t("setting_focused_lists_desc") || "Display focused list shortcuts and a quick selector next to the list title in the header. Disabled by default.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableFocusedLists ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.enableFocusedLists = value;
                    await this.plugin.saveSettings();
                }));

        // =============================================
        // 2. Task List & Layout / 任务列表与布局
        // =============================================
        new Setting(containerEl)
            .setHeading()
            .setName(t("settings_section_task_list") || "Task List & Layout");

        new Setting(containerEl)
            .setName(t("setting_center_align_title") || "Task List: Center-Align Tasks")
            .setDesc(t("setting_center_align_desc") || "Display task titles, steps, and metadata centered in the task list and modals. Enabled by default.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.centerAlignTasks ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.centerAlignTasks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_task_separator_width_title") || "Task List: Separator Line Width")
            .setDesc(t("setting_task_separator_width_desc") || "Adjust the horizontal width percentage of the subtle hairline gradient separator between tasks (0% to 100%, 0% hides the line, default: 90%).")
            .addSlider(slider => slider
                .setLimits(0, 100, 5)
                .setValue(this.plugin.settings.taskSeparatorWidth ?? 90)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.taskSeparatorWidth = value;
                    await this.plugin.saveSettings();
                    this.plugin.applySettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_wrap_titles_title") || "Task List: Wrap Task Titles")
            .setDesc(t("setting_wrap_titles_desc") || "Wrap long task titles across multiple lines in the task list instead of truncating with ellipsis.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.wrapTaskTitles ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.wrapTaskTitles = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_hidden_star_title") || "Task List: Hidden Star Mode")
            .setDesc(t("setting_hidden_star_desc") || "Hide the star (favorite) icon on tasks in the task list and modals, while still allowing starring via task context menu (first item) or hover hotkey. Disabled by default.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hiddenStarMode ?? this.plugin.settings.disableStars ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.hiddenStarMode = value;
                    this.plugin.settings.disableStars = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_task_weight_title") || "Task List: Task Weight Mode")
            .setDesc(t("setting_task_weight_desc") || "Enable 1-9 priority score ranking for tasks (9 is highest, default is 5). When enabled, tasks are dynamically prioritized by weight. Use mouse wheel or click the badge to edit the weight directly.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTaskWeightMode ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.enableTaskWeightMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_minimal_placeholders_title") || "Task List: Minimal Input Placeholders")
            .setDesc(t("setting_minimal_placeholders_desc") || "Strip shortcut hints in parentheses (e.g. Press Enter to add, Ctrl+V to paste image) from task, step, and note placeholders, keeping concise action labels with reduced opacity.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.minimalPlaceholders ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.minimalPlaceholders = value;
                    await this.plugin.saveSettings();
                    this.plugin.applySettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_inject_ai_directive_title") || "AI Directive for Completed Tasks (Archive Guardrail)")
            .setDesc(t("setting_inject_ai_directive_desc") || "Automatically group completed tasks at the bottom of the Markdown file and inject an AI agent directive block above them, instructing external AI assistants to treat completed items as archived/disabled drafts rather than active specifications. Enabled by default.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.injectAiArchiveDirective ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.injectAiArchiveDirective = value;
                    MarkdownParser.injectAiArchiveDirective = value;
                    await this.plugin.saveSettings();
                }));

        // =============================================
        // 3. Task Details & Subtasks / 任务详情与子步骤
        // =============================================
        new Setting(containerEl)
            .setHeading()
            .setName(t("settings_section_task_detail") || "Task Details & Subtasks");

        new Setting(containerEl)
            .setName(t("setting_open_detail_modal_title") || "Task Details: Open in Floating Modal")
            .setDesc(t("setting_open_detail_modal_desc") || "Open task details in a centered floating modal instead of expanding the right sidebar panel.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openDetailInModal ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.openDetailInModal = value;
                    await this.plugin.saveSettings();
                    if (value) {
                        this.plugin.handleDetailModalModeEnabled();
                    } else {
                        if (this.plugin.activeDetailModal) {
                            this.plugin.activeDetailModal.close();
                        }
                    }
                }));

        new Setting(containerEl)
            .setName(t("setting_fullscreen_detail_modal_title") || "Task Details: Full-Screen Modal")
            .setDesc(t("setting_fullscreen_detail_modal_desc") || "Open floating task details modal in full-screen mode (similar to Subtasks modal). When disabled, displays as a centered window card.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fullscreenDetailModal ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.fullscreenDetailModal = value;
                    await this.plugin.saveSettings();
                    if (this.plugin.activeDetailModal) {
                        this.plugin.activeDetailModal.setFullscreen(value);
                    }
                }));

        new Setting(containerEl)
            .setName(t("setting_collapse_completed_steps_title") || "Task Details: Collapse Completed Subtasks in Floating Modal")
            .setDesc(t("setting_collapse_completed_steps_desc") || "When enabled, completed checklist steps in the floating details modal automatically collapse into a compact single-line preview that can be clicked to expand. When disabled, completed steps remain fully expanded.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.collapseCompletedSteps ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.collapseCompletedSteps = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_show_steps_progress_title") || "Task Details: Show Subtasks Progress Badge")
            .setDesc(t("setting_show_steps_progress_desc") || "Display step completion progress badge (e.g. 0/3 steps completed) at the bottom of the subtasks floating modal. Disabled by default.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showStepsProgressPill ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.showStepsProgressPill = value;
                    await this.plugin.saveSettings();
                }));

        // =============================================
        // 4. Quick List Board / 清单看板模态窗
        // =============================================
        new Setting(containerEl)
            .setHeading()
            .setName(t("settings_section_quick_list") || "Quick List Board Modal");

        new Setting(containerEl)
            .setName(t("setting_quick_list_grid_title") || "Quick List: Grid Board Layout")
            .setDesc(t("setting_quick_list_grid_desc") || "Tile lists and groups across multi-column cards like a dashboard chart to fully display lists in the available screen space without scrolling. Turn off to revert to the classic single-column list.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.quickListGridLayout ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.quickListGridLayout = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_quick_list_card_width_title") || "Quick List: Max Card Width")
            .setDesc(t("setting_quick_list_card_width_desc") || "Maximum width (in px) for cards in the Quick List grid board layout. Prevents excessive horizontal empty space on large displays (default: 380px).")
            .addSlider(slider => slider
                .setLimits(220, 600, 10)
                .setValue(this.plugin.settings.quickListMaxCardWidth ?? 380)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.quickListMaxCardWidth = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_quick_list_col_gap_title") || "Quick List: Min Column Gap")
            .setDesc(t("setting_quick_list_col_gap_desc") || "Minimum horizontal gap (in px) between columns in the Quick List grid board layout (default: 14px).")
            .addSlider(slider => slider
                .setLimits(8, 64, 2)
                .setValue(this.plugin.settings.quickListMinColGap ?? 14)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.quickListMinColGap = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_quick_list_row_gap_title") || "Quick List: Min Row Gap")
            .setDesc(t("setting_quick_list_row_gap_desc") || "Minimum vertical gap (in px) between stacked cards within the same column (default: 10px).")
            .addSlider(slider => slider
                .setLimits(6, 48, 2)
                .setValue(this.plugin.settings.quickListMinRowGap ?? 10)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.quickListMinRowGap = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_quick_list_focus_center_title") || "Quick List: Focus Center List on Open")
            .setDesc(t("setting_quick_list_focus_center_desc") || "Automatically focus the visually centered list when opening the Quick List board instead of the top-left list, enabling immediate multi-directional arrow navigation.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.quickListFocusCenter ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.quickListFocusCenter = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_quick_list_search_mode_title") || "Quick List: Search Mode")
            .setDesc(t("setting_quick_list_search_mode_desc") || "Choose whether the search bar in the Quick List modal searches lists or tasks by default.")
            .addDropdown(dropdown => dropdown
                .addOption("list", "Search Lists")
                .addOption("task", "Search Tasks")
                .setValue(this.plugin.settings.quickListSearchMode ?? "list")
                .onChange(async (value: string) => {
                    this.plugin.settings.quickListSearchMode = value as "list" | "task";
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_quick_list_title_align_title") || "Quick List: Title Alignment")
            .setDesc(t("setting_quick_list_title_align_desc") || "Choose whether list and group titles in the Quick List modal are centered or aligned to the left.")
            .addDropdown(dropdown => dropdown
                .addOption("center", "Center (Default)")
                .addOption("left", "Left")
                .setValue(this.plugin.settings.quickListTitleAlignment ?? "center")
                .onChange(async (value: string) => {
                    this.plugin.settings.quickListTitleAlignment = value as "center" | "left";
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_quick_task_action_title") || "Quick List: Quick Task Modal Action")
            .setDesc(t("setting_quick_task_action_desc") || "Choose whether selecting a task/list in the Quick Task Modal manages it directly in the popup or navigates and reveals it in the main workspace.")
            .addDropdown(dropdown => dropdown
                .addOption("direct", "Direct In-Modal Management (Toggle & Add in popup)")
                .addOption("navigate", "Navigate Workspace (Open list & details in workspace)")
                .setValue(this.plugin.settings.quickModalAction ?? "direct")
                .onChange(async (value: string) => {
                    this.plugin.settings.quickModalAction = value as "direct" | "navigate";
                    await this.plugin.saveSettings();
                }));

        // =============================================
        // 5. Sidebar Behavior / 侧边栏交互
        // =============================================
        new Setting(containerEl)
            .setHeading()
            .setName(t("settings_section_sidebar") || "Sidebar Behavior");

        new Setting(containerEl)
            .setName(t("setting_hide_left_sidebar_title") || "Sidebar: Hide Left Sidebar (Floating UI Mode)")
            .setDesc(t("setting_hide_left_sidebar_desc") || "Hide the left sidebar list view completely. Navigate lists using the Quick List Floating UI (modal). Recommended to bind a hotkey for quick access.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideLeftSidebar ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.hideLeftSidebar = value;
                    await this.plugin.saveSettings();
                    this.plugin.applySettings();
                    await this.plugin.handleHideLeftSidebarChanged(value);
                }));

        new Setting(containerEl)
            .setName(t("setting_auto_expand_sidebar_on_drag_title") || "Sidebar: Auto-Expand on Task Drag")
            .setDesc(t("setting_auto_expand_sidebar_on_drag_desc") || "Temporarily expand the left sidebar when dragging a task to easily move it to other lists, and auto-collapse on release (if it was collapsed). If the sidebar is already open with Fluent Tasks, it only reveals the list.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoExpandSidebarOnDrag ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.autoExpandSidebarOnDrag = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_auto_expand_focus_title") || "Sidebar: Auto-Expand on Tab Focus")
            .setDesc(t("setting_auto_expand_focus_desc") || "Automatically expand the left sidebar list panel when switching to Fluent Tasks tab (via Ctrl+Tab, Ctrl+Shift+Tab, or clicking the tab).")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoExpandSidebar)
                .onChange(async (value) => {
                    this.plugin.settings.autoExpandSidebar = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_auto_collapse_switch_title") || "Sidebar: Auto-Collapse on Tab Switch")
            .setDesc(t("setting_auto_collapse_switch_desc") || "Automatically collapse the sidebar when switching away to other tabs (notes, settings) if the sidebar is currently displaying Fluent Tasks.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCollapseSidebarOnSwitch ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.autoCollapseSidebarOnSwitch = value;
                    await this.plugin.saveSettings();
                }));

        // =============================================
        // 6. System & Workflow / 系统与常规
        // =============================================
        new Setting(containerEl)
            .setHeading()
            .setName(t("settings_section_system") || "System & Workflow");

        new Setting(containerEl)
            .setName(t("setting_search_hide_completed_title") || "System: Search Hide Completed Tasks")
            .setDesc(t("setting_search_hide_completed_desc") || "When searching, hide completed tasks by default. Can also be toggled directly in the search modal.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.searchHideCompleted)
                .onChange(async (value) => {
                    this.plugin.settings.searchHideCompleted = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_undo_duration_title") || "System: Deletion Undo Duration")
            .setDesc(t("setting_undo_duration_desc") || "Duration in seconds that the floating undo toast remains visible after deleting a task, step, or list (default: 2.5s).")
            .addSlider(slider => slider
                .setLimits(1, 10, 0.5)
                .setValue(this.plugin.settings.undoDurationSeconds ?? 2.5)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.undoDurationSeconds = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t("setting_hide_ribbon_title") || "System: Hide Ribbon Icon")
            .setDesc(t("setting_hide_ribbon_desc") || "Hide the Fluent Tasks icon in the left ribbon.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideRibbonIcon ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.hideRibbonIcon = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshRibbonIcon();
                }));
    }
}

