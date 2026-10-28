import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { InputParser } from "../src/input.ts";
import { CellSurface } from "../src/surface.ts";
import { KoiRenderer } from "../src/renderer.ts";
import { World } from "../src/world.ts";

test("fragmented mouse reports, arrow keys, and clicks decode without phantom feeding", () => {
    const parser = new InputParser();
    assert.deepEqual(parser.push("\x1b[<0;12;"), []);
    assert.deepEqual(parser.push("8M\x1b[A \x1b[<35;13;9M\x1b[<0;12;8m"), [
        { type: "mouse", col: 11, row: 7, feed: true },
        { type: "key", key: "up" },
        { type: "key", key: " " },
        { type: "mouse", col: 12, row: 8, feed: false },
    ]);
    assert.deepEqual(parser.push("\x1b[<64;12;8M\x1b[15~q"), [{ type: "key", key: "q" }]);
    assert.deepEqual(parser.push("\x1bO"), []);
    assert.deepEqual(parser.push("D"), [{ type: "key", key: "left" }]);
});

test("surface emits incremental updates and erases vacated cells", () => {
    const surface = new CellSurface();
    surface.resize(4, 2);
    surface.clear();
    surface.text("X", 1, 0, 0xffffff);
    assert.match(surface.ansi(), /X/);
    assert.equal(surface.ansi(), "");
    surface.clear();
    assert.match(surface.ansi(), /\x1b\[1;2H.* /);
    assert.equal(surface.ansi(), "");
    surface.invalidate();
    assert.notEqual(surface.ansi(), "");
});

test("half blocks preserve two different pixel colors in one physical cell", () => {
    const surface = new CellSurface("blocks");
    surface.resize(2, 4);
    surface.clear();
    surface.globalAlpha = 1;
    surface.fillStyle = 0xfc0000;
    surface.fillRect(0, 0, 8, 8);
    surface.fillStyle = 0x0000fc;
    surface.fillRect(0, 8, 8, 8);
    const frame = surface.frame();
    assert.equal(frame.glyphs.length, 4);
    assert.equal(frame.glyphs[0], "▀".charCodeAt(0));
    assert.equal(frame.foregrounds[0], 0xfc0000);
    assert.equal(frame.backgrounds[0], 0x0000fc);
    assert.match(surface.ansi(), /38;2;252;0;0m▀/);
    assert.equal(surface.ansi(), "");
    surface.text("UI", 0, 1, 0xffffff);
    assert.equal(surface.plain().split("\n")[1], "UI");
});

test("raster samples are square at the standard aspect, with adjustable physical geometry", () => {
    const blocks = new CellSurface("blocks", 2);
    assert.equal(blocks.cellWidth, blocks.cellHeight);
    const ascii = new CellSurface("ascii", 2);
    assert.equal(ascii.cellHeight / ascii.cellWidth, 2);
    for (const aspect of [1, 1.8, 2, 2.4, 3]) {
        for (const mode of ["blocks", "ascii"] as const) {
            const surface = new CellSurface(mode, aspect);
            const renderer = new KoiRenderer(surface);
            renderer.resize(80 * 8, 24 * surface.terminalCellHeight);
            assert.equal(surface.cols, 80);
            assert.equal(surface.terminalRows, 24);
            assert.equal(surface.rows, mode === "blocks" ? 48 : 24);
            // A circle's diameter in columns / rows follows the font proportions.
            assert.equal(surface.terminalCellHeight / surface.cellWidth, aspect);
        }
    }
});

test("block renderer samples both halves, clears vacated pixels, and keeps paused output stable", () => {
    const world = new World();
    world.resize(800, 480);
    const koi = world.koi[0];
    world.koi = [koi];
    koi.depth = 1;
    koi.length = 280;
    for (let n = 0; n < 20; n++) {
        koi.nodes[n * 2] = 600 - n * 280 / 19;
        koi.nodes[n * 2 + 1] = 220;
    }
    const surface = new CellSurface("blocks");
    const renderer = new KoiRenderer(surface);
    renderer.resize(800, 512);
    renderer.render(world, 0);
    const frame = surface.frame();
    assert.ok(frame.glyphs.some(code => code === 0x2580));
    surface.ansi();
    renderer.render(world, 0);
    assert.equal(surface.ansi(), "");
    world.koi = [];
    renderer.render(world, 0);
    assert.ok(surface.frame().backgrounds.every(color => color === surface.background));
    assert.ok(surface.ansi().length > 0);
});

test("food is bounded, can be eaten, and expires", () => {
    const world = new World();
    world.resize(800, 480);
    for (let n = 0; n < 20; n++) world.feed(400, 240);
    assert.equal(world.pellets.length, 24);
    world.pellets = [{ x: world.koi[0].nodes[0], y: world.koi[0].nodes[1],
        born: world.time, landAt: 0, landed: true, vx: 0, vy: 0 }];
    world.step(1 / 60);
    assert.equal(world.pellets.length, 0);
    assert.equal(world.bites.length, 1);
    world.feed(400, 240);
    world.koi = [];
    for (let n = 0; n < 1000; n++) world.step(1 / 60);
    assert.equal(world.pellets.length, 0);
    assert.equal(world.ripples.length, 0);
});

test("rendering works at multiple sizes and paused frames remain stable", () => {
    const world = new World();
    world.resize(800, 480);
    const surface = new CellSurface();
    const renderer = new KoiRenderer(surface);
    for (const [cols, rows] of [[100, 32], [45, 16], [160, 50]]) {
        // Keep the fixture inside even the smallest viewport.
        for (const koi of world.koi) {
            for (let n = 0; n < 20; n++) {
                koi.nodes[n * 2] = cols * 4 - n * 4;
                koi.nodes[n * 2 + 1] = rows * 8;
            }
        }
        renderer.resize(cols * 8, rows * 16);
        renderer.render(world, 1 / 24);
        assert.equal(surface.glyphs.length, cols * rows);
        assert.ok(surface.glyphs.some(code => code !== 32));
        renderer.render(world, 0);
        surface.ansi();
        renderer.render(world, 0);
        assert.equal(surface.ansi(), "");
    }
    renderer.setTheme(true);
    renderer.render(world, 0);
    assert.equal(surface.background, 0xf5f4f1);
});

test("CLI snapshot is pipeable and validates options", () => {
    const snapshot = spawnSync(process.execPath, ["src/cli.ts", "--snapshot", "--width", "60", "--height", "20", "--fish", "5"], { encoding: "utf8" });
    assert.equal(snapshot.status, 0, snapshot.stderr);
    const lines = snapshot.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 20);
    assert.ok(lines.slice(0, -1).every(line => line.length === 60));
    assert.match(snapshot.stdout, /5 koi/);
    assert.ok(!snapshot.stdout.includes("\x1b"));
    const invalid = spawnSync(process.execPath, ["src/cli.ts", "--fps", "0"], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /--fps must be/);
    const piped = spawnSync(process.execPath, ["src/cli.ts"], { encoding: "utf8" });
    assert.equal(piped.status, 1);
    assert.match(piped.stderr, /interactive terminal/);
    for (const option of [["--renderer", "invalid"], ["--cell-aspect", "0"], ["--cell-aspect", "NaN"]]) {
        const invalid = spawnSync(process.execPath, ["src/cli.ts", "--snapshot", ...option], { encoding: "utf8" });
        assert.equal(invalid.status, 1);
    }
});
