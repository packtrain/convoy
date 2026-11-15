export type AsciiColorMode = "full" | "hover" | "mono";

export type AsciiToneSettings = {
  brightness: number;
  contrast: number;
  gamma: number;
  invert: boolean;
};

export type AsciiSettings = {
  amplitude: number;
  animate: boolean;
  background: string;
  cellSize: number;
  colorMode: AsciiColorMode;
  falloff: number;
  fontWeight: number;
  hoverRadius: number;
  ramp: string;
  speed: number;
  tint: string;
  tone: AsciiToneSettings;
};

export const asciiRampPresets: Record<string, string> = {
  binary: " 01",
  blocks: " ░▒▓█",
  classic: " .:-=+*#%@",
};

const fallbackRamp = asciiRampPresets.classic;

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readColorMode(value: unknown): AsciiColorMode {
  return value === "full" || value === "mono" || value === "hover"
    ? value
    : "hover";
}

function readRamp(values: Record<string, unknown>): string {
  const preset = readString(values["chars.ramp"], "classic");

  if (preset === "custom") {
    const custom = typeof values["chars.custom"] === "string" ? values["chars.custom"] : "";

    return custom.length > 0 ? custom : fallbackRamp;
  }

  return asciiRampPresets[preset] ?? fallbackRamp;
}

export function readAsciiSettings(values: Record<string, unknown>): AsciiSettings {
  return {
    amplitude: clamp(readNumber(values["motion.amplitude"], 18), 0, 100) / 100,
    animate: readBoolean(values["motion.enabled"], true),
    background: readString(values["appearance.background"], "#060606"),
    cellSize: clamp(readNumber(values["chars.cellSize"], 12), 8, 32),
    colorMode: readColorMode(values["color.mode"]),
    falloff: clamp(readNumber(values["color.falloff"], 60), 0, 100) / 100,
    fontWeight: clamp(readNumber(Number(values["chars.fontWeight"]), 400), 100, 900),
    hoverRadius: clamp(readNumber(values["color.hoverRadius"], 220), 40, 600),
    ramp: readRamp(values),
    speed: clamp(readNumber(values["motion.speed"], 1), 0.1, 3),
    tint: readString(values["color.tint"], "#d9d9d9"),
    tone: {
      brightness: clamp(readNumber(values["tone.brightness"], 0), -100, 100) / 100,
      contrast: clamp(readNumber(values["tone.contrast"], 0), -100, 100) / 100,
      gamma: clamp(readNumber(values["tone.gamma"], 1), 0.2, 2.5),
      invert: readBoolean(values["tone.invert"], false),
    },
  };
}

export type RgbColor = { b: number; g: number; r: number };

export function parseHexColor(hex: string): RgbColor {
  const normalized = hex.replace("#", "").trim();
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => part + part)
          .join("")
      : normalized;
  const parsed = Number.parseInt(expanded.slice(0, 6), 16);

  if (!Number.isFinite(parsed) || expanded.length < 6) {
    return { b: 217, g: 217, r: 217 };
  }

  return {
    b: parsed & 0xff,
    g: (parsed >> 8) & 0xff,
    r: (parsed >> 16) & 0xff,
  };
}
