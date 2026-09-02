import { App, PluginSettingTab, Setting } from "obsidian";
import type FluentTasksPlugin from "./main";

export interface FluentTasksSettings {
    accentColor: string;
    autoExpandSidebar: boolean;
    autoCollapseSidebarOnSwitch: boolean;
    searchHideCompleted: boolean;
    hideRibbonIcon: boolean;
    wrapTaskTitles: boolean;
    quickModalAction: 'direct' | 'navigate';
    quickModalTipCount: number;
}

export const DEFAULT_SETTINGS: FluentTasksSettings = {
    accentColor: "#8b5cf6",
    autoExpandSidebar: true,
    autoCollapseSidebarOnSwitch: true,
    searchHideCompleted: true,
    hideRibbonIcon: false,
    wrapTaskTitles: true,
    quickModalAction: 'direct',
    quickModalTipCount: 0,
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

