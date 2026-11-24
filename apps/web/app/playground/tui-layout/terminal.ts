// Cell-accurate text layout: every Line is exactly one terminal row of segments.
export type Tone = "text" | "muted" | "accent" | "head" | "run" | "warn" | "ok" | "bad" | "tab";
export interface Seg {
  t: string;
  tone?: Tone;
  sel?: "on" | "dim";
  act?: string;
}
export type Line = Seg[];

export const seg = (t: string, tone?: Tone, act?: string): Seg => ({ t, tone, act });
export const width = (line: Line) => line.reduce((n, x) => n + x.t.length, 0);
export const act = (line: Line, id: string): Line => line.map((x) => ({ ...x, act: x.act ?? id }));
export const mark = (line: Line, sel: "on" | "dim" | undefined): Line =>
  sel ? line.map((x) => ({ ...x, sel })) : line;

export function slice(line: Line, from: number, to: number): Line {
  const out: Line = [];
  let at = 0;
  for (const x of line) {
    const a = Math.max(from, at);
    const b = Math.min(to, at + x.t.length);
    if (a < b) out.push({ ...x, t: x.t.slice(a - at, b - at) });
    at += x.t.length;
  }
  return out;
}

/** Pads or truncates to exactly w cells; padding keeps the row's selection and click target. */
export function fit(line: Line, w: number): Line {
  if (w <= 0) return [];
  const n = width(line);
  const sel = line.find((x) => x.sel)?.sel;
  const id = line.find((x) => x.act)?.act;
  if (n <= w) return [...line, { t: " ".repeat(w - n), sel, act: id }];
  return [...slice(line, 0, w - 1), { t: "…", tone: "muted", sel, act: id }];
}

export function spread(left: Line, right: Line, w: number): Line {
  const room = w - width(right) - 1;
  return fit([...fit(left, room), seg(" "), ...right], w);
}

/** Fixed-width columns, two spaces apart; the last column takes the rest. */
export function cols(cells: (Line | string)[], widths: number[], w: number): Line {
  const out: Line = [];
  cells.forEach((c, i) => {
    const line = typeof c === "string" ? [seg(c)] : c;
    const last = i === cells.length - 1;
    out.push(...(last ? line : fit(line, widths[i])), ...(last ? [] : [seg("  ")]));
  });
  return fit(out, w);
}

/** Word wrap; breaks a word only when it alone is wider than the row. */
export function wrap(text: string, w: number, tone?: Tone): Line[] {
  const rows: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= w) cur += ` ${word}`;
    else {
      rows.push(cur);
      cur = word;
    }
    while (cur.length > w) {
      rows.push(cur.slice(0, w));
      cur = cur.slice(w);
    }
  }
  rows.push(cur);
  return rows.map((r) => [seg(r, tone)]);
}

const LIGHT = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };
const HEAVY = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" };

/** A titled pane. Focus is a heavy border, so it reads without color. */
export function box(o: {
  w: number;
  h: number;
  title: Line;
  foot?: Line;
  focused?: boolean;
  body: Line[];
  cursorLine?: number;
}): Line[] {
  const b = o.focused ? HEAVY : LIGHT;
  const tone: Tone = o.focused ? "accent" : "muted";
  const inner = o.h - 2;
  let start = 0;
  if (o.body.length > inner && o.cursorLine !== undefined) {
    start = Math.max(0, Math.min(o.cursorLine - Math.floor(inner / 2), o.body.length - inner));
  }
  const above = start;
  const below = Math.max(0, o.body.length - start - inner);
  const more = [above && `↑ ${above}`, below && `↓ ${below} more`].filter(Boolean).join(" · ");
  const foot = o.foot ?? (more ? [seg(more, "muted")] : []);

  const edge = (l: string, r: string, label: Line, right: boolean): Line => {
    const text = label.length ? [seg(" "), ...label, seg(" ")] : [];
    const room = o.w - 4;
    const labelLine = width(text) > room ? fit(text, room) : text;
    const fill = seg(b.h.repeat(Math.max(0, room - width(labelLine))), tone);
    const lead = seg(l + b.h, tone);
    const tail = seg(b.h + r, tone);
    return right ? [lead, fill, ...labelLine, tail] : [lead, ...labelLine, fill, tail];
  };

  const rows = [edge(b.tl, b.tr, o.title, false)];
  for (let i = 0; i < inner; i++) {
    const line = o.body[start + i] ?? [];
    const sel = line.find((x) => x.sel)?.sel;
    rows.push([seg(b.v, tone), ...mark(fit([seg(" "), ...line], o.w - 3), sel), seg(" "), seg(b.v, tone)]);
  }
  rows.push(edge(b.bl, b.br, foot, true));
  return rows;
}

export const hjoin = (...blocks: Line[][]): Line[] => blocks[0].map((_, i) => blocks.flatMap((b) => b[i] ?? []));

export function overlay(base: Line[], top: Line[], x: number, y: number): Line[] {
  const out = [...base];
  top.forEach((row, i) => {
    const r = out[y + i];
    if (r) out[y + i] = [...slice(r, 0, x), ...row, ...slice(r, x + width(row), Infinity)];
  });
  return out;
}
