import type { GridLinesSettings } from "./grid-lines-settings";

export const PULSE_LOOP_SECONDS = 60;

const WOBBLE_AMPLITUDE_PX = 1.6;
const WOBBLE_SAMPLE_STEP_PX = 28;
const SCANLINE_BAND_PX = 140;
const MIN_CELL_SIZE_PX = 8;

type GridMetrics = {
  cell: number;
  cols: number;
  offsetX: number;
  offsetY: number;
  rows: number;
};

export function getGridMetrics(
  width: number,
  height: number,
  cellSize: number,
): GridMetrics {
  const cell = Math.max(MIN_CELL_SIZE_PX, cellSize);

  return {
    cell,
    cols: Math.floor(width / cell),
    offsetX: (width % cell) / 2,
    offsetY: (height % cell) / 2,
    rows: Math.floor(height / cell),
  };
}

function hexToRgb(hex: string): { b: number; g: number; r: number } {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized.slice(0, 6);
  const value = Number.parseInt(expanded.padEnd(6, "0"), 16);

  if (!Number.isFinite(value)) {
    return { b: 0, g: 0, r: 0 };
  }

  return {
    b: value & 0xff,
    g: (value >> 8) & 0xff,
    r: (value >> 16) & 0xff,
  };
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const { b, g, r } = hexToRgb(hex);
  const clamped = Math.min(1, Math.max(0, alpha));

  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

export function hash01(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function wobbleOffset(along: number, across: number, time: number): number {
  return (
    WOBBLE_AMPLITUDE_PX *
    Math.sin(along * 0.021 + across * 0.047 + time * 1.4) *
    Math.cos(along * 0.0073 + time * 0.6)
  );
}

export type GridLayerOptions = {
  crosshairAlpha: number;
  height: number;
  lineAlpha: number;
  lineColor: string;
  settings: GridLinesSettings;
  time: number;
  width: number;
  wobble: boolean;
};

export function drawGridLayer(
  ctx: CanvasRenderingContext2D,
  options: GridLayerOptions,
): void {
  const { crosshairAlpha, height, lineAlpha, lineColor, settings, time, width, wobble } =
    options;
  const { cell, cols, offsetX, offsetY, rows } = getGridMetrics(
    width,
    height,
    settings.cellSize,
  );

  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = Math.max(0.25, settings.lineThickness);
  ctx.strokeStyle = rgbaFromHex(lineColor, lineAlpha);
  ctx.lineCap = "round";
  ctx.beginPath();

  for (let column = 0; column <= cols; column += 1) {
    const x = offsetX + column * cell;

    if (!wobble) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      continue;
    }

    ctx.moveTo(x + wobbleOffset(0, x, time), 0);

    for (let y = WOBBLE_SAMPLE_STEP_PX; y < height + WOBBLE_SAMPLE_STEP_PX; y += WOBBLE_SAMPLE_STEP_PX) {
      const clampedY = Math.min(y, height);
      ctx.lineTo(x + wobbleOffset(clampedY, x, time), clampedY);
    }
  }

  for (let row = 0; row <= rows; row += 1) {
    const y = offsetY + row * cell;

    if (!wobble) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      continue;
    }

    ctx.moveTo(0, y + wobbleOffset(0, y, time));

    for (let x = WOBBLE_SAMPLE_STEP_PX; x < width + WOBBLE_SAMPLE_STEP_PX; x += WOBBLE_SAMPLE_STEP_PX) {
      const clampedX = Math.min(x, width);
      ctx.lineTo(clampedX, y + wobbleOffset(clampedX, y, time));
    }
  }

  ctx.stroke();

  if (settings.crosshairSize <= 0 || crosshairAlpha <= 0) {
    return;
  }

  const half = settings.crosshairSize / 2;
  const every = settings.crosshairEvery;

  ctx.strokeStyle = rgbaFromHex(lineColor, crosshairAlpha);
  ctx.lineWidth = Math.max(0.5, settings.lineThickness);
  ctx.beginPath();

  for (let column = 0; column <= cols; column += every) {
    for (let row = 0; row <= rows; row += every) {
      let x = offsetX + column * cell;
      let y = offsetY + row * cell;

      if (wobble) {
        x += wobbleOffset(y, x, time);
        y += wobbleOffset(x, y, time);
      }

      ctx.moveTo(x - half, y);
      ctx.lineTo(x + half, y);
      ctx.moveTo(x, y - half);
      ctx.lineTo(x, y + half);
    }
  }

  ctx.stroke();
}

export type SceneDrawOptions = {
  height: number;
  settings: GridLinesSettings;
  time: number;
  width: number;
};

export function drawPulses(
  ctx: CanvasRenderingContext2D,
  options: SceneDrawOptions,
): void {
  const { height, settings, time, width } = options;
  const count = Math.round(settings.pulseDensity);
  const intensity = settings.pulseIntensity / 100;

  if (count <= 0 || intensity <= 0) {
    return;
  }

  const { cell, cols, offsetX, offsetY, rows } = getGridMetrics(
    width,
    height,
    settings.cellSize,
  );

  if (cols <= 0 || rows <= 0) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let index = 0; index < count; index += 1) {
    const seed = index * 11 + 3;
    const start = hash01(seed) * PULSE_LOOP_SECONDS;
    const duration = 2.5 + hash01(seed + 1) * 3;
    const elapsed =
      (((time - start) % PULSE_LOOP_SECONDS) + PULSE_LOOP_SECONDS) %
      PULSE_LOOP_SECONDS;
    const phase = elapsed / duration;

    if (phase >= 1) {
      continue;
    }

    const column = Math.min(cols - 1, Math.floor(hash01(seed + 2) * cols));
    const row = Math.min(rows - 1, Math.floor(hash01(seed + 3) * rows));
    const envelope = Math.sin(Math.PI * phase) ** 2;
    const x = offsetX + column * cell;
    const y = offsetY + row * cell;

    ctx.fillStyle = rgbaFromHex(settings.accentColor, 0.28 * intensity * envelope);
    ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = rgbaFromHex(settings.accentColor, 0.65 * intensity * envelope);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
  }

  ctx.restore();
}

export function drawScanline(
  ctx: CanvasRenderingContext2D,
  options: SceneDrawOptions,
): void {
  const { height, settings, time, width } = options;

  if (!settings.scanline) {
    return;
  }

  const horizontal = settings.scanlineDirection === "horizontal";
  const span = (horizontal ? height : width) + SCANLINE_BAND_PX * 2;
  const pxPerSecond = 6 + settings.scanlineSpeed * 1.4;
  const center = ((time * pxPerSecond) % span) - SCANLINE_BAND_PX;
  const from = center - SCANLINE_BAND_PX / 2;
  const to = center + SCANLINE_BAND_PX / 2;
  const gradient = horizontal
    ? ctx.createLinearGradient(0, from, 0, to)
    : ctx.createLinearGradient(from, 0, to, 0);

  gradient.addColorStop(0, rgbaFromHex(settings.accentColor, 0));
  gradient.addColorStop(0.5, rgbaFromHex(settings.accentColor, 0.11));
  gradient.addColorStop(1, rgbaFromHex(settings.accentColor, 0));

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = gradient;

  if (horizontal) {
    ctx.fillRect(0, from, width, SCANLINE_BAND_PX);
  } else {
    ctx.fillRect(from, 0, SCANLINE_BAND_PX, height);
  }

  ctx.restore();
}
