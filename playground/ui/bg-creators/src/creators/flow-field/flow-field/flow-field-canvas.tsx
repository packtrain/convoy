"use client";

import * as React from "react";

import { useToolcraft } from "@/toolcraft/runtime/react";

import { FlowFieldSimulation, type FlowFieldPointer } from "./flow-field-simulation";
import { readFlowFieldSettings, type FlowFieldSettings } from "./flow-field-settings";
import { registerLiveFlowFieldCanvas } from "./live-canvas-registry";

const MAX_PIXEL_RATIO = 2;

/**
 * Product output: a noise-driven particle-stream background rendered with
 * Canvas 2D inside the Toolcraft canvas. A single rAF loop advances the
 * typed-array simulation; schema state is read through the runtime context.
 */
export function FlowFieldCanvas(): React.JSX.Element {
  const { state } = useToolcraft();
  const { height, width } = state.canvas.size;
  const settings = readFlowFieldSettings(state.values);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const simulationRef = React.useRef<FlowFieldSimulation | null>(null);
  const settingsRef = React.useRef<FlowFieldSettings>(settings);
  const pointerRef = React.useRef<FlowFieldPointer>({ active: false, x: 0, y: 0 });
  const paintedBackgroundRef = React.useRef<string | null>(null);

  settingsRef.current = settings;

  const getContext = (): CanvasRenderingContext2D | null =>
    canvasRef.current?.getContext("2d") ?? null;

  // Keep the backing store and simulation bounds in sync with canvas size.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = getContext();

    if (!canvas || !context) {
      return;
    }

    const pixelRatio = Math.min(
      MAX_PIXEL_RATIO,
      Math.max(1, globalThis.devicePixelRatio || 1),
    );

    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    if (!simulationRef.current) {
      simulationRef.current = new FlowFieldSimulation({
        count: settingsRef.current.particleCount,
        height,
        width,
      });
    } else {
      simulationRef.current.resize({ height, width });
    }

    simulationRef.current.paintBackground(context, settingsRef.current);
    paintedBackgroundRef.current = settingsRef.current.backgroundColor;
  }, [height, width]);

  // Reallocate particle storage when the requested count changes.
  React.useEffect(() => {
    simulationRef.current?.setCount(settings.particleCount);
  }, [settings.particleCount]);

  // Repaint opaquely when the background color changes (trails carry the old tint).
  React.useEffect(() => {
    const context = getContext();
    const simulation = simulationRef.current;

    if (!context || !simulation) {
      return;
    }

    if (paintedBackgroundRef.current !== settings.backgroundColor) {
      simulation.paintBackground(context, settingsRef.current);
      paintedBackgroundRef.current = settings.backgroundColor;
    }
  }, [settings.backgroundColor]);

  // Single rAF loop; paused entirely when animation is off.
  React.useEffect(() => {
    if (!settings.motionAnimate) {
      return;
    }

    let frameId = 0;
    let lastTimestamp: number | null = null;

    const frame = (timestamp: number): void => {
      const context = getContext();
      const simulation = simulationRef.current;

      if (context && simulation) {
        const elapsedMs = lastTimestamp === null ? 16.67 : timestamp - lastTimestamp;
        const dtFrames = Math.min(3, elapsedMs / 16.67);

        simulation.step(settingsRef.current, pointerRef.current, dtFrames);
        simulation.draw(context, settingsRef.current);
      }

      lastTimestamp = timestamp;
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(frameId);
  }, [settings.motionAnimate]);

  // Expose the live canvas to the sticky Export PNG action.
  React.useEffect(() => {
    registerLiveFlowFieldCanvas(canvasRef.current);

    return () => registerLiveFlowFieldCanvas(null);
  }, []);

  const updatePointer = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    pointerRef.current = {
      active: true,
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  };

  const clearPointer = (): void => {
    pointerRef.current = { ...pointerRef.current, active: false };
  };

  return (
    <canvas
      data-testid="flow-field-canvas"
      onPointerLeave={clearPointer}
      onPointerMove={updatePointer}
      ref={canvasRef}
      style={{
        display: "block",
        height,
        left: 0,
        position: "absolute",
        top: 0,
        width,
      }}
    />
  );
}
