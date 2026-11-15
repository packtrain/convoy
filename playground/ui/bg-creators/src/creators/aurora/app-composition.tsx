import type { ToolcraftAppComposition } from "@/toolcraft/runtime/react";

import {
  appSchema,
  exportPngActionValue,
  randomizeSeedActionValue,
} from "./app-schema";
import { AuroraCanvas } from "./aurora/aurora-canvas";
import { exportAuroraPng } from "./aurora/aurora-export";
import { auroraTargets, createRandomAuroraSeed } from "./aurora/aurora-settings";

export const appComposition: ToolcraftAppComposition = {
  canvasContent: <AuroraCanvas />,
  onPanelAction: ({ action, dispatch, state }) => {
    if (action.value === randomizeSeedActionValue) {
      dispatch({
        label: "Randomize seed",
        target: auroraTargets.seed,
        type: "controls.setValue",
        value: createRandomAuroraSeed(),
      });
      return;
    }

    if (action.value === exportPngActionValue) {
      return exportAuroraPng(state);
    }
  },
  renderDefaultCanvasMedia: false,
  schema: appSchema,
};
