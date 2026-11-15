import type { ToolcraftMediaTransform } from "@/toolcraft/runtime";

export type HalftoneGrid = {
  /** Distance of every dot from the canvas center, used by the idle radial pulse. */
  centerDistance: Float32Array;
  /** Sampled source colors as interleaved r,g,b triplets. */
  colors: Uint8ClampedArray;
  count: number;
  /** Raw sampled luminance per dot, 0..1, before tone mapping. */
  luminance: Float32Array;
  /** Dot centers as interleaved x,y pairs in canvas CSS pixels. */
  positions: Float32Array;
};

export type HalftoneGridInput = {
  angleDeg: number;
  height: number;
  image: HTMLImageElement;
  spacing: number;
  transform?: ToolcraftMediaTransform;
  width: number;
};

const maxSampleDimension = 1024;

/**
 * Draws the source image cover-cropped into the target bounds, honoring the
 * runtime media transform (rotation in 90° steps plus flips).
 */
export function drawHalftoneCoverImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
  transform?: ToolcraftMediaTransform,
): void {
  const rotationDeg = transform?.rotationDeg ?? 0;
  const swapAxes = rotationDeg % 180 !== 0;
  const naturalWidth = Math.max(1, image.naturalWidth);
  const naturalHeight = Math.max(1, image.naturalHeight);
  const effectiveWidth = swapAxes ? naturalHeight : naturalWidth;
  const effectiveHeight = swapAxes ? naturalWidth : naturalHeight;
  const scale = Math.max(targetWidth / effectiveWidth, targetHeight / effectiveHeight);

  context.save();
  context.translate(targetWidth / 2, targetHeight / 2);
  context.rotate((rotationDeg * Math.PI) / 180);
  context.scale(
    transform?.flipHorizontal ? -scale : scale,
    transform?.flipVertical ? -scale : scale,
  );
  context.drawImage(image, -naturalWidth / 2, -naturalHeight / 2);
  context.restore();
}

/**
 * Samples the source image once into a compact offscreen buffer and computes
 * the rotated halftone grid: per-cell position, luminance, and source color.
 * This is the expensive step; it runs only when image, spacing, angle, canvas
 * size, or media transform change — never per animation frame.
 */
export function sampleHalftoneGrid({
  angleDeg,
  height,
  image,
  spacing,
  transform,
  width,
}: HalftoneGridInput): HalftoneGrid | null {
  if (width < 1 || height < 1 || image.naturalWidth < 1 || image.naturalHeight < 1) {
    return null;
  }

  const sampleScale = Math.min(
    2 / spacing,
    maxSampleDimension / Math.max(width, height),
    1,
  );
  const sampleWidth = Math.max(1, Math.round(width * sampleScale));
  const sampleHeight = Math.max(1, Math.round(height * sampleScale));
  const sampleCanvas = document.createElement("canvas");

  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;

  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });

  if (!sampleContext) {
    return null;
  }

  drawHalftoneCoverImage(sampleContext, image, sampleWidth, sampleHeight, transform);

  const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const centerX = width / 2;
  const centerY = height / 2;
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const margin = spacing / 2;
  const reach = Math.sqrt(centerX * centerX + centerY * centerY) + spacing;
  const steps = Math.ceil(reach / spacing);
  const capacity = (2 * steps + 1) ** 2;
  const positions = new Float32Array(capacity * 2);
  const luminance = new Float32Array(capacity);
  const colors = new Uint8ClampedArray(capacity * 3);
  const centerDistance = new Float32Array(capacity);
  let count = 0;

  for (let row = -steps; row <= steps; row += 1) {
    const v = row * spacing;

    for (let column = -steps; column <= steps; column += 1) {
      const u = column * spacing;
      const x = centerX + u * cos - v * sin;
      const y = centerY + u * sin + v * cos;

      if (x < -margin || x > width + margin || y < -margin || y > height + margin) {
        continue;
      }

      const sampleX = Math.min(
        sampleWidth - 1,
        Math.max(0, Math.round((x / width) * (sampleWidth - 1))),
      );
      const sampleY = Math.min(
        sampleHeight - 1,
        Math.max(0, Math.round((y / height) * (sampleHeight - 1))),
      );
      const pixelIndex = (sampleY * sampleWidth + sampleX) * 4;
      const r = pixels[pixelIndex];
      const g = pixels[pixelIndex + 1];
      const b = pixels[pixelIndex + 2];

      positions[count * 2] = x;
      positions[count * 2 + 1] = y;
      luminance[count] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      colors[count * 3] = r;
      colors[count * 3 + 1] = g;
      colors[count * 3 + 2] = b;
      centerDistance[count] = Math.hypot(x - centerX, y - centerY);
      count += 1;
    }
  }

  return {
    centerDistance: centerDistance.subarray(0, count),
    colors: colors.subarray(0, count * 3),
    count,
    luminance: luminance.subarray(0, count),
    positions: positions.subarray(0, count * 2),
  };
}
