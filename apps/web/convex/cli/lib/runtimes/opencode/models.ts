import type { CliRuntimeModel, CliRuntimeModelOption } from "../contracts";
import type { CliRuntimeAvailableCli } from "../registry";
import {
  OPENCODE_DEFAULT_MODEL_SLOT,
  type OpencodeAvailableCli,
} from "./contracts";

const DEFAULT_MODEL_OPTION: CliRuntimeModelOption = {
  value: OPENCODE_DEFAULT_MODEL_SLOT,
  label: "Default",
  description: "Use the connected machine's configured OpenCode model",
};

/**
 * Stored values are the default slot or a `providerID/modelID` slug.
 * Keep in sync with `apps/cli/src/agent/runtimes/opencode/runtime.ts`
 * (`isOpencodeModel`) — no shared package crosses the CLI/Convex boundary.
 */
const MODEL_SLUG_PATTERN = /^[^/\s]+\/\S+$/;

export function isOpencodeModel(value: unknown): value is CliRuntimeModel {
  return (
    typeof value === "string" &&
    (value === OPENCODE_DEFAULT_MODEL_SLOT || MODEL_SLUG_PATTERN.test(value))
  );
}

export function normalizeOpencodeModel(
  cliModel: CliRuntimeModel | undefined,
): string | undefined {
  return isOpencodeModel(cliModel) ? cliModel : undefined;
}

export function getOpencodeAvailableCli(
  availableClis: readonly CliRuntimeAvailableCli[] | undefined,
): OpencodeAvailableCli | undefined {
  return availableClis?.find(
    (cli): cli is OpencodeAvailableCli => cli.type === "opencode",
  );
}

export function getOpencodeModelOptions(
  availableClis?: readonly CliRuntimeAvailableCli[],
): Array<CliRuntimeModelOption> {
  const advertisedModels = getOpencodeAvailableCli(availableClis)?.models ?? [];

  return [
    DEFAULT_MODEL_OPTION,
    ...advertisedModels.map((model) => ({
      value: model.slug,
      label: model.name,
      description: model.slug,
      runModel: model.slug,
    })),
  ];
}

/**
 * Resolve a stored model to its option, covering slugs that are no longer
 * advertised (provider disconnected, CLI offline) so stored drafts and
 * messages keep rendering a label; the slug still runs as-is.
 */
export function getOpencodeModelOption(
  value: CliRuntimeModel | undefined,
  availableClis?: readonly CliRuntimeAvailableCli[],
): CliRuntimeModelOption | undefined {
  const model = normalizeOpencodeModel(value);
  if (!model) {
    return undefined;
  }

  if (model === OPENCODE_DEFAULT_MODEL_SLOT) {
    return DEFAULT_MODEL_OPTION;
  }

  const advertised = getOpencodeAvailableCli(availableClis)?.models?.find(
    (advertisedModel) => advertisedModel.slug === model,
  );
  if (advertised) {
    return {
      value: advertised.slug,
      label: advertised.name,
      description: advertised.slug,
      runModel: advertised.slug,
    };
  }

  return {
    value: model,
    label: model.split("/").slice(1).join("/") || model,
    description: model,
    runModel: model,
  };
}

export function resolveOpencodeRunModel(
  cliModel: CliRuntimeModel | undefined,
): string | undefined {
  const model = normalizeOpencodeModel(cliModel);
  if (!model || model === OPENCODE_DEFAULT_MODEL_SLOT) {
    return undefined;
  }

  return model;
}
