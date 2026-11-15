import { createToolcraftPngExportCanvas } from "@/toolcraft/runtime";
import type { ToolcraftState } from "@/toolcraft/runtime";

import { readFlowFieldSettings } from "./flow-field-settings";
import { getLiveFlowFieldCanvas } from "./live-canvas-registry";

/**
 * Exports the current live Flow Field frame as a PNG download using the
 * standard Toolcraft export canvas helper (retina-scaled from canvas size).
 */
export async function exportFlowFieldPng(state: ToolcraftState): Promise<void> {
  const liveCanvas = getLiveFlowFieldCanvas();

  if (!liveCanvas || liveCanvas.width === 0 || liveCanvas.height === 0) {
    return;
  }

  const settings = readFlowFieldSettings(state.values);
  const exportCanvas = createToolcraftPngExportCanvas({
    background: settings.backgroundColor,
    render: ({ context, cssHeight, cssWidth }) => {
      context.drawImage(liveCanvas, 0, 0, cssWidth, cssHeight);
    },
    state,
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    exportCanvas.toBlob(resolve, "image/png"),
  );

  if (!blob) {
    return;
  }

  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "flow-field.png";
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
