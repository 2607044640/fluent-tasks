import { App, PluginSettingTab, Setting } from "obsidian";
import type FluentTasksPlugin from "./main";

export interface FluentTasksSettings {
    accentColor: string;
}

export const DEFAULT_SETTINGS: FluentTasksSettings = {
    accentColor: "#8b5cf6"
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
    }
}
