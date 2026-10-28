import test from "node:test";
import assert from "node:assert/strict";
import { AspectDetector, ASPECT_QUERY } from "../src/aspect.ts";
import { InputParser } from "../src/input.ts";
import { spawnSync } from "node:child_process";

test("geometry replies decode across every byte boundary without becoming controls", () => {
    const reply = "\x1b[6;16;9t\x1b[4;384;720t\x1b[8;24;80tm";
    const expected = [
        { type: "geometry", kind: "cell", height: 16, width: 9 },
        { type: "geometry", kind: "pixels", height: 384, width: 720 },
        { type: "geometry", kind: "characters", height: 24, width: 80 },
        { type: "key", key: "m" },
    ];
    for (let split = 0; split <= reply.length; split++) {
        const parser = new InputParser();
        assert.deepEqual([...parser.push(reply.slice(0, split)), ...parser.push(reply.slice(split))], expected);
    }
    const parser = new InputParser();
    assert.deepEqual([...reply].flatMap(byte => parser.push(byte)), expected);
});

test("cell dimensions take priority over text area measurements", () => {
    const detector = new AspectDetector();
    assert.equal(detector.begin(0), ASPECT_QUERY);
    assert.equal(detector.status(10), "detecting");
    assert.equal(detector.receive({ type: "geometry", kind: "pixels", height: 432, width: 720 }, 80, 24, 10), undefined);
    assert.equal(detector.receive({ type: "geometry", kind: "characters", height: 24, width: 80 }, 80, 24, 20), 2);
    assert.equal(detector.receive({ type: "geometry", kind: "cell", height: 16, width: 9 }, 80, 24, 30), 16 / 9);
    assert.equal(detector.receive({ type: "geometry", kind: "pixels", height: 432, width: 720 }, 80, 24, 40), undefined);
    assert.equal(detector.status(600), "detected");
});

test("fallback requires fresh matching grid dimensions and works in either reply order", () => {
    const detector = new AspectDetector();
    detector.begin(0);
    detector.receive({ type: "geometry", kind: "characters", height: 24, width: 80 }, 80, 24, 10);
    assert.equal(detector.receive({ type: "geometry", kind: "pixels", height: 384, width: 720 }, 80, 24, 20), 16 / 9);
    detector.begin(100);
    assert.equal(detector.receive({ type: "geometry", kind: "pixels", height: 512, width: 900 }, 100, 32, 110), undefined);
    assert.equal(detector.receive({ type: "geometry", kind: "characters", height: 24, width: 80 }, 100, 32, 120), undefined);
    assert.equal(detector.receive({ type: "geometry", kind: "characters", height: 32, width: 100 }, 100, 32, 130), 16 / 9);
});

test("no replies, late reports, and invalid geometry retain the fallback", () => {
    const detector = new AspectDetector();
    assert.equal(detector.status(0), "fallback");
    detector.begin(0);
    for (const [height, width] of [[0, 9], [16, 0], [100, 1], [1, 100], [NaN, 9], [16, Infinity]]) {
        assert.equal(detector.receive({ type: "geometry", kind: "cell", height, width }, 80, 24, 10), undefined);
    }
    assert.equal(detector.status(501), "fallback");
    assert.equal(detector.receive({ type: "geometry", kind: "cell", height: 16, width: 9 }, 80, 24, 600), undefined);
});

test("snapshot accepts auto without emitting terminal queries", () => {
    const result = spawnSync(process.execPath, ["src/cli.ts", "--snapshot", "--cell-aspect", "auto"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes("\x1b"));
});
