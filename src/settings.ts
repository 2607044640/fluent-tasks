import { App, PluginSettingTab, Setting } from "obsidian";
import type FluentTasksPlugin from "./main";

export interface FluentTasksSettings {
    accentColor: string;
    maxFrames: number;
    maxIconsPerFrame: number;
}

export const DEFAULT_SETTINGS: FluentTasksSettings = {
    accentColor: "#8b5cf6",
    maxFrames: 3,
    maxIconsPerFrame: 5
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
            .setName("Max Image Frames")
            .setDesc("Maximum number of image frames allowed per task (1-5).")
            .addSlider(slider => slider
                .setLimits(1, 5, 1)
                .setValue(this.plugin.settings.maxFrames)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxFrames = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Max Icons Per Frame")
            .setDesc("Maximum number of icons allowed in each image frame (1-10).")
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.maxIconsPerFrame)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxIconsPerFrame = value;
                    await this.plugin.saveSettings();
                }));
    }
}

