import type {
  CliRuntimeModel,
  ParseResult,
  RawCliChunk,
} from "../contracts";
import type {
  CliRuntimeAvailableCli,
  CliRuntimeDefinition,
  CliRuntimeEffortContext,
} from "../registry";
import { OPENCODE_DEFAULT_MODEL_SLOT } from "./contracts";
import {
  getOpencodeEffortOptions,
  isOpencodeEffortSupported,
  normalizeOpencodeStoredEffort,
  resolveOpencodeRunEffort,
} from "./effort";
import { parseOpencodeAvailableCli } from "./parseAvailableCli";
import {
  getOpencodeModelOption,
  getOpencodeModelOptions,
  isOpencodeModel,
  normalizeOpencodeModel,
  resolveOpencodeRunModel,
} from "./models";
import {
  getOpencodeContinuationIdFromIncomingChunks,
  isOpencodeEphemeralChunk,
  normalizeOpencodeChunk,
} from "./normalizeChunk";
import { getOpencodeSlashCommandsFromIncomingChunks } from "./slashCommands";
import { extractOpencodeCostUsage } from "./costUsage";

export const opencodeRuntime: CliRuntimeDefinition = {
  type: "opencode",
  label: "OpenCode",
  parseAvailableCli: (
    cli: Record<string, unknown>,
    version: string,
  ): ParseResult<CliRuntimeAvailableCli> =>
    parseOpencodeAvailableCli(cli, version),
  normalizeStoredModel: normalizeOpencodeModel,
  isSupportedModel: (value: unknown): value is CliRuntimeModel =>
    isOpencodeModel(value),
  getDefaultModel: () => OPENCODE_DEFAULT_MODEL_SLOT,
  getModelOptions: (availableClis?: readonly CliRuntimeAvailableCli[]) =>
    getOpencodeModelOptions(availableClis),
  getModelOption: (
    value: CliRuntimeModel | undefined,
    availableClis?: readonly CliRuntimeAvailableCli[],
  ) => getOpencodeModelOption(value, availableClis),
  resolveRunModel: ({ cliModel }: { cliModel: CliRuntimeModel | undefined }) =>
    resolveOpencodeRunModel(cliModel),
  isSupportedEffort: (
    value: unknown,
    context?: CliRuntimeEffortContext,
  ): value is string => isOpencodeEffortSupported(value, context),
  getDefaultEffort: () => "default",
  getEffortOptions: (context?: CliRuntimeEffortContext) =>
    getOpencodeEffortOptions(context),
  normalizeStoredEffort: (value: string | undefined) =>
    normalizeOpencodeStoredEffort(value),
  resolveRunEffort: (
    value: string | undefined,
    context?: CliRuntimeEffortContext,
  ) => resolveOpencodeRunEffort(value, context),
  normalizeChunk: (chunk: RawCliChunk) => normalizeOpencodeChunk(chunk),
  isEphemeralChunk: isOpencodeEphemeralChunk,
  extractContinuationIdFromChunks: (chunks: RawCliChunk[]) =>
    getOpencodeContinuationIdFromIncomingChunks(chunks),
  extractSlashCommandsFromChunks: (chunks: RawCliChunk[]) =>
    getOpencodeSlashCommandsFromIncomingChunks(chunks),
  extractCostUsageFromChunks: (
    chunks: RawCliChunk[],
    context: { cliModel?: string },
  ) => {
    const usage = extractOpencodeCostUsage(chunks, context.cliModel);
    return usage ? { usage } : null;
  },
  buildResumeCommand: (continuationId: string) =>
    `opencode --session ${continuationId}`,
};
