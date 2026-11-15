import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// Token values are checked by reading the stylesheet: jsdom does not compute Tailwind CSS.
const appDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(appDir, "..");
const css = readFileSync(path.join(appDir, "globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Missing ${selector} block`);
  return css.slice(start, css.indexOf("\n}", start));
}

function tokens(selector: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block(selector).matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    map.set(match[1], match[2].trim());
  }
  return map;
}

/** sRGB channels for a hex value or an achromatic `oklch(L 0 0)`. */
function rgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const oklch = /^oklch\(([\d.]+) 0 0\)$/.exec(value);
  if (oklch) {
    const linear = Number(oklch[1]) ** 3;
    const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    const channel = encoded * 255;
    return [channel, channel, channel];
  }
  throw new Error(`Unsupported color ${value}`);
}

function luminance(value: string): number {
  const [r, g, b] = rgb(value).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const STATUS_TOKENS = ["success", "warning", "info"] as const;
const THEMES = [":root", ".dark"] as const;

describe("status color tokens", () => {
  test.each(THEMES)("%s defines each status with soft and foreground variants", (theme) => {
    const values = tokens(theme);
    for (const name of STATUS_TOKENS) {
      for (const suffix of ["", "-soft", "-foreground"]) {
        expect(values.has(`--${name}${suffix}`), `--${name}${suffix} in ${theme}`).toBe(true);
      }
    }
  });

  test("@theme exposes each status token as a color utility", () => {
    const theme = tokens("@theme inline");
    for (const name of STATUS_TOKENS) {
      for (const suffix of ["", "-soft", "-foreground"]) {
        expect(theme.get(`--color-${name}${suffix}`)).toBe(`var(--${name}${suffix})`);
      }
    }
  });

  test.each(THEMES)("%s status text holds 4.5:1 on background and card", (theme) => {
    const values = tokens(theme);
    for (const name of STATUS_TOKENS) {
      for (const surface of ["--background", "--card"]) {
        const ratio = contrast(values.get(`--${name}`)!, values.get(surface)!);
        expect(ratio, `--${name} on ${surface} in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("theme surfaces", () => {
  test("light accent is a visible step away from muted", () => {
    const light = tokens(":root");
    expect(light.get("--accent")).not.toBe(light.get("--muted"));
    expect(contrast(light.get("--accent")!, light.get("--muted")!)).toBeGreaterThanOrEqual(1.08);
  });

  test("light focus ring holds 3:1 on the background, without halving its opacity", () => {
    const light = tokens(":root");
    expect(contrast(light.get("--ring")!, light.get("--background")!)).toBeGreaterThanOrEqual(3);
    expect(css).not.toMatch(/outline-ring\/50/);
  });

  test.each(["--card", "--popover", "--sidebar", "--muted", "--secondary"])(
    "dark %s is an exact hex value",
    (name) => {
      expect(tokens(".dark").get(name)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  );
});

const RAW_PALETTE =
  /((?:[^\s"'`:]+:)*)(text|bg|border|fill|stroke|ring|outline|decoration|divide|from|to|via)-(red|green|emerald|amber|yellow|blue|sky|orange|lime|teal|cyan|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/g;

// Directories migrated to tokens. The terminal block is restyled with the code theme (slice 7).
const TOKENIZED_PATHS = [
  "components/blocks/thread",
  "components/blocks/project",
  "components/blocks/tasks",
  "components/blocks/workflows",
  "components/blocks/watch-tower/thread-status.tsx",
  "components/custom/diff",
  "components/blocks/worktrees",
  "lib/environment/config.ts",
  "lib/threads",
];
const EXEMPT_FILES = new Set(["components/blocks/thread/message-parts/terminal-tool-part.tsx"]);

function sourceFiles(relative: string): string[] {
  const absolute = path.join(webDir, relative);
  if (statSync(absolute).isFile()) return [relative];
  return readdirSync(absolute).flatMap((entry) => sourceFiles(path.join(relative, entry)));
}

/** A raw hue passes only as one half of a light/dark pair on the same line. */
function unpairedPaletteClasses(line: string): string[] {
  const unpaired: string[] = [];
  for (const match of line.matchAll(RAW_PALETTE)) {
    const [whole, variants, utility, hue] = match;
    if (variants.split(":").includes("dark")) continue;
    if (!line.includes(`dark:${variants}${utility}-${hue}-`)) unpaired.push(whole);
  }
  return unpaired;
}

describe("status and surface colors use theme tokens", () => {
  test("tokenized surfaces have no raw palette class without a dark pair", () => {
    const offenders: string[] = [];
    for (const file of TOKENIZED_PATHS.flatMap(sourceFiles)) {
      if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file) || EXEMPT_FILES.has(file)) continue;
      readFileSync(path.join(webDir, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const cls of unpairedPaletteClasses(line)) offenders.push(`${file}:${index + 1} ${cls}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
