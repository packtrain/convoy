import * as React from "react";

import { shouldIncludeToolcraftPreviewBackground } from "@/toolcraft/runtime";
import { useToolcraft } from "@/toolcraft/runtime/react";

import { drawAscii, type AsciiPointer } from "./ascii-draw";
import { computeAsciiGridLayout, sampleAsciiGrid, type AsciiGrid } from "./ascii-grid";
import { readAsciiSettings, type AsciiSettings } from "./ascii-settings";
import { getAsciiSourceAsset, loadAsciiSourceImage } from "./ascii-source";

type AsciiFrameProps = {
  background: string;
  grid: AsciiGrid | null;
  height: number;
  includeBackground: boolean;
  renderScale: number;
  settings: AsciiSettings;
  width: number;
};

function readRenderScale(values: Record<string, unknown>, fallback: number): number {
  const value = values["canvas.renderScale"];
  const scale = typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return Math.min(4, Math.max(1, scale));
}

export function AsciiArtCanvas(): React.JSX.Element {
  const { state } = useToolcraft();
  const settings = React.useMemo(() => readAsciiSettings(state.values), [state.values]);
  const { height, width } = state.canvas.size;
  const renderScale = readRenderScale(
    state.values,
    state.schema.canvas.renderScale.defaultValue,
  );
  const includeBackground = shouldIncludeToolcraftPreviewBackground({ state });
  const sourceAsset = getAsciiSourceAsset(state);
  const sourceDataUrl = sourceAsset?.dataUrl ?? null;
  const rotationDeg = sourceAsset?.transform?.rotationDeg ?? 0;
  const flipHorizontal = sourceAsset?.transform?.flipHorizontal ?? false;
  const flipVertical = sourceAsset?.transform?.flipVertical ?? false;
  const [image, setImage] = React.useState<HTMLImageElement | null>(null);

  React.useEffect(() => {
    if (!sourceDataUrl) {
      setImage(null);

      return;
    }

    let cancelled = false;

    void loadAsciiSourceImage(sourceDataUrl).then((loaded) => {
      if (!cancelled) {
        setImage(loaded);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sourceDataUrl]);

  const { brightness, contrast, gamma, invert } = settings.tone;
  const layout = React.useMemo(
    () => computeAsciiGridLayout({ cellSize: settings.cellSize, height, width }),
    [settings.cellSize, height, width],
  );
  const grid = React.useMemo(() => {
    if (!image) {
      return null;
    }

    return sampleAsciiGrid({
      image,
      layout,
      tone: { brightness, contrast, gamma, invert },
      transform: { flipHorizontal, flipVertical, rotationDeg },
    });
  }, [
    brightness,
    contrast,
    flipHorizontal,
    flipVertical,
    gamma,
    image,
    invert,
    layout,
    rotationDeg,
  ]);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const pointerRef = React.useRef<AsciiPointer | null>(null);
  const dirtyRef = React.useRef(true);
  const frameRef = React.useRef<AsciiFrameProps>({
    background: settings.background,
    grid,
    height,
    includeBackground,
    renderScale,
    settings,
    width,
  });

  frameRef.current = {
    background: settings.background,
    grid,
    height,
    includeBackground,
    renderScale,
    settings,
    width,
  };

  React.useEffect(() => {
    dirtyRef.current = true;
  });

  React.useEffect(() => {
    let animationFrame = 0;

    const renderFrame = (now: number): void => {
      animationFrame = requestAnimationFrame(renderFrame);

      const canvas = canvasRef.current;
      const frame = frameRef.current;

      if (!canvas) {
        return;
      }

      const animating = frame.settings.animate && frame.grid !== null;

      if (!animating && !dirtyRef.current) {
        return;
      }

      dirtyRef.current = false;

      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      const backingWidth = Math.max(1, Math.round(frame.width * frame.renderScale));
      const backingHeight = Math.max(1, Math.round(frame.height * frame.renderScale));

      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }

      context.setTransform(frame.renderScale, 0, 0, frame.renderScale, 0, 0);
      context.clearRect(0, 0, frame.width, frame.height);

      if (frame.includeBackground) {
        context.fillStyle = frame.background;
        context.fillRect(0, 0, frame.width, frame.height);
      }

      if (frame.grid) {
        drawAscii({
          ctx: context,
          grid: frame.grid,
          height: frame.height,
          pointer: pointerRef.current,
          settings: frame.settings,
          timeSeconds: now / 1000,
          width: frame.width,
        });
      }
    };

    animationFrame = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  const updatePointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    pointerRef.current = {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
    dirtyRef.current = true;
  };

  const clearPointer = (): void => {
    pointerRef.current = null;
    dirtyRef.current = true;
  };

  return (
    <div
      data-testid="ascii-art-output"
      onPointerLeave={clearPointer}
      onPointerMove={updatePointer}
      style={{ inset: 0, position: "absolute" }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", height: "100%", width: "100%" }}
      />
    </div>
  );
}
