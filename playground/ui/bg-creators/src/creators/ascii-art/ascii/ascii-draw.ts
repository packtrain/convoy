import type { AsciiGrid } from "./ascii-grid";
import { parseHexColor, type AsciiSettings } from "./ascii-settings";

export type AsciiPointer = {
  x: number;
  y: number;
};

export type AsciiDrawOptions = {
  ctx: CanvasRenderingContext2D;
  grid: AsciiGrid;
  height: number;
  pointer: AsciiPointer | null;
  settings: AsciiSettings;
  timeSeconds: number;
  width: number;
};

const monoLevelCount = 24;

function buildMonoStyles(tint: string): string[] {
  const { b, g, r } = parseHexColor(tint);
  const styles: string[] = new Array<string>(monoLevelCount);

  for (let level = 0; level < monoLevelCount; level += 1) {
    const factor = 0.35 + (0.65 * level) / (monoLevelCount - 1);

    styles[level] = `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(
      b * factor,
    )})`;
  }

  return styles;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 >= edge1) {
    return value < edge1 ? 0 : 1;
  }

  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
}

/**
 * Draws one ASCII frame from a precomputed grid. Per frame it only picks
 * glyphs and colors -- the source image is never resampled here.
 */
export function drawAscii({
  ctx,
  grid,
  height,
  pointer,
  settings,
  timeSeconds,
  width,
}: AsciiDrawOptions): void {
  const rampChars = [...settings.ramp];
  const rampLength = rampChars.length;

  if (rampLength === 0) {
    return;
  }

  const { cols, rows } = grid;
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const fontSize = Math.max(4, cellHeight * 0.92);
  const monoStyles = buildMonoStyles(settings.tint);
  const tint = parseHexColor(settings.tint);
  const time = timeSeconds * settings.speed;
  const shimmerStrength = settings.animate ? settings.amplitude * 0.22 : 0;
  const hoverEnabled = settings.colorMode === "hover" && pointer !== null;
  const fullColor = settings.colorMode === "full";
  const radius = settings.hoverRadius;
  const innerRadius = radius * (1 - settings.falloff);
  const pointerX = pointer?.x ?? 0;
  const pointerY = pointer?.y ?? 0;

  ctx.font = `${settings.fontWeight} ${fontSize}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let currentStyle = "";

  for (let row = 0; row < rows; row += 1) {
    const centerY = (row + 0.5) * cellHeight;

    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      let luminance = grid.lum[index];

      if (shimmerStrength > 0) {
        const wave =
          Math.sin(time * 1.7 + col * 0.53 + row * 0.81) * 0.6 +
          Math.sin(time * 1.05 + (col + row) * 0.37) * 0.4;

        luminance += wave * shimmerStrength * 0.5;
        luminance = luminance < 0 ? 0 : luminance > 1 ? 1 : luminance;
      }

      const charIndex = Math.min(rampLength - 1, Math.floor(luminance * rampLength));
      const char = rampChars[charIndex];

      if (char === " ") {
        continue;
      }

      const centerX = (col + 0.5) * cellWidth;
      let style: string;

      if (fullColor) {
        style = grid.colorStyles[index];
      } else if (hoverEnabled) {
        const dx = centerX - pointerX;
        const dy = centerY - pointerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const colorWeight = 1 - smoothstep(innerRadius, radius, distance);

        if (colorWeight <= 0.001) {
          const level = Math.min(monoLevelCount - 1, Math.floor(luminance * monoLevelCount));

          style = monoStyles[level];
        } else if (colorWeight >= 0.999) {
          style = grid.colorStyles[index];
        } else {
          const factor = 0.35 + 0.65 * luminance;
          const monoR = tint.r * factor;
          const monoG = tint.g * factor;
          const monoB = tint.b * factor;
          const sourceR = grid.colors[index * 3];
          const sourceG = grid.colors[index * 3 + 1];
          const sourceB = grid.colors[index * 3 + 2];

          style = `rgb(${Math.round(monoR + (sourceR - monoR) * colorWeight)},${Math.round(
            monoG + (sourceG - monoG) * colorWeight,
          )},${Math.round(monoB + (sourceB - monoB) * colorWeight)})`;
        }
      } else {
        const level = Math.min(monoLevelCount - 1, Math.floor(luminance * monoLevelCount));

        style = monoStyles[level];
      }

      if (style !== currentStyle) {
        ctx.fillStyle = style;
        currentStyle = style;
      }

      ctx.fillText(char, centerX, centerY);
    }
  }
}
