import type { ToolcraftAppComposition } from "@/toolcraft/runtime/react";

import { appSchema } from "./app-schema";
import { GridLinesCanvas } from "./grid-lines/grid-lines-canvas";

export const appComposition: ToolcraftAppComposition = {
  canvasContent: <GridLinesCanvas />,
  renderDefaultCanvasMedia: false,
  schema: appSchema,
};
