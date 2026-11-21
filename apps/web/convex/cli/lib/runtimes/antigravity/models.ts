import type { CliRuntimeModel, CliRuntimeModelOption } from "../contracts";
import type { CliRuntimeAvailableCli } from "../registry";
import type { AntigravityAvailableCli } from "./validators";

export const ANTIGRAVITY_DEFAULT_MODEL_SLOT = "default";

const DEFAULT_MODEL_OPTION: CliRuntimeModelOption = {
  value: ANTIGRAVITY_DEFAULT_MODEL_SLOT,
  label: "Default",
  description: "Use the Antigravity account's default model",
};

/**
 * Stored values are the default slot or an agy model id such as `gemini-3.8-flash`.
 * Keep in sync with `apps/cli/src/agent/runtimes/antigravity/models.ts`.
 */
const MODEL_ID_PATTERN = /^[\w][\w.:/-]{0,199}$/;

export function isAntigravityModel(value: unknown): value is CliRuntimeModel {
  return typeof value === "string" && MODEL_ID_PATTERN.test(value);
}

export function normalizeAntigravityModel(cliModel: CliRuntimeModel | undefined): string | undefined {
  return isAntigravityModel(cliModel) ? cliModel : undefined;
}

export function getAntigravityAvailableCli(
  availableClis: readonly CliRuntimeAvailableCli[] | undefined,
): AntigravityAvailableCli | undefined {
  return availableClis?.find((cli): cli is AntigravityAvailableCli => cli.type === "antigravity");
}

function toModelOption(slug: string, name: string): CliRuntimeModelOption {
  return { value: slug, label: name, description: slug, runModel: slug };
}

export function getAntigravityModelOptions(
  availableClis?: readonly CliRuntimeAvailableCli[],
): CliRuntimeModelOption[] {
  const models = getAntigravityAvailableCli(availableClis)?.models ?? [];
  return [DEFAULT_MODEL_OPTION, ...models.map((model) => toModelOption(model.slug, model.name))];
}

/** A stored id that is no longer advertised still gets a labeled option and runs as-is. */
export function getAntigravityModelOption(
  value: CliRuntimeModel | undefined,
  availableClis?: readonly CliRuntimeAvailableCli[],
): CliRuntimeModelOption | undefined {
  const model = normalizeAntigravityModel(value);
  if (!model) return undefined;
  if (model === ANTIGRAVITY_DEFAULT_MODEL_SLOT) return DEFAULT_MODEL_OPTION;
  const advertised = getAntigravityAvailableCli(availableClis)?.models?.find((entry) => entry.slug === model);
  return toModelOption(model, advertised?.name ?? model);
}

/** `default` sends no model, so agy uses the account default. */
export function resolveAntigravityRunModel(cliModel: CliRuntimeModel | undefined): string | undefined {
  const model = normalizeAntigravityModel(cliModel);
  return model === ANTIGRAVITY_DEFAULT_MODEL_SLOT ? undefined : model;
}
