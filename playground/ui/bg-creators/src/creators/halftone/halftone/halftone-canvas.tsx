import * as React from "react";

import type { ToolcraftState } from "@/toolcraft/runtime";
import { useToolcraft } from "@/toolcraft/runtime/react";

import { sampleHalftoneGrid, type HalftoneGrid } from "./halftone-grid";
import { renderHalftoneFrame, type HalftonePointer } from "./halftone-render";
import { readHalftoneSettings } from "./halftone-settings";
import { findHalftoneSourceAsset, loadHalftoneImage } from "./halftone-source";

function readRenderScaleValue(state: ToolcraftState): number {
  const value = state.values["canvas.renderScale"];

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  return state.schema.canvas.renderScale.defaultValue;
}

/**
 * Product renderer: draws the animated halftone dot matrix into a Canvas 2D
 * surface sized to the runtime canvas. The sampled grid is precomputed
 * offscreen when image/spacing/angle/size change; the per-frame loop only
 * recomputes dot radii and fills.
 */
export function HalftoneCanvas(): React.JSX.Element {
  const { state } = useToolcraft();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const gridRef = React.useRef<HalftoneGrid | null>(null);
  const pointerRef = React.useRef<HalftonePointer | null>(null);
  const dirtyRef = React.useRef(true);
  const [image, setImage] = React.useState<HTMLImageElement | null>(null);
  const settings = readHalftoneSettings(state.values);
  const { height, width } = state.canvas.size;
  const renderScale = readRenderScaleValue(state);
  const sourceAsset = findHalftoneSourceAsset(state);
  const sourceDataUrl = sourceAsset?.dataUrl ?? null;
  const sourceTransform = sourceAsset?.transform;
  const sourceTransformKey = [
    sourceTransform?.rotationDeg ?? 0,
    sourceTransform?.flipHorizontal ? 1 : 0,
    sourceTransform?.flipVertical ? 1 : 0,
  ].join(":");

  React.useEffect(() => {
    if (!sourceDataUrl) {
      setImage(null);
      return;
    }

    let cancelled = false;

    loadHalftoneImage(sourceDataUrl)
      .then((loaded) => {
        if (!cancelled) {
          setImage(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImage(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourceDataUrl]);

  React.useEffect(() => {
    gridRef.current = image
      ? sampleHalftoneGrid({
          angleDeg: settings.angleDeg,
          height,
          image,
          spacing: settings.spacing,
          transform: sourceTransform,
          width,
        })
      : null;
    dirtyRef.current = true;
    // sourceTransformKey stands in for the transform object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, image, settings.angleDeg, settings.spacing, sourceTransformKey, width]);

  const frameRef = React.useRef({ height, renderScale, settings, width });

  frameRef.current = { height, renderScale, settings, width };
  // Any runtime state change may affect the drawn output; request one redraw.
  dirtyRef.current = true;

  React.useEffect(() => {
    let frameId = 0;
    let lastTimestamp = performance.now();
    let animationSeconds = 0;

    const drawFrame = (now: number): void => {
      const frame = frameRef.current;
      const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastTimestamp) / 1000));

      lastTimestamp = now;

      if (frame.settings.motionEnabled) {
        animationSeconds += deltaSeconds * frame.settings.motionSpeed;
      }

      const canvas = canvasRef.current;
      const shouldDraw = frame.settings.motionEnabled || dirtyRef.current;

      if (canvas && shouldDraw) {
        const backingWidth = Math.max(1, Math.round(frame.width * frame.renderScale));
        const backingHeight = Math.max(1, Math.round(frame.height * frame.renderScale));

        if (canvas.width !== backingWidth) {
          canvas.width = backingWidth;
        }

        if (canvas.height !== backingHeight) {
          canvas.height = backingHeight;
        }

        const context = canvas.getContext("2d");

        if (context) {
          context.setTransform(frame.renderScale, 0, 0, frame.renderScale, 0, 0);
          context.clearRect(0, 0, frame.width, frame.height);

          if (frame.settings.includeBackground) {
            context.fillStyle = frame.settings.background;
            context.fillRect(0, 0, frame.width, frame.height);
          }

          const grid = gridRef.current;

          if (grid) {
            renderHalftoneFrame({
              context,
              grid,
              pointer: pointerRef.current,
              settings: frame.settings,
              timeSeconds: animationSeconds,
            });
          }
        }

        dirtyRef.current = false;
      }

      frameId = requestAnimationFrame(drawFrame);
    };

    frameId = requestAnimationFrame(drawFrame);

    return () => cancelAnimationFrame(frameId);
  }, []);

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width < 1 || rect.height < 1) {
      return;
    }

    const frame = frameRef.current;

    pointerRef.current = {
      x: ((event.clientX - rect.left) / rect.width) * frame.width,
      y: ((event.clientY - rect.top) / rect.height) * frame.height,
    };
    dirtyRef.current = true;
  };

  const handlePointerLeave = (): void => {
    pointerRef.current = null;
    dirtyRef.current = true;
  };

  return (
    <canvas
      data-halftone-canvas=""
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      ref={canvasRef}
      style={{ display: "block", height: "100%", width: "100%" }}
    />
  );
}
