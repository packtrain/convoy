import type { ParseResult, RawCliChunk } from "../contracts";
import type { CliRuntimeAvailableCli, CliRuntimeDefinition } from "../registry";
import { success } from "../shared/parsing";
import { getAcpContinuationIdFromIncomingChunks, isAcpEphemeralChunk } from "../acp/normalizeChunk";
import { normalizeAntigravityChunk } from "./normalizeChunk";

/**
 * Antigravity CLI over ACP, one `agy acp` process per run. No models, effort, slash
 * commands, cost, steering or resume command yet. Spec: docs/specs/cli-antigravity-runtime.md.
 */
export const antigravityRuntime: CliRuntimeDefinition = {
  type: "antigravity",
  label: "Antigravity",
  // 0.151.0 ignores Ask to approve and would skip every permission.
  minAppVersion: "0.152.0",
  parseAvailableCli: (_cli: Record<string, unknown>, version: string): ParseResult<CliRuntimeAvailableCli> =>
    success({ type: "antigravity", version }),
  normalizeChunk: (chunk: RawCliChunk) => normalizeAntigravityChunk(chunk),
  isEphemeralChunk: (chunk: RawCliChunk) => isAcpEphemeralChunk(chunk),
  extractContinuationIdFromChunks: (chunks: RawCliChunk[]) => getAcpContinuationIdFromIncomingChunks(chunks),
};
