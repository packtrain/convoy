import type { ToolcraftAppComposition } from "@/toolcraft/runtime/react";

import { exportFlowFieldPng } from "./flow-field/export-flow-field-png";
import { FlowFieldCanvas } from "./flow-field/flow-field-canvas";
import { appSchema } from "./app-schema";

export const appComposition: ToolcraftAppComposition = {
  canvasContent: <FlowFieldCanvas />,
  onPanelAction: async ({ action, state }) => {
    if (action.value === "export-png") {
      await exportFlowFieldPng(state);
    }
  },
  renderDefaultCanvasMedia: false,
  schema: appSchema,
};
