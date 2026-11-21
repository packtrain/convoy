import type { ParseResult } from "../contracts";
import type { CliRuntimeAvailableCli } from "../registry";
import { success } from "../shared/parsing";
import { toCliCatalogModels } from "../shared/validators";

/**
 * Fail-soft: the advertised inventory is best-effort metadata, so malformed models
 * are skipped rather than failing the registration. `providerID`/`modelID` from
 * older CLIs are dropped: the slug is `providerID/modelID` (OS-1721).
 */
export function parseOpencodeAvailableCli(
  cli: Record<string, unknown>,
  version: string,
): ParseResult<CliRuntimeAvailableCli> {
  const defaultModel =
    typeof cli.defaultModel === "string" && cli.defaultModel.length > 0
      ? cli.defaultModel
      : undefined;

  return success({
    type: "opencode",
    version,
    models: toCliCatalogModels(cli.models),
    defaultModel,
  });
}
