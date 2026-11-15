import type { ToolcraftAppComposition } from "@/toolcraft/runtime/react";

import { AsciiArtCanvas } from "./ascii/ascii-canvas";
import { handleAsciiPanelAction } from "./ascii/ascii-export";
import { appSchema } from "./app-schema";

export const appComposition: ToolcraftAppComposition = {
  canvasContent: <AsciiArtCanvas />,
  onPanelAction: handleAsciiPanelAction,
  renderDefaultCanvasMedia: false,
  schema: appSchema,
};
