export const OPENCODE_DEFAULT_MODEL_SLOT = "default";

/**
 * A model advertised by a connected OpenCode CLI. OpenCode models depend on
 * each machine's connected providers, so the catalog is dynamic: the CLI
 * reports `provider.list()` results (connected providers only) and the
 * backend offers them as options. `slug` is `"providerID/modelID"`.
 */
export type OpencodeAdvertisedModel = {
  slug: string;
  name: string;
  /** Variant keys (provider-specific reasoning effort) for a future picker. */
  variants?: Array<string>;
};

export type OpencodeAvailableCli = {
  type: "opencode";
  version: string;
  models?: Array<OpencodeAdvertisedModel>;
  /** The machine's configured default model slug, when known. */
  defaultModel?: string;
};
