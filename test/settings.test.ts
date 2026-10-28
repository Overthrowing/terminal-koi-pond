import test from "node:test";
import assert from "node:assert/strict";
import { SettingsMenu, adjustSetting, type PondSettings } from "../src/settings.ts";
import { CellSurface } from "../src/surface.ts";
import { InputParser } from "../src/input.ts";

const initial: PondSettings = { mode: "blocks", cellAspect: 2, autoAspect: true, fps: 24, fish: 3, light: false, mouse: true, showHelp: true };

test("menu navigation adjusts the selected option and contains pond shortcuts", () => {
    const menu = new SettingsMenu();
    menu.open = true;
    assert.deepEqual(menu.handleKey("right"), { type: "adjust", key: "mode", direction: 1 });
    menu.handleKey("down");
    assert.deepEqual(menu.handleKey("left"), { type: "adjust", key: "fps", direction: -1 });
    assert.equal(menu.handleKey("f"), undefined);
    menu.handleKey("up");
    menu.handleKey("up");
    menu.handleKey(" ");
    assert.equal(menu.page, "advanced");
    assert.deepEqual(menu.handleKey("left"), { type: "adjust", key: "cellAspect", direction: -1 });
    menu.handleKey("escape");
    assert.equal(menu.page, "main");
    assert.equal(menu.open, true);
    assert.deepEqual(menu.handleKey("escape"), { type: "close" });
    assert.equal(menu.open, false);
});

test("settings enforce bounds, preserve precision, and respect no-color", () => {
    assert.equal(adjustSetting(initial, "mode", 1, true).mode, "ascii");
    assert.equal(adjustSetting({ ...initial, mode: "ascii" }, "mode", 1, false).mode, "ascii");
    assert.equal(adjustSetting(initial, "cellAspect", -1, true).cellAspect, 1.95);
    assert.equal(adjustSetting(initial, "cellAspect", -1, true).autoAspect, false);
    assert.equal(adjustSetting(initial, "autoAspect", 1, true).autoAspect, false);
    for (const [key, low, high] of [["cellAspect", 1, 3], ["fps", 1, 60], ["fish", 1, 20]] as const) {
        assert.equal(adjustSetting({ ...initial, [key]: low }, key, -1, true)[key], low);
        assert.equal(adjustSetting({ ...initial, [key]: high }, key, 1, true)[key], high);
    }
    assert.equal(adjustSetting(initial, "light", 1, true).light, true);
    assert.equal(adjustSetting(initial, "mouse", 1, true).mouse, false);
    assert.equal(initial.mode, "blocks");
});

test("settings draw in both modes, scroll in small windows, and survive resizing", () => {
    for (const mode of ["blocks", "ascii"] as const) {
        const surface = new CellSurface(mode);
        const menu = new SettingsMenu();
        menu.open = true;
        for (const [cols, rows] of [[80, 24], [30, 10], [12, 4], [100, 36]]) {
            surface.resize(cols, rows * (mode === "blocks" ? 2 : 1));
            surface.clear();
            menu.draw(surface, { ...initial, mode }, true);
            const lines = surface.plain().split("\n");
            assert.equal(lines.length, rows);
            assert.ok(lines.every(line => line.length === cols));
            assert.match(surface.plain(), /SETTINGS|Settings/);
        }
        surface.resize(40, mode === "blocks" ? 20 : 10);
        surface.clear();
        menu.selected = 5;
        menu.draw(surface, { ...initial, mode }, true);
        assert.match(surface.plain(), /Controls strip/);
        menu.selected = 6;
        menu.handleKey("\r");
        surface.clear();
        menu.draw(surface, { ...initial, mode }, true);
        assert.match(surface.plain(), /Cell aspect ratio/);
        menu.handleKey("down");
        menu.handleKey("down");
        menu.handleKey("\r");
        assert.equal(menu.page, "main");
    }
});

test("bare Escape closes the menu without breaking fragmented arrow reports", () => {
    const parser = new InputParser();
    assert.deepEqual(parser.push("\x1b"), []);
    assert.deepEqual(parser.flushEscape(), [{ type: "key", key: "escape" }]);
    assert.deepEqual(parser.flushEscape(), []);
    parser.push("\x1b");
    assert.deepEqual(parser.push("[A"), [{ type: "key", key: "up" }]);
    assert.deepEqual(parser.flushEscape(), []);
});
