/**
 * Shares the live preview canvas element between the canvas renderer and the
 * sticky Export PNG panel action without routing DOM nodes through state.
 */

let liveCanvas: HTMLCanvasElement | null = null;

export function registerLiveFlowFieldCanvas(canvas: HTMLCanvasElement | null): void {
  liveCanvas = canvas;
}

export function getLiveFlowFieldCanvas(): HTMLCanvasElement | null {
  return liveCanvas;
}
