export type HalftoneShape = "circle" | "diamond" | "square";

export type HalftoneColorMode = "duotone" | "full-color" | "hover-reveal" | "mono";

export type HalftoneSettings = {
  angleDeg: number;
  background: string;
  brightness: number;
  colorMode: HalftoneColorMode;
  contrast: number;
  duotone: string;
  falloff: number;
  gamma: number;
  hoverRadius: number;
  includeBackground: boolean;
  invert: boolean;
  maxDot: number;
  minDot: number;
  motionAmplitude: number;
  motionEnabled: boolean;
  motionSpeed: number;
  shape: HalftoneShape;
  spacing: number;
  tint: string;
};

export type HalftoneRgb = {
  b: number;
  g: number;
  r: number;
};

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function readColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return fallback;
}

function readOption<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  if (typeof value === "string" && (options as readonly string[]).includes(value)) {
    return value as T;
  }

  return fallback;
}

export function readHalftoneSettings(values: Record<string, unknown>): HalftoneSettings {
  return {
    angleDeg: readNumber(values["grid.angle"], 0),
    background: readColor(values["scene.background"], "#08080d"),
    brightness: readNumber(values["tone.brightness"], 0),
    colorMode: readOption<HalftoneColorMode>(
      values["color.mode"],
      ["duotone", "full-color", "hover-reveal", "mono"],
      "hover-reveal",
    ),
    contrast: readNumber(values["tone.contrast"], 0),
    duotone: readColor(values["color.duotone"], "#3730a3"),
    falloff: readNumber(values["color.falloff"], 60),
    gamma: readNumber(values["tone.gamma"], 1),
    hoverRadius: readNumber(values["color.hoverRadius"], 220),
    includeBackground: readBoolean(values["export.includeBackground"], true),
    invert: readBoolean(values["tone.invert"], false),
    maxDot: readNumber(values["tone.maxDot"], 100),
    minDot: readNumber(values["tone.minDot"], 0),
    motionAmplitude: readNumber(values["motion.amplitude"], 8),
    motionEnabled: readBoolean(values["motion.enabled"], true),
    motionSpeed: readNumber(values["motion.speed"], 1),
    shape: readOption<HalftoneShape>(
      values["grid.shape"],
      ["circle", "diamond", "square"],
      "circle",
    ),
    spacing: Math.max(2, readNumber(values["grid.spacing"], 14)),
    tint: readColor(values["color.tint"], "#93a0b8"),
  };
}

export function parseHalftoneHexColor(color: string): HalftoneRgb {
  const normalized = color.trim().replace(/^#/u, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;
  const value = Number.parseInt(expanded.slice(0, 6), 16);

  if (!Number.isFinite(value) || expanded.length < 6) {
    return { b: 176, g: 160, r: 147 };
  }

  return {
    b: value & 0xff,
    g: (value >> 8) & 0xff,
    r: (value >> 16) & 0xff,
  };
}
