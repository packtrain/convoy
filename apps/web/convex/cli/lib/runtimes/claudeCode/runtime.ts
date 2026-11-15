import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import type { CostUsageExtraction } from "@/convex/lib/contracts/costUsage";
import type {
  CliRuntimeModel,
  CliRuntimeModelOption,
  ParseResult,
  RawCliChunk,
} from "../contracts";
import type { CliRuntimeAvailableCli, CliRuntimeDefinition } from "../registry";
import type { RuntimeSlashCommand } from "../validators";
import { parseClaudeAvailableCli } from "./parseAvailableCli";
import {
  getClaudeModelOption,
  getClaudeModelOptions,
  isClaudeCodeModelSlot,
  normalizeClaudeCodeModel,
  resolveClaudeRunModel,
} from "./models";
import { claudeCodeEffortCatalog } from "./effort";
import { getClaudeCodeContinuationIdFromIncomingChunks } from "./continuation";
import { getClaudeCodeSlashCommandsFromIncomingChunks } from "./slashCommands";
import {
  isClaudeCodeEphemeralChunk,
  normalizeClaudeCodeChunk,
  splitOversizedClaudeCodeChunk,
} from "./normalizeChunk";
import { buildClaudeCodeResumeCommand } from "./resumeCommand";
import { extractClaudeCostUsage } from "./costUsage";

export const claudeCodeRuntime: CliRuntimeDefinition = {
  type: "claude-code",
  label: "Claude Code",
  supportsSteering: true,
  // Identity and agent prompt ride the system-prompt append on every run.
  supportsFirstMessageRuntimeCommand: true,
  parseAvailableCli: (
    cli: Record<string, unknown>,
    version: string,
  ): ParseResult<CliRuntimeAvailableCli> =>
    parseClaudeAvailableCli(cli, version),
  normalizeStoredModel: normalizeClaudeCodeModel,
  isSupportedModel: (value: unknown): value is CliRuntimeModel =>
    isClaudeCodeModelSlot(value),
  getDefaultModel: () => "default",
  getModelOptions: (
    availableClis?: readonly CliRuntimeAvailableCli[],
  ): Array<CliRuntimeModelOption> => getClaudeModelOptions(availableClis),
  getModelOption: (
    value: CliRuntimeModel | undefined,
    availableClis?: readonly CliRuntimeAvailableCli[],
  ): CliRuntimeModelOption | undefined =>
    getClaudeModelOption(value, availableClis),
  resolveRunModel: ({
    cliModel,
    availableClis,
  }: {
    cliModel: CliRuntimeModel | undefined;
    availableClis?: readonly CliRuntimeAvailableCli[];
  }) => resolveClaudeRunModel(cliModel, availableClis),
  ...claudeCodeEffortCatalog,
  normalizeChunk: (chunk: RawCliChunk): CliNormalizedEvent =>
    normalizeClaudeCodeChunk(chunk),
  isEphemeralChunk: isClaudeCodeEphemeralChunk,
  splitOversizedChunk: splitOversizedClaudeCodeChunk,
  extractContinuationIdFromChunks: (chunks: RawCliChunk[]): string | null =>
    getClaudeCodeContinuationIdFromIncomingChunks(chunks),
  extractCostUsageFromChunks: (chunks: RawCliChunk[]): CostUsageExtraction | null => {
    const usage = extractClaudeCostUsage(chunks);
    return usage ? { usage } : null;
  },
  extractSlashCommandsFromChunks: (chunks: RawCliChunk[]): RuntimeSlashCommand[] | null =>
    getClaudeCodeSlashCommandsFromIncomingChunks(chunks),
  buildResumeCommand: buildClaudeCodeResumeCommand,
};
