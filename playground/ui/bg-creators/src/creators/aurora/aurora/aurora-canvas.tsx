import * as React from "react";

import { useToolcraft } from "@/toolcraft/runtime/react";

import {
  auroraNeutralPointer,
  renderAurora,
  type AuroraPointer,
} from "./aurora-renderer";
import { readAuroraSettings, type AuroraSettings } from "./aurora-settings";

const fullSpeedLoopSeconds = 24;
const maxFrameDeltaSeconds = 0.1;
const pointerSmoothing = 0.12;
const pointerSettleThreshold = 0.0005;

type AuroraViewport = {
  height: number;
  pixelRatio: number;
  width: number;
};

function readRenderScale(
  values: Record<string, unknown>,
  fallback: number,
): number {
  const value = values["canvas.renderScale"];

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(2, Math.max(0.25, value));
  }

  return Math.min(2, Math.max(0.25, fallback));
}

export function AuroraCanvas(): React.JSX.Element {
  const { state } = useToolcraft();
  const settings = React.useMemo(
    () => readAuroraSettings(state.values),
    [state.values],
  );
  const renderScale = readRenderScale(
    state.values,
    state.schema.canvas.renderScale.enabled
      ? state.schema.canvas.renderScale.defaultValue
      : 1.5,
  );
  const { height, width } = state.canvas.size;

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const blobLayerRef = React.useRef<HTMLCanvasElement | null>(null);
  const settingsRef = React.useRef<AuroraSettings>(settings);
  const viewportRef = React.useRef<AuroraViewport>({
    height,
    pixelRatio: renderScale,
    width,
  });
  const phaseRef = React.useRef(0);
  const grainPhaseRef = React.useRef(0);
  const rawPointerRef = React.useRef<AuroraPointer>({ ...auroraNeutralPointer });
  const smoothPointerRef = React.useRef<AuroraPointer>({
    ...auroraNeutralPointer,
  });
  const needsRenderRef = React.useRef(true);

  settingsRef.current = settings;
  viewportRef.current = { height, pixelRatio: renderScale, width };

  React.useEffect(() => {
    needsRenderRef.current = true;
  }, [settings, height, width, renderScale]);

  React.useEffect(() => {
    function handlePointerMove(event: PointerEvent): void {
      const canvas = canvasRef.current;

      if (!canvas || settingsRef.current.parallax <= 0) {
        return;
      }

      const rect = canvas.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const normalizedX =
        ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const normalizedY =
        ((event.clientY - rect.top) / rect.height) * 2 - 1;

      rawPointerRef.current = {
        x: Math.min(1.5, Math.max(-1.5, normalizedX)),
        y: Math.min(1.5, Math.max(-1.5, normalizedY)),
      };
    }

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  React.useEffect(() => {
    let animationFrame = 0;
    let lastTime = performance.now();

    function drawFrame(): void {
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      const viewport = viewportRef.current;
      const pixelWidth = Math.max(
        1,
        Math.round(viewport.width * viewport.pixelRatio),
      );
      const pixelHeight = Math.max(
        1,
        Math.round(viewport.height * viewport.pixelRatio),
      );

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      if (!blobLayerRef.current) {
        blobLayerRef.current = document.createElement("canvas");
      }

      context.setTransform(
        pixelWidth / Math.max(viewport.width, 1),
        0,
        0,
        pixelHeight / Math.max(viewport.height, 1),
        0,
        0,
      );
      renderAurora({
        blobLayer: blobLayerRef.current,
        context,
        frame: {
          grainPhase: grainPhaseRef.current,
          phase: phaseRef.current,
        },
        height: viewport.height,
        pointer: smoothPointerRef.current,
        settings: settingsRef.current,
        width: viewport.width,
      });
    }

    function tick(now: number): void {
      const deltaSeconds = Math.min(
        (now - lastTime) / 1000,
        maxFrameDeltaSeconds,
      );

      lastTime = now;

      const activeSettings = settingsRef.current;

      if (activeSettings.animate && activeSettings.speed > 0) {
        const phaseStep =
          (deltaSeconds * (activeSettings.speed / 100)) / fullSpeedLoopSeconds;

        phaseRef.current = (phaseRef.current + phaseStep) % 1;
        needsRenderRef.current = true;
      }

      if (activeSettings.parallax > 0) {
        const target = rawPointerRef.current;
        const current = smoothPointerRef.current;
        const deltaX = target.x - current.x;
        const deltaY = target.y - current.y;

        if (
          Math.abs(deltaX) > pointerSettleThreshold ||
          Math.abs(deltaY) > pointerSettleThreshold
        ) {
          smoothPointerRef.current = {
            x: current.x + deltaX * pointerSmoothing,
            y: current.y + deltaY * pointerSmoothing,
          };
          needsRenderRef.current = true;
        }
      }

      if (activeSettings.grainEnabled && activeSettings.grainAnimated) {
        grainPhaseRef.current += 1;
        needsRenderRef.current = true;
      }

      if (needsRenderRef.current) {
        needsRenderRef.current = false;
        drawFrame();
      }

      animationFrame = requestAnimationFrame(tick);
    }

    animationFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <canvas
      aria-hidden="true"
      data-testid="aurora-canvas"
      ref={canvasRef}
      style={{ display: "block", height: "100%", width: "100%" }}
    />
  );
}
