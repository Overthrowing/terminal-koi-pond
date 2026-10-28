import { CellSurface, type RenderMode } from "./surface.ts";

export type PondSettings = {
    mode: RenderMode;
    cellAspect: number;
    autoAspect: boolean;
    aspectStatus?: "detecting" | "detected" | "fallback";
    fps: number;
    fish: number;
    light: boolean;
    mouse: boolean;
    showHelp: boolean;
};

const entries = [
    { key: "mode", label: "Renderer", hint: "Half-block pixels or original ASCII tiles." },
    { key: "fps", label: "Frame rate", hint: "Frames per second. Adjust by 1 (1-60)." },
    { key: "fish", label: "Koi", hint: "Add or remove fish without resetting the pond." },
    { key: "light", label: "Theme", hint: "Dark water or light paper." },
    { key: "mouse", label: "Mouse input", hint: "Pointer following and click-to-feed." },
    { key: "showHelp", label: "Controls strip", hint: "Show keyboard shortcuts below the pond." },
    { key: "advanced", label: "Advanced settings", hint: "Font proportions and rendering calibration." },
] as const;
const advancedEntries = [
    { key: "cellAspect", label: "Cell aspect ratio", hint: "Cell height / width. Adjust by 0.05." },
    { key: "autoAspect", label: "Aspect detection", hint: "Auto reads terminal dimensions; manual keeps your value." },
    { key: "back", label: "Back", hint: "Return to the main settings menu." },
] as const;
type SettingKey = Exclude<keyof PondSettings, "aspectStatus">;

export function adjustSetting(settings: PondSettings, key: SettingKey, direction: number, color: boolean): PondSettings {
    const next = { ...settings };
    switch (key) {
        case "mode": if (color) next.mode = settings.mode === "blocks" ? "ascii" : "blocks"; break;
        case "cellAspect":
            next.cellAspect = Math.max(1, Math.min(3, Math.round((settings.cellAspect + direction * 0.05) * 100) / 100));
            next.autoAspect = false;
            break;
        case "autoAspect": next.autoAspect = !settings.autoAspect; break;
        case "fps": next.fps = Math.max(1, Math.min(60, settings.fps + direction)); break;
        case "fish": next.fish = Math.max(1, Math.min(20, settings.fish + direction)); break;
        case "light": next.light = !settings.light; break;
        case "mouse": next.mouse = !settings.mouse; break;
        case "showHelp": next.showHelp = !settings.showHelp; break;
    }
    return next;
}

export class SettingsMenu {
    open = false;
    selected = 0;
    page: "main" | "advanced" = "main";

    private back() {
        this.page = "main";
        this.selected = entries.length - 1;
    }

    handleKey(key: string): { type: "close" } | { type: "adjust"; key: SettingKey; direction: number } | undefined {
        if (key === "escape" && this.page === "advanced") { this.back(); return; }
        if (["m", ",", "escape", "q"].includes(key)) { this.open = false; return { type: "close" }; }
        const items = this.page === "advanced" ? advancedEntries : entries;
        if (["up", "w", "k"].includes(key)) this.selected = (this.selected + items.length - 1) % items.length;
        if (["down", "s", "j", "\t"].includes(key)) this.selected = (this.selected + 1) % items.length;
        if (["left", "a", "-", "right", "d", "+", "=", "\r", " "].includes(key)) {
            const setting = items[this.selected].key;
            if (setting === "advanced") { this.page = "advanced"; this.selected = 0; return; }
            if (setting === "back") { this.back(); return; }
            return { type: "adjust", key: setting, direction: ["left", "a", "-"].includes(key) ? -1 : 1 };
        }
    }

    draw(surface: CellSurface, settings: PondSettings, color: boolean) {
        const cols = surface.cols;
        const rows = surface.terminalRows;
        if (cols < 24 || rows < 8) {
            surface.text("Settings: enlarge window", 0, 0, settings.light ? 0x393530 : 0xe8dfd0);
            surface.text("M / Esc to close", 0, 1, settings.light ? 0x393530 : 0xe8dfd0);
            return;
        }
        const width = Math.min(58, cols - 2);
        const items = this.page === "advanced" ? advancedEntries : entries;
        const visible = Math.min(items.length, rows - 7);
        const height = visible + 6;
        const left = Math.floor((cols - width) / 2);
        const top = Math.max(0, Math.floor((rows - height) / 2));
        const ink = settings.light ? 0x393530 : 0xded7cd;
        const accent = settings.light ? 0xb94e21 : 0xf1a15a;
        const muted = settings.light ? 0x706b63 : 0x99929e;
        const line = (text: string, row: number, rgb = ink) => surface.text(text.slice(0, width).padEnd(width), left, top + row, rgb);
        line("+" + "-".repeat(width - 2) + "+", 0, muted);
        line(this.page === "advanced" ? "  ADVANCED SETTINGS" : "  SETTINGS                         changes apply live", 1, accent);
        line("", 2);
        const first = Math.max(0, Math.min(this.selected - visible + 1, items.length - visible));
        const value = (key: SettingKey | "advanced" | "back") => {
            switch (key) {
                case "mode": return settings.mode === "blocks" ? "Half blocks" : color ? "ASCII" : "ASCII (no color)";
                case "cellAspect": return settings.cellAspect.toFixed(2);
                case "autoAspect": return settings.autoAspect ? `Auto (${settings.aspectStatus ?? "fallback"})` : "Manual";
                case "fps": return `${settings.fps} fps`;
                case "fish": return String(settings.fish);
                case "light": return settings.light ? "Light" : "Dark";
                case "mouse": return settings.mouse ? "On" : "Off";
                case "showHelp": return settings.showHelp ? "Shown" : "Hidden";
                case "advanced": return "Open";
                case "back": return "Main menu";
            }
        };
        for (let row = 0; row < visible; row++) {
            const index = first + row;
            const entry = items[index];
            const selected = index === this.selected;
            const labelWidth = Math.min(23, width - 14);
            line(`${selected ? " >" : "  "} ${entry.label.slice(0, labelWidth).padEnd(labelWidth)} ${selected ? "< " : "  "}${value(entry.key)}${selected ? " >" : ""}`, row + 3, selected ? accent : ink);
        }
        const hint = items[this.selected].key === "mode" && !color ? "Color is disabled; half blocks need color." : items[this.selected].hint;
        line("  " + hint, visible + 3, muted);
        line(this.page === "advanced" ? "  Left/Right change  Esc back  M close" :
            width >= 48 ? "  Up/Down select  Left/Right change  M/Esc close" : "  ^/v select  </> change  M/Esc close", visible + 4, muted);
        line("+" + "-".repeat(width - 2) + "+", visible + 5, muted);
    }
}
