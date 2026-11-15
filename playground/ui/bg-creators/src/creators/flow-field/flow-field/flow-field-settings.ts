/**
 * Reads the Flow Field product settings from Toolcraft runtime values and
 * derives render-ready data (palette lookup table, fade fill style).
 */

export const flowFieldTargets = {
  backgroundColor: "color.background",
  colorA: "color.a",
  colorB: "color.b",
  colorBy: "color.mode",
  colorC: "color.c",
  fieldSpeed: "field.speed",
  flowStrength: "field.strength",
  interactionMode: "interaction.mode",
  interactionRadius: "interaction.radius",
  interactionStrength: "interaction.strength",
  motionAnimate: "motion.animate",
  motionSpeed: "motion.speed",
  noiseScale: "field.noiseScale",
  particleCount: "particles.count",
  particleSize: "particles.size",
  particleSpeed: "particles.speed",
  trailFade: "particles.trailFade",
  useColorC: "color.useC",
} as const;

export const flowFieldDefaults = {
  backgroundColor: "#05060A",
  colorA: "#38BDF8",
  colorB: "#C084FC",
  colorBy: "speed" as const,
  colorC: "#F0ABFC",
  fieldSpeed: 0.6,
  flowStrength: 1.2,
  interactionMode: "repel" as const,
  interactionRadius: 160,
  interactionStrength: 1,
  motionAnimate: true,
  motionSpeed: 1,
  noiseScale: 2.5,
  particleCount: 3000,
  particleSize: 1.1,
  particleSpeed: 1.6,
  trailFade: 8,
  useColorC: false,
} as const;

export type FlowFieldColorBy = "angle" | "speed";
export type FlowFieldInteractionMode = "attract" | "off" | "repel";

export type FlowFieldSettings = {
  backgroundColor: string;
  colorA: string;
  colorB: string;
  colorBy: FlowFieldColorBy;
  colorC: string;
  fieldSpeed: number;
  flowStrength: number;
  interactionMode: FlowFieldInteractionMode;
  interactionRadius: number;
  interactionStrength: number;
  motionAnimate: boolean;
  motionSpeed: number;
  noiseScale: number;
  particleCount: number;
  particleSize: number;
  particleSpeed: number;
  /** Percent of the background repainted per frame (trail fade amount). */
  trailFade: number;
  useColorC: boolean;
};

function asNumber(value: unknown, fallback: number): number {
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

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asHexColor(value: unknown, fallback: string): string {
  if (typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value.trim())) {
    return value.trim();
  }

  return fallback;
}

function asColorBy(value: unknown): FlowFieldColorBy {
  return value === "angle" ? "angle" : flowFieldDefaults.colorBy;
}

function asInteractionMode(value: unknown): FlowFieldInteractionMode {
  if (value === "attract" || value === "off" || value === "repel") {
    return value;
  }

  return flowFieldDefaults.interactionMode;
}

export function readFlowFieldSettings(
  values: Record<string, unknown>,
): FlowFieldSettings {
  return {
    backgroundColor: asHexColor(
      values[flowFieldTargets.backgroundColor],
      flowFieldDefaults.backgroundColor,
    ),
    colorA: asHexColor(values[flowFieldTargets.colorA], flowFieldDefaults.colorA),
    colorB: asHexColor(values[flowFieldTargets.colorB], flowFieldDefaults.colorB),
    colorBy: asColorBy(values[flowFieldTargets.colorBy]),
    colorC: asHexColor(values[flowFieldTargets.colorC], flowFieldDefaults.colorC),
    fieldSpeed: asNumber(values[flowFieldTargets.fieldSpeed], flowFieldDefaults.fieldSpeed),
    flowStrength: asNumber(
      values[flowFieldTargets.flowStrength],
      flowFieldDefaults.flowStrength,
    ),
    interactionMode: asInteractionMode(values[flowFieldTargets.interactionMode]),
    interactionRadius: asNumber(
      values[flowFieldTargets.interactionRadius],
      flowFieldDefaults.interactionRadius,
    ),
    interactionStrength: asNumber(
      values[flowFieldTargets.interactionStrength],
      flowFieldDefaults.interactionStrength,
    ),
    motionAnimate: asBoolean(
      values[flowFieldTargets.motionAnimate],
      flowFieldDefaults.motionAnimate,
    ),
    motionSpeed: asNumber(values[flowFieldTargets.motionSpeed], flowFieldDefaults.motionSpeed),
    noiseScale: asNumber(values[flowFieldTargets.noiseScale], flowFieldDefaults.noiseScale),
    particleCount: Math.round(
      asNumber(values[flowFieldTargets.particleCount], flowFieldDefaults.particleCount),
    ),
    particleSize: asNumber(
      values[flowFieldTargets.particleSize],
      flowFieldDefaults.particleSize,
    ),
    particleSpeed: asNumber(
      values[flowFieldTargets.particleSpeed],
      flowFieldDefaults.particleSpeed,
    ),
    trailFade: asNumber(values[flowFieldTargets.trailFade], flowFieldDefaults.trailFade),
    useColorC: asBoolean(values[flowFieldTargets.useColorC], flowFieldDefaults.useColorC),
  };
}

type Rgb = { b: number; g: number; r: number };

export function parseHexColor(hex: string): Rgb {
  let normalized = hex.replace("#", "");

  if (normalized.length === 3 || normalized.length === 4) {
    normalized = normalized
      .slice(0, 3)
      .split("")
      .map((char) => char + char)
      .join("");
  }

  const value = Number.parseInt(normalized.slice(0, 6), 16);

  if (!Number.isFinite(value)) {
    return { b: 255, g: 255, r: 255 };
  }

  return {
    b: value & 255,
    g: (value >> 8) & 255,
    r: (value >> 16) & 255,
  };
}

export const flowFieldPaletteSize = 32;

function lerpChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

function mixColors(from: Rgb, to: Rgb, t: number): string {
  return `rgb(${lerpChannel(from.r, to.r, t)},${lerpChannel(from.g, to.g, t)},${lerpChannel(
    from.b,
    to.b,
    t,
  )})`;
}

/** Builds the color lookup table used to batch particle strokes per bucket. */
export function buildFlowFieldPalette(settings: FlowFieldSettings): string[] {
  const stops = [parseHexColor(settings.colorA), parseHexColor(settings.colorB)];

  if (settings.useColorC) {
    stops.push(parseHexColor(settings.colorC));
  }

  const palette: string[] = [];
  const segments = stops.length - 1;

  for (let i = 0; i < flowFieldPaletteSize; i += 1) {
    const t = (i / (flowFieldPaletteSize - 1)) * segments;
    const segment = Math.min(segments - 1, Math.floor(t));
    palette.push(mixColors(stops[segment], stops[segment + 1], t - segment));
  }

  return palette;
}

export function buildFadeFillStyle(settings: FlowFieldSettings): string {
  const { b, g, r } = parseHexColor(settings.backgroundColor);
  const alpha = Math.min(1, Math.max(0.005, settings.trailFade / 100));

  return `rgba(${r},${g},${b},${alpha})`;
}
