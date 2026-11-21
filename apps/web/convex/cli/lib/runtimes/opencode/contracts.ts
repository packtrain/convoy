import type { CliCatalogModel } from "../shared/validators";

export const OPENCODE_DEFAULT_MODEL_SLOT = "default";

export type OpencodeAvailableCli = {
  type: "opencode";
  version: string;
  /** Connected-provider models; `slug` is `providerID/modelID`. */
  models?: Array<CliCatalogModel>;
  /** The machine's configured default model slug, when known. */
  defaultModel?: string;
};
