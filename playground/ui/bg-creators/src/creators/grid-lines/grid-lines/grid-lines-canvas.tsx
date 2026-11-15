import * as React from "react";

import { useToolcraft } from "@/toolcraft/runtime/react";

import {
  drawGridLayer,
  drawPulses,
  drawScanline,
  rgbaFromHex,
} from "./grid-lines-render";
import {
  defaultGridLinesSettings,
  readGridLinesSettings,
  type GridLinesSettings,
} from "./grid-lines-settings";

type CanvasSizePx = {
  height: number;
  width: number;
};

type MouseState = {
  inside: boolean;
  x: number;
  y: number;
};

type FrameState = {
  accentLayer: HTMLCanvasElement | null;
  accentLayerKey: string;
  baseLayer: HTMLCanvasElement | null;
  baseLayerKey: string;
  dirty: boolean;
  lastTimestamp: number | null;
  mouse: MouseState;
  pixelScale: number;
  scratch: HTMLCanvasElement | null;
  settings: GridLinesSettings;
  size: CanvasSizePx;
  virtualTime: number;
};

function gridLayerCacheKey(
  size: CanvasSizePx,
  pixelScale: number,
  settings: GridLinesSettings,
  color: string,
  wobbleActive: boolean,
): string {
  return [
    size.width,
    size.height,
    pixelScale,
    settings.cellSize,
    settings.lineThickness,
    color,
    settings.lineOpacity,
    settings.crosshairSize,
    settings.crosshairOpacity,
    settings.crosshairEvery,
    wobbleActive,
  ].join("|");
}

function ensureLayer(
  layer: HTMLCanvasElement | null,
  backingWidth: number,
  backingHeight: number,
): HTMLCanvasElement {
  const canvas = layer ?? document.createElement("canvas");

  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }

  return canvas;
}

function drawMouseGlow(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  backingWidth: number,
  backingHeight: number,
): void {
  const { mouse, pixelScale, settings } = frame;
  const accentLayer = frame.accentLayer;
  const strength = Math.min(1, Math.max(0, settings.glowStrength / 100));

  if (!accentLayer || strength <= 0) {
    return;
  }

  const radius = Math.max(8, settings.glowRadius) * pixelScale;
  const glowSize = Math.ceil(radius * 2);
  const centerX = mouse.x * pixelScale;
  const centerY = mouse.y * pixelScale;
  const originX = centerX - radius;
  const originY = centerY - radius;
  const sourceX = Math.max(0, originX);
  const sourceY = Math.max(0, originY);
  const sourceRight = Math.min(backingWidth, originX + glowSize);
  const sourceBottom = Math.min(backingHeight, originY + glowSize);
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }

  const scratch = ensureLayer(frame.scratch, glowSize, glowSize);
  frame.scratch = scratch;
  const scratchCtx = scratch.getContext("2d");

  if (!scratchCtx) {
    return;
  }

  scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchCtx.globalCompositeOperation = "source-over";
  scratchCtx.clearRect(0, 0, glowSize, glowSize);
  scratchCtx.drawImage(
    accentLayer,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    sourceX - originX,
    sourceY - originY,
    sourceWidth,
    sourceHeight,
  );

  const mask = scratchCtx.createRadialGradient(
    radius,
    radius,
    0,
    radius,
    radius,
    radius,
  );
  mask.addColorStop(0, `rgba(255, 255, 255, ${strength})`);
  mask.addColorStop(0.65, `rgba(255, 255, 255, ${strength * 0.45})`);
  mask.addColorStop(1, "rgba(255, 255, 255, 0)");
  scratchCtx.globalCompositeOperation = "destination-in";
  scratchCtx.fillStyle = mask;
  scratchCtx.fillRect(0, 0, glowSize, glowSize);
  scratchCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(scratch, originX, originY);
  ctx.restore();
}

function renderFrame(canvas: HTMLCanvasElement, frame: FrameState): void {
  const { pixelScale, settings, size } = frame;
  const backingWidth = Math.max(1, Math.round(size.width * pixelScale));
  const backingHeight = Math.max(1, Math.round(size.height * pixelScale));

  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return;
  }

  const time = frame.virtualTime;
  const wobbleActive = settings.wobble && settings.animate;

  const baseKey = gridLayerCacheKey(
    size,
    pixelScale,
    settings,
    settings.lineColor,
    wobbleActive,
  );
  const baseLayer = ensureLayer(frame.baseLayer, backingWidth, backingHeight);
  frame.baseLayer = baseLayer;

  if (frame.baseLayerKey !== baseKey || wobbleActive) {
    const layerCtx = baseLayer.getContext("2d");

    if (layerCtx) {
      layerCtx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
      drawGridLayer(layerCtx, {
        crosshairAlpha: settings.crosshairOpacity / 100,
        height: size.height,
        lineAlpha: settings.lineOpacity / 100,
        lineColor: settings.lineColor,
        settings,
        time,
        width: size.width,
        wobble: wobbleActive,
      });
    }

    frame.baseLayerKey = baseKey;
  }

  const glowActive = frame.mouse.inside && settings.glowStrength > 0;

  if (glowActive) {
    const accentKey = gridLayerCacheKey(
      size,
      pixelScale,
      settings,
      settings.accentColor,
      wobbleActive,
    );
    const accentLayer = ensureLayer(
      frame.accentLayer,
      backingWidth,
      backingHeight,
    );
    frame.accentLayer = accentLayer;

    if (frame.accentLayerKey !== accentKey || wobbleActive) {
      const layerCtx = accentLayer.getContext("2d");

      if (layerCtx) {
        layerCtx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
        drawGridLayer(layerCtx, {
          crosshairAlpha: 1,
          height: size.height,
          lineAlpha: 0.9,
          lineColor: settings.accentColor,
          settings,
          time,
          width: size.width,
          wobble: wobbleActive,
        });
      }

      frame.accentLayerKey = accentKey;
    }
  }

  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  ctx.fillStyle = rgbaFromHex(settings.backgroundColor, 1);
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(baseLayer, 0, 0);

  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  drawPulses(ctx, {
    height: size.height,
    settings,
    time,
    width: size.width,
  });
  drawScanline(ctx, {
    height: size.height,
    settings,
    time,
    width: size.width,
  });

  if (glowActive) {
    drawMouseGlow(ctx, frame, backingWidth, backingHeight);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function GridLinesCanvas(): React.JSX.Element {
  const { state } = useToolcraft();
  const { size } = state.canvas;
  const renderScaleValue = state.values["canvas.renderScale"];
  const pixelScale =
    typeof renderScaleValue === "number" && Number.isFinite(renderScaleValue)
      ? renderScaleValue
      : state.schema.canvas.renderScale.defaultValue;
  const settings = React.useMemo(
    () => readGridLinesSettings(state.values),
    [state.values],
  );

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const frameStateRef = React.useRef<FrameState>({
    accentLayer: null,
    accentLayerKey: "",
    baseLayer: null,
    baseLayerKey: "",
    dirty: true,
    lastTimestamp: null,
    mouse: { inside: false, x: 0, y: 0 },
    pixelScale,
    scratch: null,
    settings: defaultGridLinesSettings,
    size: { height: size.height, width: size.width },
    virtualTime: 0,
  });

  React.useEffect(() => {
    const frame = frameStateRef.current;
    frame.settings = settings;
    frame.size = { height: size.height, width: size.width };
    frame.pixelScale = pixelScale;
    frame.dirty = true;
  }, [pixelScale, settings, size.height, size.width]);

  React.useEffect(() => {
    let rafId = 0;

    const step = (timestamp: number): void => {
      rafId = requestAnimationFrame(step);

      const frame = frameStateRef.current;
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      const deltaSeconds =
        frame.lastTimestamp === null
          ? 0
          : Math.min(0.1, (timestamp - frame.lastTimestamp) / 1000);
      frame.lastTimestamp = timestamp;

      if (frame.settings.animate) {
        frame.virtualTime += (deltaSeconds * frame.settings.speed) / 100;
      } else if (!frame.dirty) {
        return;
      }

      frame.dirty = false;
      renderFrame(canvas, frame);
    };

    rafId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, []);

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      const rect = canvas.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const frame = frameStateRef.current;
      frame.mouse = {
        inside: true,
        x: ((event.clientX - rect.left) / rect.width) * frame.size.width,
        y: ((event.clientY - rect.top) / rect.height) * frame.size.height,
      };
      frame.dirty = true;
    },
    [],
  );

  const handlePointerLeave = React.useCallback((): void => {
    const frame = frameStateRef.current;
    frame.mouse = { ...frame.mouse, inside: false };
    frame.dirty = true;
  }, []);

  return (
    <canvas
      aria-label="Grid Lines background preview"
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      ref={canvasRef}
      style={{ display: "block", height: "100%", width: "100%" }}
    />
  );
}
