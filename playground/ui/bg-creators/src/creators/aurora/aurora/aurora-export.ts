import { createToolcraftPngExportCanvas } from "@/toolcraft/runtime";
import type { ToolcraftState } from "@/toolcraft/runtime";

import {
  auroraNeutralPointer,
  auroraStillFrame,
  renderAurora,
} from "./aurora-renderer";
import { readAuroraSettings } from "./aurora-settings";

function readImageExportResolution(state: ToolcraftState): string {
  const value = state.values["export.image.resolution"];

  return typeof value === "string" && value.length > 0 ? value : "current";
}

export function exportAuroraPng(state: ToolcraftState): Promise<void> {
  const settings = readAuroraSettings(state.values);
  const exportCanvas = createToolcraftPngExportCanvas({
    background: settings.backgroundColor,
    render: ({ context, cssHeight, cssWidth }) => {
      renderAurora({
        context,
        frame: auroraStillFrame,
        height: cssHeight,
        pointer: auroraNeutralPointer,
        settings,
        width: cssWidth,
      });
    },
    resolution: readImageExportResolution(state),
    state,
  });

  return new Promise<void>((resolve, reject) => {
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Aurora PNG export produced no image data."));
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `aurora-${settings.seed}.png`;
      link.click();

      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
      resolve();
    }, "image/png");
  });
}
