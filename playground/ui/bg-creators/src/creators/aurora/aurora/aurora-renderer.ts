import type { AuroraSettings } from "./aurora-settings";

export type AuroraPointer = {
  x: number;
  y: number;
};

export type AuroraFrame = {
  grainPhase: number;
  phase: number;
};

export const auroraNeutralPointer: AuroraPointer = { x: 0, y: 0 };
export const auroraStillFrame: AuroraFrame = { grainPhase: 0, phase: 0 };

type AuroraBlob = {
  anchorX: number;
  anchorY: number;
  color: string;
  depth: number;
  orbitPhaseX: number;
  orbitPhaseY: number;
  orbitRadius: number;
  orbitTurnsX: number;
  orbitTurnsY: number;
  radius: number;
};

const blobLayerDownscale = 1 / 8;
const blobLayerMinEdge = 24;
const blobLayerMaxEdge = 400;
const grainTileSize = 160;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHexColor(color: string): { b: number; g: number; r: number } {
  const hex = color.replace("#", "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;

  return {
    b: Number.parseInt(expanded.slice(4, 6), 16) || 0,
    g: Number.parseInt(expanded.slice(2, 4), 16) || 0,
    r: Number.parseInt(expanded.slice(0, 2), 16) || 0,
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const { b, g, r } = parseHexColor(color);

  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

export function computeAuroraBlobs(
  settings: AuroraSettings,
  width: number,
  height: number,
): AuroraBlob[] {
  const random = mulberry32(settings.seed * 2654435761 + 1);
  const minEdge = Math.min(width, height);
  const blobs: AuroraBlob[] = [];

  for (let index = 0; index < settings.blobCount; index += 1) {
    const sizeJitter = 0.55 + random() * 0.5;

    blobs.push({
      anchorX: (0.14 + random() * 0.72) * width,
      anchorY: (0.12 + random() * 0.76) * height,
      color: settings.colors[index % settings.colors.length],
      depth: 0.3 + random() * 0.7,
      orbitPhaseX: random() * Math.PI * 2,
      orbitPhaseY: random() * Math.PI * 2,
      orbitRadius: (settings.drift / 100) * minEdge * (0.12 + random() * 0.24),
      orbitTurnsX: 1 + Math.floor(random() * 2),
      orbitTurnsY: 1 + Math.floor(random() * 2),
      radius: minEdge * (settings.blobSize / 100) * sizeJitter,
    });
  }

  return blobs;
}

let cachedGrainTile: HTMLCanvasElement | null = null;

function getGrainTile(): HTMLCanvasElement {
  if (cachedGrainTile) {
    return cachedGrainTile;
  }

  const tile = document.createElement("canvas");
  tile.width = grainTileSize;
  tile.height = grainTileSize;

  const context = tile.getContext("2d");

  if (context) {
    const imageData = context.createImageData(grainTileSize, grainTileSize);
    const random = mulberry32(0x5eed);

    for (let index = 0; index < imageData.data.length; index += 4) {
      const value = 96 + Math.floor(random() * 64);

      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
  }

  cachedGrainTile = tile;
  return tile;
}

function getBlobCompositeOperation(
  settings: AuroraSettings,
): GlobalCompositeOperation {
  if (settings.blendMode === "normal") {
    return "source-over";
  }

  return settings.blendMode;
}

function paintBlobLayer({
  frame,
  layer,
  pointer,
  settings,
  viewHeight,
  viewWidth,
}: {
  frame: AuroraFrame;
  layer: HTMLCanvasElement;
  pointer: AuroraPointer;
  settings: AuroraSettings;
  viewHeight: number;
  viewWidth: number;
}): boolean {
  const scale = Math.min(
    Math.max(viewWidth * blobLayerDownscale, blobLayerMinEdge),
    blobLayerMaxEdge,
  );
  const layerWidth = Math.max(blobLayerMinEdge, Math.round(scale));
  const layerHeight = Math.max(
    blobLayerMinEdge,
    Math.round((scale / Math.max(viewWidth, 1)) * viewHeight),
  );

  if (layer.width !== layerWidth || layer.height !== layerHeight) {
    layer.width = layerWidth;
    layer.height = layerHeight;
  }

  const context = layer.getContext("2d");

  if (!context) {
    return false;
  }

  const toLayerX = layerWidth / Math.max(viewWidth, 1);
  const toLayerY = layerHeight / Math.max(viewHeight, 1);
  const minEdge = Math.min(viewWidth, viewHeight);
  const parallaxRange = (settings.parallax / 100) * minEdge * 0.08;
  const blobs = computeAuroraBlobs(settings, viewWidth, viewHeight);
  const coreAlpha = (settings.intensity / 100) * 0.85;
  const tau = Math.PI * 2;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.fillStyle = settings.backgroundColor;
  context.fillRect(0, 0, layerWidth, layerHeight);
  context.globalCompositeOperation = getBlobCompositeOperation(settings);

  for (const blob of blobs) {
    const centerX =
      blob.anchorX +
      blob.orbitRadius * Math.cos(tau * blob.orbitTurnsX * frame.phase + blob.orbitPhaseX) +
      pointer.x * parallaxRange * blob.depth;
    const centerY =
      blob.anchorY +
      blob.orbitRadius * Math.sin(tau * blob.orbitTurnsY * frame.phase + blob.orbitPhaseY) +
      pointer.y * parallaxRange * blob.depth;
    const layerCenterX = centerX * toLayerX;
    const layerCenterY = centerY * toLayerY;
    const layerRadius = Math.max(2, blob.radius * toLayerX);
    const gradient = context.createRadialGradient(
      layerCenterX,
      layerCenterY,
      0,
      layerCenterX,
      layerCenterY,
      layerRadius,
    );

    gradient.addColorStop(0, colorWithAlpha(blob.color, coreAlpha));
    gradient.addColorStop(0.55, colorWithAlpha(blob.color, coreAlpha * 0.35));
    gradient.addColorStop(1, colorWithAlpha(blob.color, 0));

    context.fillStyle = gradient;
    context.beginPath();
    context.arc(layerCenterX, layerCenterY, layerRadius, 0, tau);
    context.fill();
  }

  return true;
}

function paintGrain({
  context,
  frame,
  height,
  settings,
  width,
}: {
  context: CanvasRenderingContext2D;
  frame: AuroraFrame;
  height: number;
  settings: AuroraSettings;
  width: number;
}): void {
  const tile = getGrainTile();
  const pattern = context.createPattern(tile, "repeat");

  if (!pattern) {
    return;
  }

  let offsetX = 0;
  let offsetY = 0;

  if (settings.grainAnimated) {
    const random = mulberry32(Math.floor(frame.grainPhase) + 0x9e37);

    offsetX = Math.floor(random() * grainTileSize);
    offsetY = Math.floor(random() * grainTileSize);
  }

  context.save();
  context.globalAlpha = (settings.grainIntensity / 100) * 0.4;
  context.globalCompositeOperation = "overlay";
  context.translate(-offsetX, -offsetY);
  context.fillStyle = pattern;
  context.fillRect(0, 0, width + grainTileSize, height + grainTileSize);
  context.restore();
}

function paintVignette({
  context,
  height,
  settings,
  width,
}: {
  context: CanvasRenderingContext2D;
  height: number;
  settings: AuroraSettings;
  width: number;
}): void {
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.hypot(centerX, centerY);
  const gradient = context.createRadialGradient(
    centerX,
    centerY,
    outerRadius * 0.45,
    centerX,
    centerY,
    outerRadius,
  );
  const strength = (settings.vignetteStrength / 100) * 0.85;

  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, `rgba(0, 0, 0, ${strength})`);

  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
}

export function renderAurora({
  blobLayer,
  context,
  frame,
  height,
  pointer,
  settings,
  width,
}: {
  blobLayer?: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  frame: AuroraFrame;
  height: number;
  pointer: AuroraPointer;
  settings: AuroraSettings;
  width: number;
}): void {
  if (width <= 0 || height <= 0) {
    return;
  }

  const layer = blobLayer ?? document.createElement("canvas");
  const painted = paintBlobLayer({
    frame,
    layer,
    pointer,
    settings,
    viewHeight: height,
    viewWidth: width,
  });

  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = settings.backgroundColor;
  context.fillRect(0, 0, width, height);

  if (painted) {
    const blurPx = (settings.blur / 100) * Math.min(width, height) * 0.05;
    const pad = blurPx * 2;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    if (blurPx > 0.5) {
      context.filter = `blur(${blurPx.toFixed(2)}px)`;
    }

    context.drawImage(layer, -pad, -pad, width + pad * 2, height + pad * 2);
    context.filter = "none";
  }

  if (settings.grainEnabled && settings.grainIntensity > 0) {
    paintGrain({ context, frame, height, settings, width });
  }

  if (settings.vignette && settings.vignetteStrength > 0) {
    paintVignette({ context, height, settings, width });
  }

  context.restore();
}
