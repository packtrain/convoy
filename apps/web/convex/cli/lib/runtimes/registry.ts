import type {
  CliModel,
  CliNormalizedEvent,
  CodexModelState,
} from "@/convex/lib/contracts/validators";
import type {
  CodexUsageCursor,
  CostUsageExtraction,
} from "@/convex/lib/contracts/costUsage";
import { isRecord } from "@/lib/type-guards";
import {
  CLI_RUNTIME_SLUGS,
  isCatalogCliType,
  type CliRuntimeEffortOption,
  type CliRuntimeModel,
  type CliRuntimeModelOption,
  type CliRuntimeSlug,
  type GenericAvailableCli,
  type ParseResult,
  type RawCliChunk,
} from "./contracts";
import type { ClaudeCodeAvailableCli } from "./claudeCode/contracts";
import type { CodexAvailableCli } from "./codex/validators";
import type { RuntimeSlashCommand } from "./validators";
import type { AntigravityAvailableCli } from "./antigravity/validators";
import { antigravityRuntime } from "./antigravity/runtime";
import { claudeCodeRuntime } from "./claudeCode/runtime";
import { codexRuntime } from "./codex/runtime";
import { cursorRuntime } from "./cursor/runtime";
import type { OpencodeAvailableCli } from "./opencode/contracts";
import { opencodeRuntime } from "./opencode/runtime";
export {
  MAX_STORED_CATALOG_MODELS,
  MAX_STORED_CATALOG_VARIANTS,
} from "./shared/validators";
import { createGenericCliRuntime } from "./shared/genericRuntime";
import { failure } from "./shared/parsing";

export type CliRuntimeAvailableCli =
  | ClaudeCodeAvailableCli
  | CodexAvailableCli
  | OpencodeAvailableCli
  | AntigravityAvailableCli
  | GenericAvailableCli;

/**
 * Model and inventory context for per-model effort catalogs.
 * Static catalogs ignore it. See docs/specs/cli-thread-effort-selection.md.
 */
export type CliRuntimeEffortContext = {
  cliModel?: CliRuntimeModel;
  availableClis?: readonly CliRuntimeAvailableCli[];
};

export type CliRuntimeDefinition = {
  type: CliRuntimeSlug;
  label: string;
  /**
   * Whether runs of this runtime accept steer-requested user messages
   * injected mid-run (OS-1111). Requires the runtime's CLI runner to
   * implement `steer()`.
   */
  supportsSteering?: boolean;
  /**
   * Whether a thread's **first** message may be a runtime command. False for
   * runtimes whose CLI runner injects thread identity and the bound agent's
   * prompt into that first message, which a raw command displaces or skips
   * forever. Spec: `docs/specs/cli-runtime-commands.md`.
   */
  supportsFirstMessageRuntimeCommand?: boolean;
  /** Oldest @useconvoy/cli that runs this runtime safely; older CLIs register without it. */
  minAppVersion?: string;
  parseAvailableCli: (
    cli: Record<string, unknown>,
    version: string,
  ) => ParseResult<CliRuntimeAvailableCli>;
  normalizeStoredModel?: (
    cliModel: CliRuntimeModel | undefined,
  ) => string | undefined;
  isSupportedModel?: (value: unknown) => value is CliRuntimeModel;
  /** `availableClis` lets a profile's provider pick its own default (Codex on AWS). */
  getDefaultModel?: (availableClis?: readonly CliRuntimeAvailableCli[]) => CliRuntimeModel | undefined;
  getModelOptions?: (
    availableClis?: readonly CliRuntimeAvailableCli[],
  ) => Array<CliRuntimeModelOption>;
  /**
   * Resolve a single stored model value to its option, including retired
   * values that are no longer offered by getModelOptions.
   */
  getModelOption?: (
    value: CliRuntimeModel | undefined,
    availableClis?: readonly CliRuntimeAvailableCli[],
  ) => CliRuntimeModelOption | undefined;
  resolveRunModel?: (args: {
    cliModel: CliRuntimeModel | undefined;
    availableClis?: readonly CliRuntimeAvailableCli[];
  }) => string | undefined;
  isSupportedEffort?: (
    value: unknown,
    context?: CliRuntimeEffortContext,
  ) => value is string;
  getDefaultEffort?: () => string;
  getEffortOptions?: (
    context?: CliRuntimeEffortContext,
  ) => Array<CliRuntimeEffortOption>;
  normalizeStoredEffort?: (
    value: string | undefined,
    context?: CliRuntimeEffortContext,
  ) => string | undefined;
  resolveRunEffort?: (
    value: string | undefined,
    context?: CliRuntimeEffortContext,
  ) => string | undefined;
  normalizeChunk?: (chunk: RawCliChunk) => CliNormalizedEvent;
  /**
   * Marks raw chunks that only exist for live partial streaming and become
   * redundant once the final whole message chunk arrives (deleted on
   * message completion).
   */
  isEphemeralChunk?: (chunk: RawCliChunk) => boolean;
  /**
   * Losslessly split a raw chunk whose data exceeds the storage budget into
   * consecutive smaller chunks (e.g. a coalesced streaming delta). Returns
   * null when the chunk has no splittable payload; callers then fall back to
   * the runtime-agnostic scrub (shared/scrubChunk.ts), then truncation.
   */
  splitOversizedChunk?: (
    chunk: RawCliChunk,
    maxDataChars: number,
  ) => RawCliChunk[] | null;
  extractContinuationIdFromChunks?: (
    chunks: RawCliChunk[],
  ) => string | null;
  /**
   * Slash commands the runtime advertised in the incoming chunks (init
   * event). Implementing this opts the runtime into thread-composer runtime
   * commands (captured as a `cliRuntimeFacts` row at chunk-append time).
   */
  extractSlashCommandsFromChunks?: (
    chunks: RawCliChunk[],
  ) => RuntimeSlashCommand[] | null;
  /** Extract usage or accounting metadata; null means neither changed.
   * Codex returns a thread cursor and per-run model state for persistence.
   */
  extractCostUsageFromChunks?: (
    chunks: RawCliChunk[],
    context: {
      cliModel?: string;
      continuationId?: string;
      usageCursor?: CodexUsageCursor;
      modelState?: CodexModelState;
    },
  ) => CostUsageExtraction | null;
  buildResumeCommand?: (continuationId: string) => string;
};

const RUNTIME_DEFINITIONS: Record<CliRuntimeSlug, CliRuntimeDefinition> = {
  "claude-code": claudeCodeRuntime,
  codex: codexRuntime,
  amp: createGenericCliRuntime({ type: "amp", label: "Amp" }),
  opencode: opencodeRuntime,
  droid: createGenericCliRuntime({ type: "droid", label: "Droid" }),
  cursor: cursorRuntime,
  // Hidden placeholder; kept because stored rows may hold it (OS-2464).
  gemini: createGenericCliRuntime({ type: "gemini", label: "Gemini CLI" }),
  antigravity: antigravityRuntime,
  coderabbit: createGenericCliRuntime({
    type: "coderabbit",
    label: "CodeRabbit",
  }),
  "github-copilot": createGenericCliRuntime({
    type: "github-copilot",
    label: "Copilot",
  }),
  other: createGenericCliRuntime({ type: "other", label: "Other" }),
};

export const CLI_RUNTIME_LABELS: Record<CliRuntimeSlug, string> =
  Object.fromEntries(
    CLI_RUNTIME_SLUGS.map((slug) => [slug, RUNTIME_DEFINITIONS[slug].label]),
  ) as Record<CliRuntimeSlug, string>;

export function getSupportedCliTypes(): readonly CliRuntimeSlug[] {
  return CLI_RUNTIME_SLUGS;
}

export function isCliType(value: unknown): value is CliRuntimeSlug {
  return (
    typeof value === "string" &&
    getSupportedCliTypes().includes(value as CliRuntimeSlug)
  );
}

export function getCliRuntime(cliType: CliRuntimeSlug): CliRuntimeDefinition {
  return RUNTIME_DEFINITIONS[cliType];
}

export function getAvailableCli(
  availableClis: readonly CliRuntimeAvailableCli[] | undefined,
  cliType: CliRuntimeSlug,
): CliRuntimeAvailableCli | undefined {
  return availableClis?.find((cli) => cli.type === cliType);
}

export function parseAvailableCli(
  cli: unknown,
): ParseResult<CliRuntimeAvailableCli> {
  if (!isRecord(cli)) {
    return failure("Each CLI must be an object with type and version");
  }

  if (!isCliType(cli.type)) {
    return failure("Unsupported CLI type");
  }

  if (typeof cli.version !== "string" || cli.version.length < 1) {
    return failure("CLI version must be a non-empty string");
  }

  return getCliRuntime(cli.type).parseAvailableCli(cli, cli.version);
}

/** Whether this runtime can have a stored catalog at all, so readers skip a lookup that could only miss (OS-1721). */
export function cliTypeAdvertisesModelCatalog(cliType: CliRuntimeSlug): boolean {
  return isCatalogCliType(cliType);
}

export function normalizeCliModelForStorage(args: {
  cliType: CliRuntimeSlug;
  cliModel: CliModel | undefined;
}): string | undefined {
  return getCliRuntime(args.cliType).normalizeStoredModel?.(args.cliModel);
}

export function isSupportedCliModel(
  cliType: CliRuntimeSlug,
  value: unknown,
): value is CliRuntimeModel {
  return getCliRuntime(cliType).isSupportedModel?.(value) ?? false;
}

export function getDefaultCliModel(
  cliType: CliRuntimeSlug,
  availableClis?: readonly CliRuntimeAvailableCli[],
): CliRuntimeModel | undefined {
  return getCliRuntime(cliType).getDefaultModel?.(availableClis);
}

export function getCliModelOptions(args: {
  cliType: CliRuntimeSlug;
  availableClis?: readonly CliRuntimeAvailableCli[];
}): Array<CliRuntimeModelOption> {
  return getCliRuntime(args.cliType).getModelOptions?.(args.availableClis) ?? [];
}

export function getCliModelOption(args: {
  cliType: CliRuntimeSlug;
  value: CliRuntimeModel | undefined;
  availableClis?: readonly CliRuntimeAvailableCli[];
}): CliRuntimeModelOption | undefined {
  if (!args.value) {
    return undefined;
  }

  // Prefer the runtime's single-value resolver so retired (no longer
  // selectable) stored models still resolve to a labeled option.
  const runtimeOption = getCliRuntime(args.cliType).getModelOption?.(
    args.value,
    args.availableClis,
  );
  if (runtimeOption) {
    return runtimeOption;
  }

  return getCliModelOptions({
    cliType: args.cliType,
    availableClis: args.availableClis,
  }).find((option) => option.value === args.value);
}

export function getCliTriggerLabel(args: {
  cliType: CliRuntimeSlug;
  value: CliRuntimeModel | undefined;
  availableClis?: readonly CliRuntimeAvailableCli[];
}): string {
  const defaultModel = getDefaultCliModel(args.cliType);
  const model = getCliModelOption(args);

  if (!model || model.value === defaultModel) {
    return CLI_RUNTIME_LABELS[args.cliType];
  }

  return model.label;
}

export function resolveCliRunModel(args: {
  cliType: CliRuntimeSlug;
  cliModel: CliModel | undefined;
  availableClis?: readonly CliRuntimeAvailableCli[];
}): string | undefined {
  return getCliRuntime(args.cliType).resolveRunModel?.({
    cliModel: args.cliModel,
    availableClis: args.availableClis,
  });
}

export function normalizeCliEffortForStorage(args: {
  cliType: CliRuntimeSlug;
  cliEffort: string | undefined;
  context?: CliRuntimeEffortContext;
}): string | undefined {
  return getCliRuntime(args.cliType).normalizeStoredEffort?.(
    args.cliEffort,
    args.context,
  );
}

export function isSupportedCliEffort(
  cliType: CliRuntimeSlug,
  value: unknown,
  context?: CliRuntimeEffortContext,
): value is string {
  return getCliRuntime(cliType).isSupportedEffort?.(value, context) ?? false;
}

export function getDefaultCliEffort(
  cliType: CliRuntimeSlug,
): string | undefined {
  return getCliRuntime(cliType).getDefaultEffort?.();
}

export function getCliEffortOptions(
  cliType: CliRuntimeSlug,
  context?: CliRuntimeEffortContext,
): Array<CliRuntimeEffortOption> {
  return getCliRuntime(cliType).getEffortOptions?.(context) ?? [];
}

export function resolveCliRunEffort(args: {
  cliType: CliRuntimeSlug;
  cliEffort: string | undefined;
  context?: CliRuntimeEffortContext;
}): string | undefined {
  return getCliRuntime(args.cliType).resolveRunEffort?.(
    args.cliEffort,
    args.context,
  );
}

export function normalizeCliChunk(args: {
  cliType: CliRuntimeSlug;
  chunk: RawCliChunk;
}): CliNormalizedEvent {
  return (
    getCliRuntime(args.cliType).normalizeChunk?.(args.chunk) ?? {
      kind: "unknown",
      reason: "unsupported-runtime",
      rawType: args.chunk.type,
      rawData: args.chunk.data,
    }
  );
}

export function isEphemeralCliChunk(args: {
  cliType: CliRuntimeSlug;
  chunk: RawCliChunk;
}): boolean {
  return getCliRuntime(args.cliType).isEphemeralChunk?.(args.chunk) ?? false;
}

export function splitOversizedCliChunk(args: {
  cliType: CliRuntimeSlug;
  chunk: RawCliChunk;
  maxDataChars: number;
}): RawCliChunk[] | null {
  return (
    getCliRuntime(args.cliType).splitOversizedChunk?.(
      args.chunk,
      args.maxDataChars,
    ) ?? null
  );
}

export function getContinuationIdFromIncomingChunks(args: {
  cliType: CliRuntimeSlug;
  chunks: RawCliChunk[];
}): string | null {
  return (
    getCliRuntime(args.cliType).extractContinuationIdFromChunks?.(args.chunks) ??
    null
  );
}

export function buildResumeCommand(args: {
  cliType: CliRuntimeSlug;
  continuationId: string;
}): string | null {
  const builder = getCliRuntime(args.cliType).buildResumeCommand;
  return builder ? builder(args.continuationId) : null;
}

export function supportsResumeLocally(cliType: CliRuntimeSlug): boolean {
  return Boolean(getCliRuntime(cliType).buildResumeCommand);
}

export function cliTypeSupportsSteering(cliType: CliRuntimeSlug): boolean {
  return getCliRuntime(cliType).supportsSteering === true;
}

/** Whether a thread may open on a runtime command rather than a prompt. */
export function cliTypeSupportsFirstMessageRuntimeCommand(cliType: CliRuntimeSlug): boolean {
  return getCliRuntime(cliType).supportsFirstMessageRuntimeCommand === true;
}

/** Runtimes with a fork primitive (OS-1397, OS-2073). Spec: cli-thread-fork.md → Runtime gating. */
export function cliTypeSupportsFork(cliType: CliRuntimeSlug): boolean {
  return cliType === "claude-code" || cliType === "codex";
}

/** Whether a finished reply can be branched: Codex needs the turn to fork through. */
export function canForkReply(cliType: CliRuntimeSlug, cliContext: { turnId?: string } | undefined): boolean {
  return cliTypeSupportsFork(cliType) && (cliType !== "codex" || cliContext?.turnId !== undefined);
}

export function getSlashCommandsFromIncomingChunks(args: {
  cliType: CliRuntimeSlug;
  chunks: RawCliChunk[];
}): RuntimeSlashCommand[] | null {
  return (
    getCliRuntime(args.cliType).extractSlashCommandsFromChunks?.(args.chunks) ??
    null
  );
}

export function getCostUsageFromIncomingChunks(args: {
  cliType: CliRuntimeSlug;
  chunks: RawCliChunk[];
  cliModel?: string;
  continuationId?: string;
  usageCursor?: CodexUsageCursor;
  modelState?: CodexModelState;
}): CostUsageExtraction | null {
  return (
    getCliRuntime(args.cliType).extractCostUsageFromChunks?.(args.chunks, {
      cliModel: args.cliModel,
      continuationId: args.continuationId,
      usageCursor: args.usageCursor,
      modelState: args.modelState,
    }) ?? null
  );
}
