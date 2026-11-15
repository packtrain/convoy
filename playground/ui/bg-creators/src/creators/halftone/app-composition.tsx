import type {
  ToolcraftAppComposition,
  ToolcraftPanelActionHandler,
} from "@/toolcraft/runtime/react";

import { HalftoneCanvas } from "./halftone/halftone-canvas";
import { exportHalftoneImage } from "./halftone/halftone-export";
import { appSchema } from "./app-schema";

const handlePanelAction: ToolcraftPanelActionHandler = ({
  action,
  reportProgress,
  state,
}) => {
  if (action.role === "export-image") {
    return exportHalftoneImage(state, reportProgress);
  }
};

export const appComposition: ToolcraftAppComposition = {
  canvasContent: <HalftoneCanvas />,
  onPanelAction: handlePanelAction,
  renderDefaultCanvasMedia: false,
  schema: appSchema,
};
