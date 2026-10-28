export type InputEvent =
    | { type: "key"; key: string }
    | { type: "geometry"; kind: "cell" | "pixels" | "characters"; height: number; width: number }
    | { type: "mouse"; col: number; row: number; feed: boolean };

/** Decode streaming input, including mouse reports split across reads. */
export class InputParser {
    private pending = "";

    /** A short caller timeout distinguishes bare Escape from an incoming CSI. */
    flushEscape(): InputEvent[] {
        if (this.pending !== "\x1b") return [];
        this.pending = "";
        return [{ type: "key", key: "escape" }];
    }

    push(chunk: string): InputEvent[] {
        this.pending += chunk;
        const events: InputEvent[] = [];
        while (this.pending.length) {
            if (this.pending.startsWith("\x1b")) {
                // XTWINOPS replies are input from the terminal, never keypresses.
                const geometry = /^\x1b\[(4|6|8);(\d+);(\d+)t/.exec(this.pending);
                if (geometry) {
                    events.push({ type: "geometry", kind: geometry[1] === "6" ? "cell" : geometry[1] === "4" ? "pixels" : "characters",
                        height: Number(geometry[2]), width: Number(geometry[3]) });
                    this.pending = this.pending.slice(geometry[0].length);
                    continue;
                }
                const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.pending);
                if (mouse) {
                    const button = Number(mouse[1]);
                    if ((button & 64) === 0 && mouse[4] === "M") {
                        events.push({ type: "mouse", col: Number(mouse[2]) - 1, row: Number(mouse[3]) - 1,
                            feed: (button & 3) === 0 && (button & 32) === 0 });
                    }
                    this.pending = this.pending.slice(mouse[0].length);
                    continue;
                }
                const arrow = /^\x1b(?:\[|O)([ABCD])/.exec(this.pending);
                if (arrow) {
                    events.push({ type: "key", key: ({ A: "up", B: "down", C: "right", D: "left" })[arrow[1]]! });
                    this.pending = this.pending.slice(arrow[0].length);
                    continue;
                }
                if (/^\x1b(?:\[(?:[<\d;]*)?|O)?$/.test(this.pending)) break;
                const unknown = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(this.pending);
                this.pending = this.pending.slice(unknown ? unknown[0].length : 1);
                continue;
            }
            events.push({ type: "key", key: this.pending[0] });
            this.pending = this.pending.slice(1);
        }
        return events;
    }
}
