import { App, PluginSettingTab, Setting } from "obsidian";
import type FluentTasksPlugin from "./main";

export interface FluentTasksSettings {
    accentColor: string;
    openDetailInModal: boolean;
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
}

export const DEFAULT_SETTINGS: FluentTasksSettings = {
    accentColor: "#8b5cf6",
    openDetailInModal: false,
    autoExpandSidebar: true,
    autoCollapseSidebarOnSwitch: true,
    searchHideCompleted: true,
    hideRibbonIcon: false,
    wrapTaskTitles: true,
    quickModalAction: 'direct',
    quickModalTipCount: 0,
    quickListGridLayout: true,
    quickListMinColGap: 20,
    quickListMinRowGap: 16,
    quickListFocusCenter: false,
    defaultQuickListFocusFilepath: "",
    dailyBackupEnabled: true,
    lastDailyBackupDate: "",
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

        // Use Obsidian's native addColorPicker so the UI renders correctly
        const colorSetting = new Setting(containerEl)
            .setName("Accent Color")
            .setDesc("Choose the primary accent color for the plugin (e.g., active borders, stars).")
            .addColorPicker(color => color
                .setValue(this.plugin.settings.accentColor)
                .onChange(async (value) => {
                    this.plugin.settings.accentColor = value;
                    await this.plugin.saveSettings();
                    this.plugin.applySettings();
                }));

        // Also hook the underlying native input for real-time dragging
        const nativeInput = colorSetting.controlEl.querySelector('input[type="color"]') as HTMLInputElement | null;
        if (nativeInput) {
            nativeInput.addEventListener("input", async (e) => {
                const value = (e.target as HTMLInputElement).value;
                this.plugin.settings.accentColor = value;
                await this.plugin.saveSettings();
                this.plugin.applySettings();
            });
        }



        new Setting(containerEl)
            .setName("Open Task Details in Floating Modal")
            .setDesc("Open task details in a centered floating modal instead of expanding the right sidebar panel.")
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
            .setName("Wrap Task Titles")
            .setDesc("Wrap long task titles across multiple lines in the task list instead of truncating with ellipsis.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.wrapTaskTitles ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.wrapTaskTitles = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Quick Task Modal Action")
            .setDesc("Choose whether selecting a task/list in the Quick Task Modal manages it directly in the popup or navigates and reveals it in the main workspace.")
            .addDropdown(dropdown => dropdown
                .addOption("direct", "Direct In-Modal Management (Toggle & Add in popup)")
                .addOption("navigate", "Navigate Workspace (Open list & details in workspace)")
                .setValue(this.plugin.settings.quickModalAction ?? "direct")
                .onChange(async (value: string) => {
                    this.plugin.settings.quickModalAction = value as "direct" | "navigate";
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Quick List Modal: Grid Board Layout")
            .setDesc("Tile lists and groups across multi-column cards like a dashboard chart to fully display lists in the available screen space without scrolling. Turn off to revert to the classic single-column list.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.quickListGridLayout ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.quickListGridLayout = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Quick List Modal: Min Column Gap")
            .setDesc("Minimum horizontal gap (in px) between columns in the Quick List grid board layout (default: 20px).")
            .addSlider(slider => slider
                .setLimits(10, 64, 2)
                .setValue(this.plugin.settings.quickListMinColGap ?? 20)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.quickListMinColGap = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Quick List Modal: Min Row Gap")
            .setDesc("Minimum vertical gap (in px) between stacked cards within the same column (default: 16px).")
            .addSlider(slider => slider
                .setLimits(8, 48, 2)
                .setValue(this.plugin.settings.quickListMinRowGap ?? 16)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.quickListMinRowGap = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Quick List Modal: Focus Center List on Open")
            .setDesc("Automatically focus the visually centered list when opening the Quick List board instead of the top-left list, enabling immediate multi-directional arrow navigation.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.quickListFocusCenter ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.quickListFocusCenter = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Auto-Expand Sidebar on Focus")
            .setDesc("Automatically expand the left sidebar list panel when switching to Fluent Tasks tab (via Ctrl+Tab, Ctrl+Shift+Tab, or clicking the tab).")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoExpandSidebar)
                .onChange(async (value) => {
                    this.plugin.settings.autoExpandSidebar = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Auto-Collapse Sidebar on Tab Switch")
            .setDesc("Automatically collapse the sidebar when switching away to other tabs (notes, settings) if the sidebar is currently displaying Fluent Tasks.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCollapseSidebarOnSwitch ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.autoCollapseSidebarOnSwitch = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Search: Hide Completed Tasks")
            .setDesc("When searching, hide completed tasks by default. Can also be toggled directly in the search modal.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.searchHideCompleted)
                .onChange(async (value) => {
                    this.plugin.settings.searchHideCompleted = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Hide Ribbon Icon")
            .setDesc("Hide the Fluent Tasks icon in the left ribbon.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideRibbonIcon ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.hideRibbonIcon = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshRibbonIcon();
                }));
    }
}

