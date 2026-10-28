import type { InputEvent } from "./input.ts";

type GeometryReport = Extract<InputEvent, { type: "geometry" }>;

/** XTWINOPS cell, text-pixel, and text-character queries (xterm ctlseqs). */
export const ASPECT_QUERY = "\x1b[16t\x1b[14t\x1b[18t";

export class AspectDetector {
    private deadline = -Infinity;
    private pixels: GeometryReport | undefined;
    private characters: GeometryReport | undefined;
    private direct = false;
    private detected = false;

    begin(now = performance.now()) {
        this.deadline = now + 500;
        this.pixels = undefined;
        this.characters = undefined;
        this.direct = false;
        this.detected = false;
        return ASPECT_QUERY;
    }

    status(now = performance.now()): "detected" | "detecting" | "fallback" {
        return this.detected ? "detected" : now <= this.deadline ? "detecting" : "fallback";
    }

    receive(report: GeometryReport, cols: number, rows: number, now = performance.now()): number | undefined {
        if (now > this.deadline || !Number.isSafeInteger(report.width) || !Number.isSafeInteger(report.height) ||
            report.width <= 0 || report.height <= 0) return;
        let aspect: number;
        if (report.kind === "cell") {
            aspect = report.height / report.width;
        } else {
            if (this.direct) return;
            if (report.kind === "pixels") this.pixels = report;
            else this.characters = report;
            // Pair pixel and character reports from this query. Do not combine
            // a stale grid with a fresh pixel area during a window resize.
            if (!this.pixels || !this.characters || this.characters.width !== cols || this.characters.height !== rows) return;
            aspect = (this.pixels.height / this.characters.height) / (this.pixels.width / this.characters.width);
        }
        if (!Number.isFinite(aspect) || aspect < 1 || aspect > 3) return;
        if (report.kind === "cell") this.direct = true;
        this.detected = true;
        return aspect;
    }
}
