import type { CodexModelState } from "@/convex/lib/contracts/validators";
import type { CodexUsageCursor } from "@/convex/lib/contracts/costUsage";
import type {
  CliRuntimeModel,
  RawCliChunk,
} from "../contracts";
import type { CliRuntimeDefinition } from "../registry";
import { parseCodexAvailableCli } from "./validators";
import {
  getCodexAwsProvider,
  getCodexModelOption,
  getCodexModelOptions,
  isCodexModelSlot,
  normalizeCodexModel,
  resolveCodexRunModel,
} from "./models";
import {
  getCodexContinuationIdFromIncomingChunks,
  normalizeCodexChunk,
} from "./normalizeChunk";
import { isCodexAppServerEphemeralChunk } from "./appServerEvents";
import { codexEffortCatalog } from "./effort";
import { extractCodexCostUsage } from "./costUsage";
import { getCodexSlashCommandsFromIncomingChunks } from "./slashCommands";

export const codexRuntime: CliRuntimeDefinition = {
  type: "codex",
  label: "Codex",
  parseAvailableCli: parseCodexAvailableCli,
  normalizeStoredModel: normalizeCodexModel,
  isSupportedModel: (value: unknown): value is CliRuntimeModel =>
    isCodexModelSlot(value),
  // AWS hides `default`; see cli-thread-model-selection spec.
  getDefaultModel: (availableClis) => (getCodexAwsProvider(availableClis) ? "gpt-6-sol" : "default"),
  getModelOptions: getCodexModelOptions,
  getModelOption: getCodexModelOption,
  resolveRunModel: ({ cliModel, availableClis }) =>
    resolveCodexRunModel(cliModel, availableClis),
  ...codexEffortCatalog,
  // Steering rides `turn/steer` on the app-server transport; exec-transport
  // sessions don't advertise codex in `steeringCliTypes`, so the Steer
  // affordance stays hidden for them.
  supportsSteering: true,
  // App-server threads re-pass `developerInstructions` every run; the exec
  // transport rejects runtime commands outright, so neither loses its bootstrap.
  supportsFirstMessageRuntimeCommand: true,
  normalizeChunk: (chunk: RawCliChunk) => normalizeCodexChunk(chunk),
  // Only the app-server transport emits deltas; exec chunks are never
  // ephemeral, so this is a no-op for exec threads.
  isEphemeralChunk: isCodexAppServerEphemeralChunk,
  extractContinuationIdFromChunks: (chunks: RawCliChunk[]) =>
    getCodexContinuationIdFromIncomingChunks(chunks),
  extractSlashCommandsFromChunks: (chunks: RawCliChunk[]) =>
    getCodexSlashCommandsFromIncomingChunks(chunks),
  extractCostUsageFromChunks: (
    chunks: RawCliChunk[],
    context: {
      cliModel?: string;
      continuationId?: string;
      usageCursor?: CodexUsageCursor;
      modelState?: CodexModelState;
    },
  ) => extractCodexCostUsage(chunks, context),
  buildResumeCommand: (continuationId: string) =>
    `codex resume ${continuationId}`,
};
