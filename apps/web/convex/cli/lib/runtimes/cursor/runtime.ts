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
import { success } from "../shared/parsing";
import { getSyntheticSlashCommandsFromIncomingChunks } from "../shared/syntheticCommands";
import {
  getCursorModelOption,
  getCursorModelOptions,
  isCursorModelSlot,
  normalizeCursorModel,
  resolveCursorRunModel,
} from "./models";
import {
  getCursorEffortOptions,
  isCursorEffortSupported,
  normalizeCursorStoredEffort,
  resolveCursorRunEffort,
} from "./effort";
import {
  getCursorContinuationIdFromIncomingChunks,
  normalizeCursorChunk,
} from "./normalizeChunk";

/**
 * Cursor CLI (`cursor-agent`) runtime. Each turn is a fresh
 * `cursor-agent -p` process (prompt on stdin, then EOF), so there is no
 * live steering — messages sent mid-run queue for the next `--resume`
 * run. See docs/specs/cliCursorRuntime spec for the full contract.
 */
export const cursorRuntime: CliRuntimeDefinition = {
  type: "cursor",
  label: "Cursor",
  parseAvailableCli: (
    _cli: Record<string, unknown>,
    version: string,
  ): ParseResult<CliRuntimeAvailableCli> =>
    success({ type: "cursor", version }),
  normalizeStoredModel: normalizeCursorModel,
  isSupportedModel: (value: unknown): value is CliRuntimeModel =>
    isCursorModelSlot(value),
  getDefaultModel: () => "default",
  getModelOptions: () => getCursorModelOptions(),
  getModelOption: (value: CliRuntimeModel | undefined) =>
    getCursorModelOption(value),
  resolveRunModel: ({ cliModel }: { cliModel: CliRuntimeModel | undefined }) =>
    resolveCursorRunModel(cliModel),
  isSupportedEffort: (
    value: unknown,
    context?: CliRuntimeEffortContext,
  ): value is string => isCursorEffortSupported(value, context),
  getDefaultEffort: () => "default",
  getEffortOptions: (context?: CliRuntimeEffortContext) =>
    getCursorEffortOptions(context),
  normalizeStoredEffort: (value: string | undefined) =>
    normalizeCursorStoredEffort(value),
  resolveRunEffort: (
    value: string | undefined,
    context?: CliRuntimeEffortContext,
  ) => resolveCursorRunEffort(value, context),
  normalizeChunk: (chunk: RawCliChunk) => normalizeCursorChunk(chunk),
  extractContinuationIdFromChunks: (chunks: RawCliChunk[]) =>
    getCursorContinuationIdFromIncomingChunks(chunks),
  extractSlashCommandsFromChunks: (chunks: RawCliChunk[]) =>
    getSyntheticSlashCommandsFromIncomingChunks(chunks),
  buildResumeCommand: (continuationId: string) =>
    `cursor-agent --resume ${continuationId}`,
};
