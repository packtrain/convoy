export type {
  BuildSpawnSpecContext,
  DetectCapabilitiesContext,
  DetectVersionContext,
  HandleInputContext,
  InterruptContext,
  ProviderAdapter,
  ResolveExecutableContext,
  ResolvedExecutable,
  TerminateContext,
} from "../types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
