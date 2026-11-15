import type { ParseResult } from "../contracts";
import type { CliRuntimeAvailableCli } from "../registry";
import { isRecord } from "@/lib/type-guards";
import { success } from "../shared/parsing";
import type { OpencodeAdvertisedModel } from "./contracts";

/**
 * Ingest bounds for a stored catalog: the CLI's cap is a client constant, so this
 * is what holds for an old, custom or hostile registration. Degrades (truncate or
 * skip) rather than failing the registration, like the rest of this parser.
 */
export const MAX_STORED_CATALOG_MODELS = 1000;
export const MAX_STORED_CATALOG_VARIANTS = 20;
const MAX_CATALOG_STRING_LENGTH = 200;

function parseOpencodeAdvertisedModel(
  value: unknown,
): OpencodeAdvertisedModel | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.slug !== "string" ||
    value.slug.length < 1 ||
    value.slug.length > MAX_CATALOG_STRING_LENGTH
  ) {
    return null;
  }

  if (
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > MAX_CATALOG_STRING_LENGTH
  ) {
    return null;
  }

  let variants: Array<string> | undefined;
  if (value.variants !== undefined) {
    if (
      !Array.isArray(value.variants) ||
      value.variants.some((variant) => typeof variant !== "string")
    ) {
      return null;
    }
    variants = (value.variants as Array<string>).slice(
      0,
      MAX_STORED_CATALOG_VARIANTS,
    );
  }

  // `providerID`/`modelID` sent by older CLIs are dropped, not stored: the slug
  // is `providerID/modelID` and every reader splits it (OS-1721).
  return {
    slug: value.slug,
    name: value.name,
    variants,
  };
}

/**
 * Fail-soft parser: the advertised inventory is best-effort metadata, so one
 * malformed model (e.g. from a version-skewed CLI) must not fail the whole
 * registration — invalid entries are skipped and the valid ones kept.
 */
export function parseOpencodeAvailableCli(
  cli: Record<string, unknown>,
  version: string,
): ParseResult<CliRuntimeAvailableCli> {
  let models: Array<OpencodeAdvertisedModel> | undefined;
  if (Array.isArray(cli.models)) {
    models = cli.models
      .map((model) => parseOpencodeAdvertisedModel(model))
      .filter((model): model is OpencodeAdvertisedModel => model !== null)
      .slice(0, MAX_STORED_CATALOG_MODELS);
  }

  const defaultModel =
    typeof cli.defaultModel === "string" && cli.defaultModel.length > 0
      ? cli.defaultModel
      : undefined;

  return success({
    type: "opencode",
    version,
    models,
    defaultModel,
  });
}
