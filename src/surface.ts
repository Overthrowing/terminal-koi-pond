export type RenderMode = "blocks" | "ascii";

/** Raster samples are packed into physical terminal cells at presentation time. */
export class CellSurface {
    readonly mode: RenderMode;
    readonly cellWidth = 8;
    readonly cellHeight: number;
    readonly terminalCellHeight: number;
    cols = 0;
    rows = 0;
    globalAlpha = 1;
    fillStyle = 0;
    background = 0x1a1921;
    glyphs = new Uint16Array(0);
    foregrounds = new Uint32Array(0);
    backgrounds = new Uint32Array(0);
    private previousGlyphs = new Uint16Array(0);
    private previousForegrounds = new Uint32Array(0);
    private previousBackgrounds = new Uint32Array(0);
    private dirty = true;
    private labels = new Map<number, { glyph: number; color: number }>();

    constructor(mode: RenderMode = "ascii", cellAspect = 2) {
        this.mode = mode;
        this.terminalCellHeight = this.cellWidth * cellAspect;
        this.cellHeight = this.terminalCellHeight / (mode === "blocks" ? 2 : 1);
    }

    get pixelMode() { return this.mode === "blocks"; }
    get terminalRows() { return Math.ceil(this.rows / (this.pixelMode ? 2 : 1)); }

    setBackground(rgb: number[]) {
        this.background = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
        this.invalidate();
    }

    resize(cols: number, rows: number) {
        this.cols = cols;
        this.rows = rows;
        const n = cols * rows;
        this.glyphs = new Uint16Array(n);
        this.foregrounds = new Uint32Array(n);
        this.backgrounds = new Uint32Array(n);
        const outputSize = cols * this.terminalRows;
        this.previousGlyphs = new Uint16Array(outputSize);
        this.previousForegrounds = new Uint32Array(outputSize);
        this.previousBackgrounds = new Uint32Array(outputSize);
        this.invalidate();
    }

    invalidate() { this.dirty = true; }

    clear() {
        this.labels.clear();
        this.glyphs.fill(32);
        this.foregrounds.fill(this.background);
        this.backgrounds.fill(this.background);
    }

    private index(x: number, y: number) {
        const col = Math.floor(x / this.cellWidth);
        const row = Math.floor(y / this.cellHeight);
        return col < 0 || col >= this.cols || row < 0 || row >= this.rows ? -1 : row * this.cols + col;
    }

    private blend(over: number, under: number) {
        const a = Math.max(0, Math.min(1, this.globalAlpha));
        const r = Math.round((over >>> 16) * a + (under >>> 16) * (1 - a));
        const g = Math.round(((over >>> 8) & 255) * a + ((under >>> 8) & 255) * (1 - a));
        const b = Math.round((over & 255) * a + (under & 255) * (1 - a));
        return ((r & 252) << 16) | ((g & 252) << 8) | (b & 252);
    }

    fillRect(x: number, y: number, _width: number, _height: number) {
        const i = this.index(x, y);
        if (i >= 0) this.backgrounds[i] = this.blend(this.fillStyle, this.backgrounds[i]);
    }

    fillText(glyph: string, x: number, y: number) {
        const i = this.index(x, y);
        if (i < 0) return;
        if (this.pixelMode) {
            this.backgrounds[i] = this.blend(this.fillStyle, this.backgrounds[i]);
            return;
        }
        this.glyphs[i] = glyph.charCodeAt(0);
        this.foregrounds[i] = this.blend(this.fillStyle, this.backgrounds[i]);
    }

    text(text: string, col: number, row: number, color: number) {
        if (row < 0 || row >= this.terminalRows) return;
        for (let c = 0; c < text.length && col + c < this.cols; c++) {
            if (col + c >= 0) this.labels.set(row * this.cols + col + c, { glyph: text.charCodeAt(c), color });
        }
    }

    clearRows(from: number) {
        const start = Math.max(0, from) * this.cols * (this.pixelMode ? 2 : 1);
        this.glyphs.fill(32, start);
        this.backgrounds.fill(this.background, start);
    }

    /** Two independently colored half blocks share one terminal cell. */
    frame() {
        const n = this.cols * this.terminalRows;
        const glyphs = new Uint16Array(n);
        const foregrounds = new Uint32Array(n);
        const backgrounds = new Uint32Array(n);
        for (let i = 0; i < n; i++) {
            if (this.pixelMode) {
                const row = Math.floor(i / this.cols);
                const top = this.backgrounds[row * 2 * this.cols + i % this.cols];
                const bottom = this.backgrounds[(row * 2 + 1) * this.cols + i % this.cols] ?? this.background;
                glyphs[i] = top === bottom ? 32 : 0x2580;
                foregrounds[i] = top;
                backgrounds[i] = bottom;
            } else {
                glyphs[i] = this.glyphs[i];
                foregrounds[i] = this.foregrounds[i];
                backgrounds[i] = this.backgrounds[i];
            }
        }
        for (const [i, label] of this.labels) {
            glyphs[i] = label.glyph;
            foregrounds[i] = label.color;
            backgrounds[i] = this.background;
        }
        return { glyphs, foregrounds, backgrounds };
    }

    /** Emit only changed runs; never clear the terminal between frames. */
    ansi(color = true) {
        const { glyphs, foregrounds, backgrounds } = this.frame();
        let out = "";
        let fg = -1;
        let bg = -1;
        let cursor = -1;
        for (let i = 0; i < glyphs.length; i++) {
            const glyph = glyphs[i];
            const foreground = foregrounds[i];
            const background = backgrounds[i];
            const unchanged = glyph === this.previousGlyphs[i] &&
                (!color || (background === this.previousBackgrounds[i] &&
                    (glyph === 32 || foreground === this.previousForegrounds[i])));
            if (!this.dirty && unchanged) continue;
            if (cursor !== i || i % this.cols === 0) out += `\x1b[${Math.floor(i / this.cols) + 1};${i % this.cols + 1}H`;
            if (color && bg !== background) {
                out += `\x1b[48;2;${background >>> 16};${(background >>> 8) & 255};${background & 255}m`;
                bg = background;
            }
            if (color && glyph !== 32 && fg !== foreground) {
                out += `\x1b[38;2;${foreground >>> 16};${(foreground >>> 8) & 255};${foreground & 255}m`;
                fg = foreground;
            }
            out += String.fromCharCode(glyph);
            cursor = i + 1;
        }
        this.previousGlyphs.set(glyphs);
        this.previousForegrounds.set(foregrounds);
        this.previousBackgrounds.set(backgrounds);
        this.dirty = false;
        return out;
    }

    plain() {
        const { glyphs } = this.frame();
        const lines: string[] = [];
        for (let row = 0; row < this.terminalRows; row++) {
            lines.push(String.fromCharCode(...glyphs.subarray(row * this.cols, (row + 1) * this.cols)));
        }
        return lines.join("\n");
    }
}
