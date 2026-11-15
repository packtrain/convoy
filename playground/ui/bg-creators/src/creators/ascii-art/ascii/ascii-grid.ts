import type { ToolcraftMediaTransform } from "@/toolcraft/runtime";

import type { AsciiToneSettings } from "./ascii-settings";

/**
 * Hard cap on grid cells so the per-frame glyph pass stays cheap even for
 * large canvases with small cell sizes.
 */
const maxGridCells = 26000;

export type AsciiGridLayout = {
  cellHeight: number;
  cellWidth: number;
  cols: number;
  rows: number;
};

export type AsciiGrid = AsciiGridLayout & {
  /** Per-cell source color as a prebuilt canvas fillStyle string. */
  colorStyles: string[];
  /** Per-cell source RGB triplets for hover color mixing. */
  colors: Uint8ClampedArray;
  /** Per-cell tone-adjusted luminance in 0..1. */
  lum: Float32Array;
};

export function computeAsciiGridLayout({
  cellSize,
  height,
  width,
}: {
  cellSize: number;
  height: number;
  width: number;
}): AsciiGridLayout {
  let cols = Math.max(1, Math.round(width / cellSize));
  let rows = Math.max(1, Math.round(height / cellSize));

  if (cols * rows > maxGridCells) {
    const factor = Math.sqrt((cols * rows) / maxGridCells);

    cols = Math.max(1, Math.floor(cols / factor));
    rows = Math.max(1, Math.floor(rows / factor));
  }

  return {
    cellHeight: height / rows,
    cellWidth: width / cols,
    cols,
    rows,
  };
}

function applyTone(luminance: number, tone: AsciiToneSettings): number {
  const contrastFactor = tone.contrast >= 0 ? 1 + tone.contrast * 2 : 1 + tone.contrast;
  let value = (luminance - 0.5) * contrastFactor + 0.5 + tone.brightness;

  value = Math.min(1, Math.max(0, value));
  value = Math.pow(value, 1 / tone.gamma);

  return tone.invert ? 1 - value : value;
}

function drawSourceCovered({
  cols,
  context,
  image,
  rows,
  transform,
}: {
  cols: number;
  context: CanvasRenderingContext2D;
  image: HTMLImageElement;
  rows: number;
  transform?: ToolcraftMediaTransform;
}): void {
  const rotation = transform?.rotationDeg ?? 0;
  const rotated = rotation === 90 || rotation === 270;
  const sourceWidth = rotated ? image.naturalHeight : image.naturalWidth;
  const sourceHeight = rotated ? image.naturalWidth : image.naturalHeight;
  const scale = Math.max(cols / sourceWidth, rows / sourceHeight);

  context.save();
  context.translate(cols / 2, rows / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.scale(
    (transform?.flipHorizontal ? -1 : 1) * scale,
    (transform?.flipVertical ? -1 : 1) * scale,
  );
  context.drawImage(
    image,
    -image.naturalWidth / 2,
    -image.naturalHeight / 2,
    image.naturalWidth,
    image.naturalHeight,
  );
  context.restore();
}

/**
 * Samples the source image into a character grid: one cover-cropped draw at
 * grid resolution, one getImageData, then tone-mapped luminance plus prebuilt
 * per-cell color styles. Runs only when the source, tone, or grid layout
 * changes -- never per animation frame.
 */
export function sampleAsciiGrid({
  image,
  layout,
  tone,
  transform,
}: {
  image: HTMLImageElement;
  layout: AsciiGridLayout;
  tone: AsciiToneSettings;
  transform?: ToolcraftMediaTransform;
}): AsciiGrid | null {
  const { cols, rows } = layout;
  const offscreen = document.createElement("canvas");

  offscreen.width = cols;
  offscreen.height = rows;

  const context = offscreen.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return null;
  }

  context.imageSmoothingEnabled = true;
  drawSourceCovered({ cols, context, image, rows, transform });

  const pixels = context.getImageData(0, 0, cols, rows).data;
  const cellCount = cols * rows;
  const lum = new Float32Array(cellCount);
  const colors = new Uint8ClampedArray(cellCount * 3);
  const colorStyles: string[] = new Array<string>(cellCount);

  for (let index = 0; index < cellCount; index += 1) {
    const offset = index * 4;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    lum[index] = applyTone(luminance, tone);
    colors[index * 3] = r;
    colors[index * 3 + 1] = g;
    colors[index * 3 + 2] = b;
    colorStyles[index] = `rgb(${r},${g},${b})`;
  }

  return { ...layout, colorStyles, colors, lum };
}
