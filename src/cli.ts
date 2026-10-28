#!/usr/bin/env node
import { parseArgs } from "node:util";
import { World, clamp } from "./world.ts";
import { KoiRenderer } from "./renderer.ts";
import { CellSurface, type RenderMode } from "./surface.ts";
import { InputParser } from "./input.ts";
import { SettingsMenu, adjustSetting, type PondSettings } from "./settings.ts";

const help = `Terminal Koi Pond

Usage: npm start -- [options]
       node src/cli.ts [options]

Click / Space / f   Drop food (arrows or WASD move the feeding point)
p                  Pause / resume
t                  Toggle dark / light water
r                  New pond
h                  Show / hide controls
m / ,              Open settings (arrows adjust, Esc closes)
q / Ctrl-C         Quit

Options:
  --fps N          Frames per second, 1–60 (default: 24)
  --fish N         Number of koi, 1–20 (default: automatic)
  --renderer MODE  blocks (default) or ascii (original text tiles)
  --cell-aspect N  Cell height / width (default: 2; e.g. 1.8)
  --light          Start with the paper-colored theme
  --no-mouse       Disable terminal mouse tracking
  --no-color       Use plain characters without color
  --snapshot       Print a single frame and exit (works in a pipe)
  --width N        Snapshot columns (default: 100)
  --height N       Snapshot rows (default: 32)
  --help           Show this help
`;

function integer(value: string | undefined, name: string, fallback: number, min: number, max: number) {
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    return n;
}

async function main() {
    const { values } = parseArgs({ options: {
        fps: { type: "string" }, fish: { type: "string" }, light: { type: "boolean" },
        renderer: { type: "string" }, "cell-aspect": { type: "string" },
        "no-mouse": { type: "boolean" }, "no-color": { type: "boolean" },
        snapshot: { type: "boolean" }, width: { type: "string" }, height: { type: "string" },
        help: { type: "boolean", short: "h" },
    } });
    if (values.help) { process.stdout.write(help); return; }
    let fps = integer(values.fps, "--fps", 24, 1, 60);
    let fish = integer(values.fish, "--fish", 0, 1, 20);
    const width = integer(values.width, "--width", 100, 20, 500);
    const height = integer(values.height, "--height", 32, 8, 200);
    if (!values.snapshot && (!process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === "dumb")) {
        throw new Error("Run this in an interactive terminal, or use --snapshot for a still frame.");
    }
    const color = !values["no-color"] && process.env.NO_COLOR === undefined;
    let mode = values.renderer ?? (color && !values.snapshot ? "blocks" : "ascii");
    if (mode !== "blocks" && mode !== "ascii") throw new Error("--renderer must be blocks or ascii.");
    if (mode === "blocks" && (!color || values.snapshot)) {
        throw new Error("The blocks renderer needs color; use --renderer ascii with --no-color or --snapshot.");
    }
    let cellAspect = Number(values["cell-aspect"] ?? 2);
    if (!Number.isFinite(cellAspect) || cellAspect < 1 || cellAspect > 3) {
        throw new Error("--cell-aspect must be a number from 1 to 3.");
    }
    let mouse = !values["no-mouse"];
    let light = !!values.light;
    let paused = false;
    let showHelp = true;
    let world: World;
    let cols = values.snapshot ? width : process.stdout.columns || 80;
    let rows = values.snapshot ? height : process.stdout.rows || 24;
    let target = { col: Math.floor(cols / 2), row: Math.floor((rows - 2) / 2) };
    let targetUntil = 0;
    let lastPointer = performance.now();
    let surface = new CellSurface(mode as RenderMode, cellAspect);
    let cellHeight = surface.terminalCellHeight;
    let renderer = new KoiRenderer(surface);
    const menu = new SettingsMenu();
    renderer.setTheme(light);

    function settings(): PondSettings {
        return { mode: mode as RenderMode, cellAspect, fps, fish: world.koi.length, light, mouse, showHelp };
    }

    function applySettings(next: PondSettings) {
        if (next.mode !== mode || next.cellAspect !== cellAspect) {
            mode = next.mode;
            cellAspect = next.cellAspect;
            surface = new CellSurface(mode as RenderMode, cellAspect);
            cellHeight = surface.terminalCellHeight;
            renderer = new KoiRenderer(surface);
            renderer.setTheme(next.light);
            resize();
        }
        if (next.fish !== world.koi.length) {
            fish = next.fish;
            while (world.koi.length < fish) {
                const more = new World();
                more.resize(world.width, world.height);
                const koi = more.koi[0];
                koi.id = Math.max(0, ...world.koi.map(k => k.id)) + 1;
                world.koi.push(koi);
            }
            world.koi.length = fish;
            renderer.reset();
        }
        if (light !== next.light) renderer.setTheme(next.light);
        if (mouse !== next.mouse) {
            process.stdout.write(next.mouse ? "\x1b[?1003h\x1b[?1006h" : "\x1b[?1003l\x1b[?1006l");
            world.pointer.active = false;
        }
        ({ fps, light, mouse, showHelp } = next);
    }

    function newPond() {
        renderer.reset();
        world = new World();
        world.resize(cols * 8, Math.max(1, rows - 2) * cellHeight);
        if (fish) {
            while (world.koi.length < fish) {
                const more = new World();
                more.resize(world.width, world.height);
                for (const koi of more.koi) {
                    koi.id = world.koi.length + 1;
                    world.koi.push(koi);
                    if (world.koi.length === fish) break;
                }
            }
            world.koi.length = fish;
        }
        for (let n = 0; n < 120; n++) world.step(1 / 30);
        surface.invalidate();
    }

    function resize() {
        const oldW = world?.width || cols * 8;
        const oldH = world?.height || Math.max(1, rows - 2) * cellHeight;
        cols = values.snapshot ? width : Math.max(1, process.stdout.columns || 80);
        rows = values.snapshot ? height : Math.max(1, process.stdout.rows || 24);
        const w = cols * 8;
        const h = Math.max(1, rows - 2) * cellHeight;
        if (world) {
            for (const koi of world.koi) {
                for (let n = 0; n < koi.nodes.length; n += 2) {
                    koi.nodes[n] *= w / oldW;
                    koi.nodes[n + 1] *= h / oldH;
                }
                koi.food = null;
            }
            for (const item of [...world.pellets, ...world.ripples, ...world.bites]) {
                item.x *= w / oldW;
                item.y *= h / oldH;
            }
            world.resize(w, h);
            world.pointer.active = false;
        }
        target.col = clamp(target.col, 0, cols - 1);
        target.row = clamp(target.row, 0, Math.max(0, rows - 3));
        renderer.resize(w, rows * cellHeight);
    }

    function point(col: number, row: number) {
        target = { col: clamp(col, 0, cols - 1), row: clamp(row, 0, Math.max(0, rows - 3)) };
        const now = performance.now();
        const x = target.col * 8 + 4;
        const y = (target.row + 0.5) * cellHeight;
        const distance = Math.hypot(x - world.pointer.x, y - world.pointer.y);
        world.pointer.speed = world.pointer.active ? distance / Math.max(0.016, (now - lastPointer) / 1000) : 0;
        Object.assign(world.pointer, { x, y, active: true });
        lastPointer = now;
        targetUntil = now + 1500;
    }

    function draw(dt: number) {
        renderer.render(world, paused ? 0 : dt);
        if (!color || values.snapshot) {
            // The browser renderer puts much of the silhouette in colored tiles.
            for (let i = 0; i < surface.glyphs.length; i++) {
                if (surface.glyphs[i] === 32 && surface.backgrounds[i] !== surface.background) surface.glyphs[i] = 46;
            }
        }
        if (performance.now() < targetUntil) {
            surface.globalAlpha = 0.55;
            surface.fillStyle = light ? 0x403e3a : 0xb4b0a8;
            surface.text("+", target.col, target.row, surface.fillStyle);
        }
        const ink = light ? 0x706b63 : 0x8c8794;
        // Reserve the last two rows for the status strip.
        surface.clearRows(rows - 2);
        const stats = `  KOI POND  /  ${world.koi.length} koi  /  ${world.pellets.length} pellets${paused ? "  /  PAUSED" : ""}`;
        surface.text(stats, 0, Math.max(0, rows - 2), ink);
        if (showHelp) {
            const controls = cols >= 88 ? "  click / space feed   arrows move   m settings   p pause   t theme   h hide   q quit" :
                cols >= 55 ? "  space feed  arrows move  m settings  p pause  q quit" : "  m settings  space feed  q quit";
            surface.text(controls, 0, rows - 1, ink);
        }
        if (cols < 20 || rows < 8) {
            surface.clear();
            surface.text("Enlarge terminal", 0, 0, ink);
        }
        if (menu.open) menu.draw(surface, settings(), color);
    }

    resize();
    newPond();
    if (values.snapshot) {
        draw(1 / fps);
        process.stdout.write(surface.plain() + "\n");
        return;
    }

    const input = new InputParser();
    let running = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let escapeTimer: ReturnType<typeof setTimeout> | undefined;
    const wasRaw = !!process.stdin.isRaw;
    const enter = "\x1b[?1049h\x1b[?25l\x1b[?7l" + (mouse ? "\x1b[?1003h\x1b[?1006h" : "");
    const leave = "\x1b[?1003l\x1b[?1006l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l";

    function cleanup() {
        if (!running) return;
        running = false;
        if (timer) clearTimeout(timer);
        if (escapeTimer) clearTimeout(escapeTimer);
        process.stdout.off("resize", resize);
        process.stdin.off("data", onInput);
        process.stdin.setRawMode(wasRaw);
        process.stdin.pause();
        process.stdout.write(leave);
    }

    function onInput(chunk: string) {
        if (escapeTimer) clearTimeout(escapeTimer);
        handleInput(input.push(chunk));
        if (running) escapeTimer = setTimeout(() => handleInput(input.flushEscape()), 50);
    }

    function handleInput(events: ReturnType<InputParser["push"]>) {
        for (const event of events) {
            if (event.type === "mouse") {
                if (menu.open || !mouse) continue;
                if (event.row >= rows - 2) continue;
                point(event.col, event.row);
                if (event.feed && !paused) world.feed(world.pointer.x, world.pointer.y);
                continue;
            }
            const key = event.key.toLowerCase();
            if (key === "\x03" || key === "\x04") { cleanup(); return; }
            if (menu.open) {
                const action = menu.handleKey(key);
                if (action?.type === "adjust") applySettings(adjustSetting(settings(), action.key, action.direction, color));
                continue;
            }
            if (key === "q") { cleanup(); return; }
            if (key === "m" || key === ",") {
                menu.open = true;
                world.pointer.active = false;
                targetUntil = 0;
                continue;
            }
            if (key === "p") paused = !paused;
            if (key === "h" || key === "?") showHelp = !showHelp;
            if (key === "t") { light = !light; renderer.setTheme(light); }
            if (key === "r") newPond();
            if (["up", "w", "down", "s", "left", "a", "right", "d"].includes(key)) {
                point(target.col + (["left", "a"].includes(key) ? -2 : ["right", "d"].includes(key) ? 2 : 0),
                    target.row + (["up", "w"].includes(key) ? -1 : ["down", "s"].includes(key) ? 1 : 0));
            }
            if ((key === " " || key === "f" || key === "\r") && !paused) {
                world.feed(target.col * 8 + 4, (target.row + 0.5) * cellHeight);
                targetUntil = performance.now() + 1500;
            }
        }
        // Refresh controls immediately, even when the pond is set to 1 fps.
        if (events.length && running && timer !== undefined) {
            clearTimeout(timer);
            timer = setTimeout(frame, 0);
        }
    }

    process.on("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    process.once("SIGHUP", cleanup);
    process.stdout.on("resize", resize);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onInput);
    process.stdout.write(enter);
    let last = performance.now();
    function frame() {
        timer = undefined;
        if (!running) return;
        const started = performance.now();
        const dt = Math.min(1, Math.max(0.001, (started - last) / 1000));
        last = started;
        if (started - lastPointer > 5000) world.pointer.active = false;
        if (!paused) {
            const steps = Math.ceil(dt * 30);
            for (let n = 0; n < steps; n++) world.step(dt / steps);
        }
        draw(dt);
        const ready = process.stdout.write(surface.ansi(color));
        const next = () => { if (running) timer = setTimeout(frame, Math.max(0, 1000 / fps - (performance.now() - started))); };
        if (ready) next();
        else process.stdout.once("drain", next);
    }
    try { frame(); }
    catch (error) { cleanup(); throw error; }
}

main().catch((error: Error) => {
    process.stderr.write(`koi: ${error.message}\n`);
    process.exitCode = 1;
});
