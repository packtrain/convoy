export type GridLinesScanlineDirection = "horizontal" | "vertical";

export type GridLinesSettings = {
  accentColor: string;
  animate: boolean;
  backgroundColor: string;
  cellSize: number;
  crosshairEvery: number;
  crosshairOpacity: number;
  crosshairSize: number;
  glowRadius: number;
  glowStrength: number;
  lineColor: string;
  lineOpacity: number;
  lineThickness: number;
  pulseDensity: number;
  pulseIntensity: number;
  scanline: boolean;
  scanlineDirection: GridLinesScanlineDirection;
  scanlineSpeed: number;
  speed: number;
  wobble: boolean;
};

export const defaultGridLinesSettings: GridLinesSettings = {
  accentColor: "#6aa2ff",
  animate: true,
  backgroundColor: "#05070b",
  cellSize: 56,
  crosshairEvery: 2,
  crosshairOpacity: 80,
  crosshairSize: 6,
  glowRadius: 160,
  glowStrength: 60,
  lineColor: "#2e3646",
  lineOpacity: 55,
  lineThickness: 1,
  pulseDensity: 8,
  pulseIntensity: 45,
  scanline: true,
  scanlineDirection: "horizontal",
  scanlineSpeed: 25,
  speed: 100,
  wobble: false,
};

function readNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return value;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "boolean") {
    return fallback;
  }

  return value;
}

function readHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(value)) {
    return fallback;
  }

  return value;
}

function readScanlineDirection(
  value: unknown,
  fallback: GridLinesScanlineDirection,
): GridLinesScanlineDirection {
  if (value === "horizontal" || value === "vertical") {
    return value;
  }

  return fallback;
}

export function readGridLinesSettings(
  values: Record<string, unknown>,
): GridLinesSettings {
  const defaults = defaultGridLinesSettings;

  return {
    accentColor: readHexColor(values["accent.color"], defaults.accentColor),
    animate: readBoolean(values["motion.enabled"], defaults.animate),
    backgroundColor: readHexColor(
      values["background.color"],
      defaults.backgroundColor,
    ),
    cellSize: readNumber(values["grid.cellSize"], defaults.cellSize),
    crosshairEvery: Math.max(
      1,
      Math.round(readNumber(values["grid.crosshairEvery"], defaults.crosshairEvery)),
    ),
    crosshairOpacity: readNumber(
      values["grid.crosshairOpacity"],
      defaults.crosshairOpacity,
    ),
    crosshairSize: readNumber(values["grid.crosshairSize"], defaults.crosshairSize),
    glowRadius: readNumber(values["interaction.glowRadius"], defaults.glowRadius),
    glowStrength: readNumber(
      values["interaction.glowStrength"],
      defaults.glowStrength,
    ),
    lineColor: readHexColor(values["grid.lineColor"], defaults.lineColor),
    lineOpacity: readNumber(values["grid.lineOpacity"], defaults.lineOpacity),
    lineThickness: readNumber(
      values["grid.lineThickness"],
      defaults.lineThickness,
    ),
    pulseDensity: readNumber(values["accent.pulseDensity"], defaults.pulseDensity),
    pulseIntensity: readNumber(
      values["accent.pulseIntensity"],
      defaults.pulseIntensity,
    ),
    scanline: readBoolean(values["accent.scanline"], defaults.scanline),
    scanlineDirection: readScanlineDirection(
      values["accent.scanlineDirection"],
      defaults.scanlineDirection,
    ),
    scanlineSpeed: readNumber(
      values["accent.scanlineSpeed"],
      defaults.scanlineSpeed,
    ),
    speed: readNumber(values["motion.speed"], defaults.speed),
    wobble: readBoolean(values["motion.wobble"], defaults.wobble),
  };
}
