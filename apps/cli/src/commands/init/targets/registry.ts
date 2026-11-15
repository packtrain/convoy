import type { InitTarget } from "../types.js";
import { claudeDriver } from "./claude.js";
import { codexDriver } from "./codex.js";
import { opencodeDriver } from "./opencode.js";
import type { InitTargetDriver } from "./driver.js";

const DRIVER_REGISTRY: Record<InitTarget, InitTargetDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  opencode: opencodeDriver,
};

export function getInitDriver(target: InitTarget): InitTargetDriver {
  return DRIVER_REGISTRY[target];
}

export function getInitDrivers(targets: ReadonlyArray<InitTarget>): InitTargetDriver[] {
  return targets.map((target) => getInitDriver(target));
}
