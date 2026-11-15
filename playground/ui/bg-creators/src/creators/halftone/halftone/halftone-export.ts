import {
  createToolcraftPngExportCanvas,
  type ToolcraftState,
} from "@/toolcraft/runtime";

import { sampleHalftoneGrid } from "./halftone-grid";
import { renderHalftoneFrame } from "./halftone-render";
import { readHalftoneSettings } from "./halftone-settings";
import { findHalftoneSourceAsset, loadHalftoneImage } from "./halftone-source";

type HalftoneImageFormat = {
  extension: "jpg" | "png";
  mimeType: "image/jpeg" | "image/png";
};

function readImageFormat(state: ToolcraftState): HalftoneImageFormat {
  const value = state.values["export.image.format"];

  if (value === "jpg") {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }

  return { extension: "png", mimeType: "image/png" };
}

function readImageResolution(state: ToolcraftState): string {
  const value = state.values["export.image.resolution"];

  return typeof value === "string" ? value : "4k";
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("Halftone export could not encode the canvas."));
      },
      mimeType,
      mimeType === "image/jpeg" ? 0.92 : undefined,
    );
  });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Renders the halftone output at the selected export resolution and downloads
 * it. The grid is resampled once for the export pass at canvas CSS size; the
 * export helper handles resolution scaling and background inclusion.
 */
export async function exportHalftoneImage(
  state: ToolcraftState,
  reportProgress: (progress: number) => void,
): Promise<void> {
  const settings = readHalftoneSettings(state.values);
  const format = readImageFormat(state);
  const sourceAsset = findHalftoneSourceAsset(state);

  reportProgress(0.1);

  const image = sourceAsset ? await loadHalftoneImage(sourceAsset.dataUrl) : null;
  const grid = image
    ? sampleHalftoneGrid({
        angleDeg: settings.angleDeg,
        height: state.canvas.size.height,
        image,
        spacing: settings.spacing,
        transform: sourceAsset?.transform,
        width: state.canvas.size.width,
      })
    : null;

  reportProgress(0.4);

  // JPEG has no alpha channel; always include the background there so users
  // do not get an unexpected black backdrop.
  const includeBackground =
    format.mimeType === "image/jpeg" ? true : settings.includeBackground;
  const exportCanvas = createToolcraftPngExportCanvas({
    background: settings.background,
    includeBackground,
    render: ({ context }) => {
      if (!grid) {
        return;
      }

      renderHalftoneFrame({
        context,
        grid,
        pointer: null,
        settings,
        timeSeconds: 0,
      });
    },
    resolution: readImageResolution(state),
    state,
  });

  reportProgress(0.7);

  const blob = await canvasToBlob(exportCanvas, format.mimeType);

  downloadBlob(blob, `halftone.${format.extension}`);
  reportProgress(1);
}
