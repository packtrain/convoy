import type { HalftoneGrid } from "./halftone-grid";
import {
  parseHalftoneHexColor,
  type HalftoneRgb,
  type HalftoneSettings,
  type HalftoneShape,
} from "./halftone-settings";

export type HalftonePointer = {
  x: number;
  y: number;
};

export type HalftoneFrameInput = {
  context: CanvasRenderingContext2D;
  grid: HalftoneGrid;
  pointer: HalftonePointer | null;
  settings: HalftoneSettings;
  timeSeconds: number;
};

const duotoneBucketCount = 24;
const hoverRippleScale = 0.35;
const pulseSpatialFrequency = 0.006;
const pulseTemporalFrequency = Math.PI * 0.45;

/**
 * Builds the 256-entry tone lookup table for the current brightness, contrast,
 * gamma, and invert settings. Rebuilt once per frame (trivial cost) so per-dot
 * work stays at a single array read.
 */
export function createHalftoneToneLut(settings: HalftoneSettings): Float32Array {
  const lut = new Float32Array(256);
  const contrastFactor = 1 + settings.contrast / 100;
  const brightnessOffset = settings.brightness / 100;
  const gammaExponent = 1 / Math.max(0.05, settings.gamma);

  for (let index = 0; index < 256; index += 1) {
    let value = index / 255 + brightnessOffset;

    value = (value - 0.5) * contrastFactor + 0.5;
    value = Math.min(1, Math.max(0, value));
    value = value ** gammaExponent;

    if (settings.invert) {
      value = 1 - value;
    }

    lut[index] = value;
  }

  return lut;
}

function addDotToPath(
  path: Path2D,
  shape: HalftoneShape,
  x: number,
  y: number,
  radius: number,
): void {
  if (shape === "circle") {
    path.moveTo(x + radius, y);
    path.arc(x, y, radius, 0, Math.PI * 2);
    return;
  }

  if (shape === "square") {
    path.rect(x - radius, y - radius, radius * 2, radius * 2);
    return;
  }

  path.moveTo(x, y - radius);
  path.lineTo(x + radius, y);
  path.lineTo(x, y + radius);
  path.lineTo(x - radius, y);
  path.closePath();
}

function mixRgb(from: HalftoneRgb, to: HalftoneRgb, weight: number): string {
  const r = Math.round(from.r + (to.r - from.r) * weight);
  const g = Math.round(from.g + (to.g - from.g) * weight);
  const b = Math.round(from.b + (to.b - from.b) * weight);

  return `rgb(${r},${g},${b})`;
}

/**
 * Draws one animated halftone frame; assumes a precomputed grid and a context already in
 * CSS-pixel coordinates. Only dot radii and fills are computed here — no per-frame image
 * sampling.
 *
 * Batching per color mode: mono is one Path2D and one fill; duotone one fill per tone
 * bucket; hover-reveal batches outside the hover radius and colors per dot inside it;
 * full-color is per-dot (bounded by grid spacing).
 */
export function renderHalftoneFrame({
  context,
  grid,
  pointer,
  settings,
  timeSeconds,
}: HalftoneFrameInput): void {
  const lut = createHalftoneToneLut(settings);
  const cellRadius = settings.spacing / 2;
  const minRadiusFactor = Math.min(settings.minDot, settings.maxDot) / 100;
  const maxRadiusFactor = Math.max(settings.minDot, settings.maxDot) / 100;
  const radiusSpan = maxRadiusFactor - minRadiusFactor;
  const pulseAmplitude = settings.motionEnabled ? settings.motionAmplitude / 100 : 0;
  const pulsePhase = timeSeconds * pulseTemporalFrequency;
  const tintRgb = parseHalftoneHexColor(settings.tint);
  const duotoneRgb = parseHalftoneHexColor(settings.duotone);
  const hoverRadius = Math.max(1, settings.hoverRadius);
  const hoverRadiusSquared = hoverRadius * hoverRadius;
  const falloffExponent = 0.35 + (settings.falloff / 100) * 2.4;
  const useHover = settings.colorMode === "hover-reveal" && pointer !== null;
  const { centerDistance, colors, count, luminance, positions } = grid;
  const monoPath = settings.colorMode === "mono" || settings.colorMode === "hover-reveal"
    ? new Path2D()
    : null;
  const duotonePaths =
    settings.colorMode === "duotone"
      ? Array.from({ length: duotoneBucketCount }, () => new Path2D())
      : null;

  for (let index = 0; index < count; index += 1) {
    const tone = lut[Math.round(luminance[index] * 255)];
    let radius = (minRadiusFactor + radiusSpan * tone) * cellRadius;

    if (pulseAmplitude > 0) {
      radius *=
        1 +
        pulseAmplitude *
          Math.sin(pulsePhase - centerDistance[index] * pulseSpatialFrequency);
    }

    const x = positions[index * 2];
    const y = positions[index * 2 + 1];
    let hoverWeight = 0;

    if (useHover && pointer) {
      const dx = x - pointer.x;
      const dy = y - pointer.y;
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared < hoverRadiusSquared) {
        const proximity = 1 - Math.sqrt(distanceSquared) / hoverRadius;

        hoverWeight = proximity ** falloffExponent;
        radius *= 1 + hoverRippleScale * hoverWeight;
      }
    }

    if (radius <= 0.05) {
      continue;
    }

    if (duotonePaths) {
      const bucket = Math.min(
        duotoneBucketCount - 1,
        Math.floor(tone * duotoneBucketCount),
      );

      addDotToPath(duotonePaths[bucket], settings.shape, x, y, radius);
      continue;
    }

    if (settings.colorMode === "full-color") {
      const dotPath = new Path2D();

      addDotToPath(dotPath, settings.shape, x, y, radius);
      context.fillStyle = `rgb(${colors[index * 3]},${colors[index * 3 + 1]},${colors[index * 3 + 2]})`;
      context.fill(dotPath);
      continue;
    }

    if (monoPath && hoverWeight <= 0.01) {
      addDotToPath(monoPath, settings.shape, x, y, radius);
      continue;
    }

    const revealedPath = new Path2D();
    const sourceRgb: HalftoneRgb = {
      b: colors[index * 3 + 2],
      g: colors[index * 3 + 1],
      r: colors[index * 3],
    };

    addDotToPath(revealedPath, settings.shape, x, y, radius);
    context.fillStyle = mixRgb(tintRgb, sourceRgb, hoverWeight);
    context.fill(revealedPath);
  }

  if (monoPath) {
    context.fillStyle = settings.tint;
    context.fill(monoPath);
  }

  if (duotonePaths) {
    for (let bucket = 0; bucket < duotoneBucketCount; bucket += 1) {
      const bucketTone = (bucket + 0.5) / duotoneBucketCount;

      context.fillStyle = mixRgb(duotoneRgb, tintRgb, bucketTone);
      context.fill(duotonePaths[bucket]);
    }
  }
}
