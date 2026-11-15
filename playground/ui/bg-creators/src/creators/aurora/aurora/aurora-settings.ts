export type AuroraBlendMode = "lighter" | "normal" | "screen";

export type AuroraSettings = {
  animate: boolean;
  backgroundColor: string;
  blendMode: AuroraBlendMode;
  blobCount: number;
  blobSize: number;
  blur: number;
  colors: readonly [string, string, string, string];
  drift: number;
  grainAnimated: boolean;
  grainEnabled: boolean;
  grainIntensity: number;
  intensity: number;
  parallax: number;
  seed: number;
  speed: number;
  vignette: boolean;
  vignetteStrength: number;
};

export const auroraTargets = {
  animate: "aurora.animate",
  backgroundColor: "aurora.backgroundColor",
  blendMode: "aurora.blendMode",
  blobCount: "aurora.blobCount",
  blobSize: "aurora.blobSize",
  blur: "aurora.blur",
  color1: "aurora.color1",
  color2: "aurora.color2",
  color3: "aurora.color3",
  color4: "aurora.color4",
  drift: "aurora.drift",
  grainAnimated: "aurora.grainAnimated",
  grainEnabled: "aurora.grainEnabled",
  grainIntensity: "aurora.grainIntensity",
  intensity: "aurora.intensity",
  parallax: "aurora.parallax",
  seed: "aurora.seed",
  speed: "aurora.speed",
  vignette: "aurora.vignette",
  vignetteStrength: "aurora.vignetteStrength",
} as const;

export const auroraDefaults: AuroraSettings = {
  animate: true,
  backgroundColor: "#050510",
  blendMode: "screen",
  blobCount: 5,
  blobSize: 55,
  blur: 60,
  colors: ["#5e6ad2", "#8b5cf6", "#22d3ee", "#ec4899"],
  drift: 40,
  grainAnimated: false,
  grainEnabled: true,
  grainIntensity: 25,
  intensity: 70,
  parallax: 30,
  seed: 7,
  speed: 30,
  vignette: true,
  vignetteStrength: 45,
};

export const auroraSeedMax = 1000;
export const auroraSeedMin = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readNumber(
  values: Record<string, unknown>,
  target: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = values[target];

  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, min, max);
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);

    if (Number.isFinite(parsed)) {
      return clamp(parsed, min, max);
    }
  }

  return fallback;
}

function readBoolean(
  values: Record<string, unknown>,
  target: string,
  fallback: boolean,
): boolean {
  const value = values[target];

  return typeof value === "boolean" ? value : fallback;
}

const hexColorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function readColor(
  values: Record<string, unknown>,
  target: string,
  fallback: string,
): string {
  const value = values[target];

  if (typeof value === "string" && hexColorPattern.test(value.trim())) {
    return value.trim();
  }

  return fallback;
}

function readBlendMode(values: Record<string, unknown>): AuroraBlendMode {
  const value = values[auroraTargets.blendMode];

  if (value === "lighter" || value === "normal" || value === "screen") {
    return value;
  }

  return auroraDefaults.blendMode;
}

export function readAuroraSettings(
  values: Record<string, unknown>,
): AuroraSettings {
  return {
    animate: readBoolean(values, auroraTargets.animate, auroraDefaults.animate),
    backgroundColor: readColor(
      values,
      auroraTargets.backgroundColor,
      auroraDefaults.backgroundColor,
    ),
    blendMode: readBlendMode(values),
    blobCount: Math.round(
      readNumber(values, auroraTargets.blobCount, auroraDefaults.blobCount, 3, 7),
    ),
    blobSize: readNumber(
      values,
      auroraTargets.blobSize,
      auroraDefaults.blobSize,
      10,
      100,
    ),
    blur: readNumber(values, auroraTargets.blur, auroraDefaults.blur, 0, 100),
    colors: [
      readColor(values, auroraTargets.color1, auroraDefaults.colors[0]),
      readColor(values, auroraTargets.color2, auroraDefaults.colors[1]),
      readColor(values, auroraTargets.color3, auroraDefaults.colors[2]),
      readColor(values, auroraTargets.color4, auroraDefaults.colors[3]),
    ],
    drift: readNumber(values, auroraTargets.drift, auroraDefaults.drift, 0, 100),
    grainAnimated: readBoolean(
      values,
      auroraTargets.grainAnimated,
      auroraDefaults.grainAnimated,
    ),
    grainEnabled: readBoolean(
      values,
      auroraTargets.grainEnabled,
      auroraDefaults.grainEnabled,
    ),
    grainIntensity: readNumber(
      values,
      auroraTargets.grainIntensity,
      auroraDefaults.grainIntensity,
      0,
      100,
    ),
    intensity: readNumber(
      values,
      auroraTargets.intensity,
      auroraDefaults.intensity,
      0,
      100,
    ),
    parallax: readNumber(
      values,
      auroraTargets.parallax,
      auroraDefaults.parallax,
      0,
      100,
    ),
    seed: Math.round(
      readNumber(
        values,
        auroraTargets.seed,
        auroraDefaults.seed,
        auroraSeedMin,
        auroraSeedMax,
      ),
    ),
    speed: readNumber(values, auroraTargets.speed, auroraDefaults.speed, 0, 100),
    vignette: readBoolean(
      values,
      auroraTargets.vignette,
      auroraDefaults.vignette,
    ),
    vignetteStrength: readNumber(
      values,
      auroraTargets.vignetteStrength,
      auroraDefaults.vignetteStrength,
      0,
      100,
    ),
  };
}

export function createRandomAuroraSeed(): number {
  return (
    auroraSeedMin +
    Math.floor(Math.random() * (auroraSeedMax - auroraSeedMin + 1))
  );
}
