import type { CliRuntimeModel, ParseResult, RawCliChunk } from "../contracts";
import type { CliRuntimeAvailableCli, CliRuntimeDefinition, CliRuntimeEffortContext } from "../registry";
import { getAcpContinuationIdFromIncomingChunks, isAcpEphemeralChunk } from "../acp/normalizeChunk";
import {
  getAntigravityEffortOptions,
  isAntigravityEffortSupported,
  normalizeAntigravityStoredEffort,
  resolveAntigravityRunEffort,
} from "./effort";
import {
  ANTIGRAVITY_DEFAULT_MODEL_SLOT,
  getAntigravityModelOption,
  getAntigravityModelOptions,
  isAntigravityModel,
  normalizeAntigravityModel,
  resolveAntigravityRunModel,
} from "./models";
import { normalizeAntigravityChunk } from "./normalizeChunk";
import { parseAntigravityAvailableCli } from "./parseAvailableCli";
import { getAntigravitySlashCommandsFromIncomingChunks } from "./slashCommands";

/**
 * Antigravity CLI over ACP, one `agy acp` process per run. Models and thinking levels
 * come from the per-machine catalog. Spec: docs/specs/cli-antigravity-runtime.md.
 */
export const antigravityRuntime: CliRuntimeDefinition = {
  type: "antigravity",
  label: "Antigravity",
  // 0.151.0 skips every permission; 0.152.x ignores the model; 0.153.x sends slash commands as prose.
  minAppVersion: "0.154.0",
  // The system prompt rides in session/new `_meta`, so a raw first message displaces nothing.
  supportsFirstMessageRuntimeCommand: true,
  // A second session/prompt steers the open turn (CLI 0.155.0 advertises it in steeringCliTypes).
  supportsSteering: true,
  parseAvailableCli: (cli: Record<string, unknown>, version: string): ParseResult<CliRuntimeAvailableCli> =>
    parseAntigravityAvailableCli(cli, version),
  normalizeStoredModel: normalizeAntigravityModel,
  isSupportedModel: (value: unknown): value is CliRuntimeModel => isAntigravityModel(value),
  getDefaultModel: () => ANTIGRAVITY_DEFAULT_MODEL_SLOT,
  getModelOptions: (availableClis?: readonly CliRuntimeAvailableCli[]) => getAntigravityModelOptions(availableClis),
  getModelOption: (value: CliRuntimeModel | undefined, availableClis?: readonly CliRuntimeAvailableCli[]) =>
    getAntigravityModelOption(value, availableClis),
  resolveRunModel: ({ cliModel }: { cliModel: CliRuntimeModel | undefined }) => resolveAntigravityRunModel(cliModel),
  isSupportedEffort: (value: unknown, context?: CliRuntimeEffortContext): value is string =>
    isAntigravityEffortSupported(value, context),
  getDefaultEffort: () => "default",
  getEffortOptions: (context?: CliRuntimeEffortContext) => getAntigravityEffortOptions(context),
  normalizeStoredEffort: (value: string | undefined) => normalizeAntigravityStoredEffort(value),
  resolveRunEffort: (value: string | undefined, context?: CliRuntimeEffortContext) =>
    resolveAntigravityRunEffort(value, context),
  normalizeChunk: (chunk: RawCliChunk) => normalizeAntigravityChunk(chunk),
  isEphemeralChunk: (chunk: RawCliChunk) => isAcpEphemeralChunk(chunk),
  extractContinuationIdFromChunks: (chunks: RawCliChunk[]) => getAcpContinuationIdFromIncomingChunks(chunks),
  extractSlashCommandsFromChunks: (chunks: RawCliChunk[]) => getAntigravitySlashCommandsFromIncomingChunks(chunks),
  // The ACP session id is an agy conversation id (verified on 1.5.13).
  buildResumeCommand: (continuationId: string) => `agy --conversation ${continuationId}`,
};
