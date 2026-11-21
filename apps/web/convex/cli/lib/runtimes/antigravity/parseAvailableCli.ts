import type { ParseResult } from "../contracts";
import type { CliRuntimeAvailableCli } from "../registry";
import { success } from "../shared/parsing";
import { toCliCatalogModels } from "../shared/validators";

/** Fail-soft and capped like OpenCode's: a bad model is skipped, never the registration. */
export function parseAntigravityAvailableCli(
  cli: Record<string, unknown>,
  version: string,
): ParseResult<CliRuntimeAvailableCli> {
  const models = toCliCatalogModels(cli.models);
  return success({ type: "antigravity", version, ...(models ? { models } : {}) });
}
