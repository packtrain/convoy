import {
  createToolcraftPngExportCanvas,
  shouldIncludeToolcraftPreviewBackground,
  type ToolcraftState,
} from "@/toolcraft/runtime";
import type { ToolcraftPanelActionHandler } from "@/toolcraft/runtime/react";

import { drawAscii } from "./ascii-draw";
import { computeAsciiGridLayout, sampleAsciiGrid } from "./ascii-grid";
import { readAsciiSettings } from "./ascii-settings";
import { getAsciiSourceAsset, loadAsciiSourceImage } from "./ascii-source";

type AsciiExportFormat = {
  extension: string;
  mimeType: string;
};

function readExportFormat(state: ToolcraftState): AsciiExportFormat {
  const format = state.values["export.image.format"];

  if (format === "jpg") {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }

  return { extension: "png", mimeType: "image/png" };
}

function readExportResolution(state: ToolcraftState): string {
  const resolution = state.values["export.image.resolution"];

  return typeof resolution === "string" ? resolution : "4k";
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, 0.95);
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

async function exportAsciiImage(state: ToolcraftState): Promise<void> {
  const sourceAsset = getAsciiSourceAsset(state);

  if (!sourceAsset) {
    return;
  }

  const image = await loadAsciiSourceImage(sourceAsset.dataUrl);

  if (!image) {
    return;
  }

  const settings = readAsciiSettings(state.values);
  const layout = computeAsciiGridLayout({
    cellSize: settings.cellSize,
    height: state.canvas.size.height,
    width: state.canvas.size.width,
  });
  const grid = sampleAsciiGrid({
    image,
    layout,
    tone: settings.tone,
    transform: sourceAsset.transform,
  });

  if (!grid) {
    return;
  }

  const format = readExportFormat(state);
  const includeBackground =
    format.mimeType === "image/jpeg" ||
    shouldIncludeToolcraftPreviewBackground({ state });
  const exportCanvas = createToolcraftPngExportCanvas({
    background: settings.background,
    includeBackground,
    render: ({ context, cssHeight, cssWidth }) => {
      drawAscii({
        ctx: context,
        grid,
        height: cssHeight,
        pointer: null,
        settings,
        timeSeconds: 0,
        width: cssWidth,
      });
    },
    resolution: readExportResolution(state),
    state,
  });
  const blob = await canvasToBlob(exportCanvas, format.mimeType);

  if (blob) {
    downloadBlob(blob, `ascii-art.${format.extension}`);
  }
}

export const handleAsciiPanelAction: ToolcraftPanelActionHandler = ({ action, state }) => {
  if (action.value !== "export-image") {
    return;
  }

  return exportAsciiImage(state);
};
