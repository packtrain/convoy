import type {
  ParseResult,
} from "../contracts";
import type { CliRuntimeAvailableCli } from "../registry";
import { isRecord } from "@/lib/type-guards";
import { failure, success } from "../shared/parsing";
import type { ClaudeCodeAvailableModel } from "./contracts";
import { isClaudeCodeModelSlot, isClaudeCodeProvider } from "./models";

function parseClaudeAvailableModel(
  value: unknown,
): ParseResult<ClaudeCodeAvailableModel> {
  if (!isRecord(value)) {
    return failure("Claude models must be objects");
  }

  if (!isClaudeCodeModelSlot(value.slot)) {
    return failure("Claude model slot is invalid");
  }

  if (typeof value.label !== "string" || value.label.length < 1) {
    return failure("Claude model label must be a non-empty string");
  }

  if (
    value.runModel !== undefined &&
    (typeof value.runModel !== "string" || value.runModel.length < 1)
  ) {
    return failure("Claude model runModel must be a non-empty string");
  }

  return success({
    slot: value.slot,
    label: value.label,
    runModel: value.runModel,
  });
}

export function parseClaudeAvailableCli(
  cli: Record<string, unknown>,
  version: string,
): ParseResult<CliRuntimeAvailableCli> {
  // Tolerate providers this backend doesn't recognize (e.g. a newer CLI
  // reporting a provider added after this deploy): degrade to "unknown" so
  // registration still succeeds and Claude falls back to generic model strings.
  const provider = isClaudeCodeProvider(cli.provider)
    ? cli.provider
    : cli.provider === undefined
      ? undefined
      : "unknown";

  let models: Array<ClaudeCodeAvailableModel> | undefined;
  if (cli.models !== undefined) {
    if (!Array.isArray(cli.models)) {
      return failure("Claude models must be an array");
    }

    models = [];
    for (const model of cli.models) {
      const parsedModel = parseClaudeAvailableModel(model);
      if (!parsedModel.success) {
        return parsedModel;
      }
      models.push(parsedModel.value);
    }
  }

  return success({
    type: "claude-code",
    version,
    provider,
    models,
  });
}
