import { withFirstMessageAgentInstructions } from "../agent-instructions.js";
import { getDebugLevel } from "../debug.js";
import {
  RunnerExecutionError,
  type CliMode,
  type CliRuntimeRunner,
  type ContentChunk,
  type InteractionBridge,
  type RunnerExecutionOptions,
  type RunnerExecutionResult,
} from "../contracts.js";
import {
  connectOpencode,
  type OpencodeClientLike,
  type OpencodeModelRef,
  type OpencodePermissionRule,
} from "./client.js";
import { getRecord, getString, safeJsonParse } from "./json.js";
import { getOpencodeServer, type OpencodeServerHandle } from "./server.js";
import type { OpencodeAuth } from "../../../lib/config/credentials/validators.js";

/** No SDK events for this long mid-run fails the run. */
const IDLE_TIMEOUT_MS = 600_000;
const IDLE_CHECK_INTERVAL_MS = 30_000;
/**
 * An idle status that arrives this soon after the prompt (with no activity
 * seen) is treated as a stale pre-turn status, not turn completion.
 */
const EARLY_IDLE_GRACE_MS = 5_000;

const CONTEXT_LIMIT_TTL_MS = 300_000;
const MAX_CONTEXT_LIMITS = 256;
const contextLimits = new WeakMap<OpencodeServerHandle, Map<string, { value: number; expiresAt: number }>>();

// Runners end between follow-ups; server identity survives until restart.
async function getContextLimit(
  server: OpencodeServerHandle,
  directory: string,
  model: OpencodeModelRef,
  client: OpencodeClientLike,
): Promise<number | undefined> {
  let cache = contextLimits.get(server);
  if (!cache) {
    cache = new Map();
    contextLimits.set(server, cache);
  }
  const key = JSON.stringify([directory, model.providerID, model.modelID]);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  cache.delete(key);

  const inventory = await client.listProviders(AbortSignal.timeout(2_000)).catch(() => null);
  const value = inventory?.all.find((provider) => provider.id === model.providerID)
    ?.models[model.modelID]?.limit?.context;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;

  if (cache.size >= MAX_CONTEXT_LIMITS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CONTEXT_LIMIT_TTL_MS });
  return value;
}

const AGENT_RULESET: OpencodePermissionRule[] = [
  { permission: "*", pattern: "*", action: "allow" },
];

const ASK_PERMISSIONS = [
  "*",
  "bash",
  "edit",
  "webfetch",
  "websearch",
  "codesearch",
  "external_directory",
  "doom_loop",
] as const;

const ASK_RULESET: OpencodePermissionRule[] = [
  ...ASK_PERMISSIONS.map(
    (permission): OpencodePermissionRule => ({
      permission,
      pattern: "*",
      action: "ask",
    }),
  ),
  // Questions are their own interactive channel, never a permission prompt.
  { permission: "question", pattern: "*", action: "allow" },
];

/**
 * Thread mode → OpenCode session permission ruleset. `agent` (and unset)
 * matches Claude's bypassPermissions trust level; every other mode asks and
 * surfaces approvals through the interaction bridge.
 */
export function rulesetForMode(mode: CliMode | undefined): OpencodePermissionRule[] {
  if (mode === undefined || mode === "agent") {
    return AGENT_RULESET;
  }
  return ASK_RULESET;
}

/** `providerID/modelID` run-model slug → promptAsync model reference. */
export function parseOpencodeModelRef(
  runModel: string | undefined,
): OpencodeModelRef | undefined {
  if (!runModel) {
    return undefined;
  }
  const separator = runModel.indexOf("/");
  if (separator <= 0 || separator === runModel.length - 1) {
    return undefined;
  }
  return {
    providerID: runModel.slice(0, separator),
    modelID: runModel.slice(separator + 1),
  };
}

/**
 * Commands Convoy executes for OpenCode outside `command.list()` (OS-1614).
 * OpenCode's inventory only covers template commands, but the server can
 * compact a session through its own endpoint, so `/compact` is advertised and
 * dispatched separately. Keep this the single source of truth for both sides.
 */
const OPENCODE_BUILTIN_COMMANDS = ["compact"] as const;

export function isOpencodeBuiltinCommand(command: string): boolean {
  return (OPENCODE_BUILTIN_COMMANDS as readonly string[]).includes(command);
}

/** Advertised inventory: template commands plus the executable built-ins. */
export function withOpencodeBuiltinCommands(commands: string[]): string[] {
  const extras = OPENCODE_BUILTIN_COMMANDS.filter(
    (builtin) => !commands.includes(builtin),
  );
  return [...commands, ...extras];
}

/**
 * `/compact` for OpenCode: the summarize endpoint requires an explicit model,
 * so a thread on the default model resolves the session's own model and falls
 * back to the machine's provider default.
 */
async function compactOpencodeSession(
  client: OpencodeClientLike,
  sessionID: string,
  resolvedCliModel: string | undefined,
): Promise<void> {
  const model =
    parseOpencodeModelRef(resolvedCliModel) ??
    (await client.getSessionModel(sessionID).catch(() => null)) ??
    (await client.getDefaultModel().catch(() => null));
  if (!model) {
    throw new Error(
      "OpenCode could not resolve a model to compact this thread with. Pick a model in the composer and try again.",
    );
  }
  await client.compactSession({ sessionID, model });
}

function debugLog(kind: string, payload: string): void {
  if (getDebugLevel() < 1) {
    return;
  }
  console.log(`[OpenCode:${kind}] ${payload.slice(0, 400)}`);
}

type ParsedEvent = {
  type: string;
  properties: Record<string, unknown>;
  raw: unknown;
};

function parseEvent(event: unknown): ParsedEvent | null {
  const obj = getRecord(event);
  const type = getString(obj?.type);
  if (!obj || !type) {
    return null;
  }
  return { type, properties: getRecord(obj.properties) ?? {}, raw: event };
}

function eventSessionId(parsed: ParsedEvent): string | undefined {
  return getString(parsed.properties.sessionID);
}

function rawChunk(parsed: ParsedEvent): ContentChunk {
  return { type: parsed.type, data: JSON.stringify(parsed.raw) };
}

/** Latest assistant usage. Spec: docs/specs/cli-thread-context-window-meter.md. */
function readContextUsage(info: Record<string, unknown> | null) {
  if (info?.role !== "assistant") return null;
  const providerID = getString(info.providerID);
  const modelID = getString(info.modelID);
  const tokens = getRecord(info.tokens);
  const cache = getRecord(tokens?.cache);
  const quantities = [tokens?.input, tokens?.output, tokens?.reasoning, cache?.read, cache?.write];
  if (!providerID || !modelID || !quantities.every(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
  )) return null;
  if (quantities[1] <= 0) return null;
  const usedTokens = quantities.reduce((sum, value) => sum + value, 0);
  return Number.isFinite(usedTokens) ? { providerID, modelID, usedTokens } : null;
}

function errorMessageFromSessionError(
  properties: Record<string, unknown>,
): string {
  const error = getRecord(properties.error);
  const data = getRecord(error?.data);
  return (
    getString(data?.message) ??
    getString(error?.name) ??
    "OpenCode reported a session error."
  );
}

type QuestionPayloadOption = { label: string; description: string };
type QuestionPayloadEntry = {
  question: string;
  header: string;
  options: QuestionPayloadOption[];
  multiSelect: boolean;
};

function toQuestionPayloadEntries(value: unknown): QuestionPayloadEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): QuestionPayloadEntry | null => {
      const record = getRecord(item);
      if (!record) {
        return null;
      }
      const options = Array.isArray(record.options)
        ? record.options
            .map((option): QuestionPayloadOption | null => {
              const optionRecord = getRecord(option);
              const label = getString(optionRecord?.label);
              if (!optionRecord || !label) {
                return null;
              }
              return {
                label,
                description: getString(optionRecord.description) ?? "",
              };
            })
            .filter((option): option is QuestionPayloadOption => option !== null)
        : [];
      return {
        question: getString(record.question) ?? "",
        header: getString(record.header) ?? "",
        options,
        // The web question card uses Claude's `multiSelect` field name.
        multiSelect: record.multiple === true,
      };
    })
    .filter((entry): entry is QuestionPayloadEntry => entry !== null);
}

/**
 * Segment a ", "-joined selection back into known option labels. Labels may
 * themselves contain ", ", so greedy longest-label matching (with
 * backtracking) is used; null when the value is not exactly a joined
 * sequence of known labels.
 */
export function segmentJoinedLabels(
  value: string,
  labels: readonly string[],
): string[] | null {
  const byLengthDesc = [...labels].sort((a, b) => b.length - a.length);

  const segment = (rest: string): string[] | null => {
    for (const label of byLengthDesc) {
      if (rest === label) {
        return [label];
      }
      if (rest.startsWith(`${label}, `)) {
        const tail = segment(rest.slice(label.length + 2));
        if (tail) {
          return [label, ...tail];
        }
      }
    }
    return null;
  };

  return value.length > 0 ? segment(value) : null;
}

/**
 * Web answers (`{ [questionText]: "label1, label2" }`) → OpenCode's ordered
 * per-question label arrays. The joined value is segmented against known
 * option labels; anything that is not exactly a sequence of known labels
 * (custom answers, or a mixed label + custom selection) passes through
 * whole rather than dropping selections.
 */
export function toOpencodeQuestionAnswers(
  questions: QuestionPayloadEntry[],
  answers: Record<string, unknown>,
): string[][] {
  return questions.map((question) => {
    const value = getString(answers[question.question]);
    if (!value) {
      return [];
    }
    const labels = question.options.map((option) => option.label);
    return segmentJoinedLabels(value, labels) ?? [value];
  });
}

export interface OpencodeRunnerDeps {
  getServer?: (auth?: OpencodeAuth) => Promise<OpencodeServerHandle>;
  connect?: (args: { baseUrl: string; directory: string; password: string }) => OpencodeClientLike;
}

/** Request headers outrank the inline apiKey, so any on an assigned provider could bill another account (OS-2018). */
async function managedHeaderOverride(client: OpencodeClientLike, auth: OpencodeAuth): Promise<string | undefined> {
  const config = await client.getProviderConfig();
  const slot = Object.keys(auth.mode === "managed" ? auth.keys : {}).find((id) =>
    [config[id]?.options, ...Object.values(config[id]?.models ?? {})].some((entry) => Object.keys(entry?.headers ?? {}).length > 0));
  return slot && `OpenCode config sets headers for ${slot}, which override Convoy's key. Remove them, or unassign the key and restore native login.`;
}

export function createOpencodeRunner(
  factoryOptions?: { partialStreaming?: boolean; opencodeAuth?: OpencodeAuth },
  deps?: OpencodeRunnerDeps,
): CliRuntimeRunner {
  const partialStreaming = factoryOptions?.partialStreaming ?? false;
  const opencodeAuth = factoryOptions?.opencodeAuth;
  const getServer = deps?.getServer ?? getOpencodeServer;
  const connect = deps?.connect ?? connectOpencode;

  let aborted = false;
  let activeClient: OpencodeClientLike | null = null;
  let activeSessionId: string | null = null;
  let activeStreamAbort: AbortController | null = null;

  const abort = (): void => {
    aborted = true;
    const client = activeClient;
    const sessionId = activeSessionId;
    if (client && sessionId) {
      void client.abortSession(sessionId).catch(() => {});
    }
    activeStreamAbort?.abort();
  };

  return {
    async *execute(
      workingDirectory: string,
      prompt: string,
      options: RunnerExecutionOptions,
    ): AsyncGenerator<ContentChunk, RunnerExecutionResult, unknown> {
      aborted = false;
      if (opencodeAuth?.mode === "disabled") {
        throw new RunnerExecutionError("OpenCode is disabled for this project. Assign a key or explicitly restore native login.", { continuationId: options.continuationId });
      }
      const provider = opencodeAuth && parseOpencodeModelRef(options.resolvedCliModel)?.providerID;
      if (provider && !Object.hasOwn(opencodeAuth.keys, provider)) {
        throw new RunnerExecutionError(`No usable ${provider} key in this project. Check convoy keys status.`, { continuationId: options.continuationId });
      }
      const failRun = (error: unknown): never => {
        throw new RunnerExecutionError(error instanceof Error ? error.message : String(error), { continuationId: options.continuationId });
      };
      const server = await getServer(opencodeAuth).catch(failRun);
      const client = connect({ baseUrl: server.url, directory: workingDirectory, password: server.password });
      const override = opencodeAuth && await managedHeaderOverride(client, opencodeAuth).catch(failRun);
      if (override) failRun(new Error(override));
      activeClient = client;

      const streamAbort = new AbortController();
      activeStreamAbort = streamAbort;

      let sessionId = options.continuationId ?? null;

      // Track streaming reconciliation per part: OpenCode emits BOTH
      // cumulative snapshots (message.part.updated) and incremental deltas
      // (message.part.delta); only exact suffixes may stream out.
      const partKindById = new Map<string, "text" | "reasoning">();
      const emittedTextByPartId = new Map<string, string>();
      const runningToolPartIds = new Set<string>();

      // Bridge requests answered after the run ends must be withdrawn.
      const bridge: InteractionBridge | undefined = options.interactionBridge;
      const pendingInteractionIds = new Set<string>();

      let sawActivity = false;
      let earlyIdleSeen = false;
      let promptSentAt = Number.MAX_SAFE_INTEGER;
      let completed = false;
      let failureMessage: string | null = null;
      let idleTimedOut = false;
      let lastEventAt = Date.now();
      let contextUsage: ReturnType<typeof readContextUsage> = null;

      const idleWatchdog = setInterval(() => {
        // A run parked on a web approval/question emits nothing while the
        // user thinks; that is not idleness (OS-1463, matching OS-1458 for
        // Claude). Re-arm instead of killing the very run the user is
        // deciding about.
        if (pendingInteractionIds.size > 0) {
          lastEventAt = Date.now();
          return;
        }
        if (Date.now() - lastEventAt > IDLE_TIMEOUT_MS) {
          idleTimedOut = true;
          streamAbort.abort();
        }
      }, IDLE_CHECK_INTERVAL_MS);
      idleWatchdog.unref?.();

      const handleIdleSignal = (): void => {
        // A stale idle can arrive once right after prompting, before the
        // turn actually starts; require activity or a grace period. A SECOND
        // idle means the turn really finished (possibly instantly, without a
        // busy status) — never wait for the 10-minute watchdog.
        if (
          sawActivity ||
          earlyIdleSeen ||
          Date.now() - promptSentAt > EARLY_IDLE_GRACE_MS
        ) {
          completed = failureMessage === null;
          return;
        }
        earlyIdleSeen = true;
      };

      const handlePermissionAsked = (
        properties: Record<string, unknown>,
      ): void => {
        const requestId = getString(properties.id);
        if (!requestId) {
          return;
        }
        if (!bridge) {
          // No interactive-approval support on this connection; a parked
          // permission would hang the session forever.
          debugLog("permission", `auto-rejecting ${requestId} (no bridge)`);
          void client.replyPermission(requestId, "reject").catch(() => {});
          return;
        }

        const permission = getString(properties.permission) ?? "a tool";
        const patterns = Array.isArray(properties.patterns)
          ? properties.patterns.filter(
              (pattern): pattern is string => typeof pattern === "string",
            )
          : [];
        const payloadJson = JSON.stringify({
          toolName: permission,
          inputJson: JSON.stringify(properties.metadata ?? {}),
          title: `OpenCode wants to run ${permission}`,
          ...(patterns.length > 0 ? { description: patterns.join(", ") } : {}),
          // OpenCode supports "always" natively; show the Always allow button.
          hasSuggestions: true,
        });

        pendingInteractionIds.add(requestId);
        bridge
          .request(
            { requestId, kind: "tool-approval", payloadJson },
            streamAbort.signal,
          )
          .then((responseJson) => {
            const response = getRecord(safeJsonParse(responseJson));
            const decision = getString(response?.decision);
            const reply =
              decision === "allow"
                ? ("once" as const)
                : decision === "allow-always"
                  ? ("always" as const)
                  : ("reject" as const);
            return client.replyPermission(requestId, reply);
          })
          .catch(() => {
            bridge.cancel(requestId, { abandoned: true, reason: "run ended" });
            void client.replyPermission(requestId, "reject").catch(() => {});
          })
          .finally(() => {
            pendingInteractionIds.delete(requestId);
          });
      };

      const handleQuestionAsked = (
        properties: Record<string, unknown>,
      ): void => {
        const requestId = getString(properties.id);
        if (!requestId) {
          return;
        }
        const questions = toQuestionPayloadEntries(properties.questions);
        if (!bridge || questions.length === 0) {
          debugLog("question", `rejecting ${requestId} (no bridge or questions)`);
          void client.rejectQuestion(requestId).catch(() => {});
          return;
        }

        const payloadJson = JSON.stringify({
          toolName: "AskUserQuestion",
          questions,
        });

        pendingInteractionIds.add(requestId);
        bridge
          .request({ requestId, kind: "question", payloadJson }, streamAbort.signal)
          .then((responseJson) => {
            const response = getRecord(safeJsonParse(responseJson));
            const answers = getRecord(response?.answers);
            if (!answers) {
              return client.rejectQuestion(requestId);
            }
            return client.replyQuestion(
              requestId,
              toOpencodeQuestionAnswers(questions, answers),
            );
          })
          .catch(() => {
            bridge.cancel(requestId, { abandoned: true, reason: "run ended" });
            void client.rejectQuestion(requestId).catch(() => {});
          })
          .finally(() => {
            pendingInteractionIds.delete(requestId);
          });
      };

      /** Streamable suffix chunks for an in-flight text/reasoning part. */
      function* emitStreamingDelta(
        partId: string,
        kind: "text" | "reasoning",
        deltaText: string,
      ): Generator<ContentChunk> {
        if (!partialStreaming || deltaText.length === 0 || !sessionId) {
          return;
        }
        yield {
          type: kind === "reasoning" ? "reasoning.delta" : "text.delta",
          data: JSON.stringify({ sessionID: sessionId, partID: partId, text: deltaText }),
        };
      }

      function* handlePartUpdated(parsed: ParsedEvent): Generator<ContentChunk> {
        const part = getRecord(parsed.properties.part);
        const partId = getString(part?.id);
        if (!part || !partId) {
          return;
        }
        sawActivity = true;

        const partType = getString(part.type);
        const time = getRecord(part.time);
        const isCompleted = time?.end !== undefined && time?.end !== null;

        if (partType === "text" || partType === "reasoning") {
          partKindById.set(partId, partType);
          const snapshotText = getString(part.text) ?? "";
          const emitted = emittedTextByPartId.get(partId) ?? "";

          if (isCompleted) {
            emittedTextByPartId.delete(partId);
            partKindById.delete(partId);
            yield rawChunk(parsed);
            return;
          }

          // In-flight snapshot: stream only the new suffix; a snapshot that
          // no longer extends what we emitted resets tracking (revert).
          if (snapshotText.startsWith(emitted)) {
            const suffix = snapshotText.slice(emitted.length);
            emittedTextByPartId.set(partId, snapshotText);
            yield* emitStreamingDelta(partId, partType, suffix);
          } else {
            emittedTextByPartId.set(partId, snapshotText);
          }
          return;
        }

        if (partType === "tool") {
          const state = getRecord(part.state);
          const status = getString(state?.status);
          if (status === "running") {
            // OpenCode repeats running updates (title/progress); one
            // tool-input chunk per part is enough.
            if (runningToolPartIds.has(partId)) {
              return;
            }
            runningToolPartIds.add(partId);
            yield rawChunk(parsed);
            return;
          }
          if (status === "completed" || status === "error") {
            runningToolPartIds.delete(partId);
            yield rawChunk(parsed);
          }
          return;
        }

        if (partType === "step-finish") {
          yield rawChunk(parsed);
        }
      }

      function* handlePartDelta(parsed: ParsedEvent): Generator<ContentChunk> {
        const partId = getString(parsed.properties.partID);
        const field = getString(parsed.properties.field);
        const delta = getString(parsed.properties.delta);
        if (!partId || field !== "text" || delta === undefined) {
          return;
        }
        sawActivity = true;

        const kind = partKindById.get(partId) ?? "text";
        const emitted = emittedTextByPartId.get(partId) ?? "";
        emittedTextByPartId.set(partId, emitted + delta);
        yield* emitStreamingDelta(partId, kind, delta);
      }

      try {
        // Subscribe before prompting so no events are missed.
        const events = await client.subscribeEvents(streamAbort.signal);

        // Advertise the directory's command inventory to the backend as a
        // synthetic chunk (captured into cliRuntimeFacts server-side, same
        // path as Claude's system/init). Fail-soft: discovery must never
        // fail the run.
        const commands = await client.listCommands().catch(() => null);
        // `compact` is not a `command.list()` entry — it is the dedicated
        // summarize endpoint (OS-1614) — but it is executable, so it belongs
        // in the advertised inventory. Advertised even when command.list()
        // fails, since executing it does not depend on that call.
        yield {
          type: "convoy.commands",
          data: JSON.stringify({
            commands: withOpencodeBuiltinCommands(commands ?? []),
          }),
        };

        if (!sessionId) {
          const session = await client.createSession({
            title: "Convoy thread",
            permission: rulesetForMode(options.cliMode),
          });
          sessionId = session.id;
        }
        activeSessionId = sessionId;

        if (options.runtimeCommand) {
          const runtimeCommand = options.runtimeCommand;
          const failRun = (error: unknown): void => {
            if (aborted || completed || failureMessage !== null) {
              return;
            }
            failureMessage =
              error instanceof Error ? error.message : String(error);
            streamAbort.abort();
          };
          // Both calls resolve only when the turn completes, so neither is
          // awaited here — the event loop below streams the turn and detects
          // completion via the idle signal, as with promptAsync.
          if (isOpencodeBuiltinCommand(runtimeCommand.command)) {
            void compactOpencodeSession(client, sessionId, options.resolvedCliModel).catch(failRun);
          } else {
            void client
              .commandAsync({
                sessionID: sessionId,
                command: runtimeCommand.command,
                arguments: runtimeCommand.arguments,
                model: parseOpencodeModelRef(options.resolvedCliModel),
                variant: options.resolvedCliEffort,
              })
              .catch(failRun);
          }
        } else {
          await client.promptAsync({
            sessionID: sessionId,
            model: parseOpencodeModelRef(options.resolvedCliModel),
            // OpenCode's built-in plan agent is the read-only planning mode;
            // there is no approve-plan gate (unlike Claude's ExitPlanMode).
            agent: options.cliMode === "plan" ? "plan" : undefined,
            variant: options.resolvedCliEffort,
            // First-message agent prompt delivery: fresh sessions only (the
            // per-message `system` field would replace opencode's default
            // prompt, so the delimited block rides in the prompt text).
            text: withFirstMessageAgentInstructions(prompt, options),
          });
        }
        promptSentAt = Date.now();

        for await (const event of events) {
          lastEventAt = Date.now();
          const parsed = parseEvent(event);
          if (!parsed || eventSessionId(parsed) !== sessionId) {
            continue;
          }
          debugLog(parsed.type, JSON.stringify(parsed.properties));

          switch (parsed.type) {
            case "message.updated": {
              const usage = readContextUsage(getRecord(parsed.properties.info));
              if (usage) contextUsage = usage;
              break;
            }
            case "message.part.updated":
              yield* handlePartUpdated(parsed);
              break;
            case "message.part.delta":
              yield* handlePartDelta(parsed);
              break;
            case "permission.asked":
              handlePermissionAsked(parsed.properties);
              break;
            case "question.asked":
              handleQuestionAsked(parsed.properties);
              break;
            case "permission.replied":
            case "question.replied":
            case "question.rejected":
            case "session.compacted": // Emitted by `/compact` (OS-1614); rendered as the compaction row.
              yield rawChunk(parsed);
              break;
            case "session.error":
              failureMessage = errorMessageFromSessionError(parsed.properties);
              yield rawChunk(parsed);
              break;
            case "session.status": {
              const status = getRecord(parsed.properties.status);
              const statusType = getString(status?.type);
              if (statusType === "busy") {
                sawActivity = true;
                break;
              }
              if (statusType === "retry") {
                yield rawChunk(parsed);
                break;
              }
              if (statusType === "idle") {
                handleIdleSignal();
              }
              break;
            }
            case "session.idle": {
              handleIdleSignal();
              break;
            }
            default:
              break;
          }

          if (completed || failureMessage !== null) {
            break;
          }
        }
        if (completed && contextUsage && !aborted) {
          const snapshot = contextUsage;
          const maxTokens = await getContextLimit(server, workingDirectory, snapshot, client);
          if (!aborted && maxTokens !== undefined) {
            yield { type: "convoy.context_usage", data: JSON.stringify({ usedTokens: snapshot.usedTokens, maxTokens }) };
          }
        }
      } catch (error) {
        // Stream aborts surface as errors; flags decide the real outcome.
        if (!aborted && !idleTimedOut && failureMessage === null && !completed) {
          const message = error instanceof Error ? error.message : String(error);
          throw new RunnerExecutionError(`OpenCode run failed: ${message}`, {
            continuationId: sessionId ?? undefined,
          });
        }
      } finally {
        clearInterval(idleWatchdog);
        streamAbort.abort();
        for (const requestId of pendingInteractionIds) {
          bridge?.cancel(requestId, { abandoned: true, reason: "run ended" });
        }
        pendingInteractionIds.clear();
        if (activeStreamAbort === streamAbort) {
          activeStreamAbort = null;
        }
        if (activeClient === client) {
          activeClient = null;
          activeSessionId = null;
        }
      }

      if (aborted) {
        throw new RunnerExecutionError("OpenCode run aborted", {
          continuationId: sessionId ?? undefined,
        });
      }
      if (idleTimedOut) {
        throw new RunnerExecutionError(
          `OpenCode produced no events for ${Math.round(IDLE_TIMEOUT_MS / 60_000)} minutes and the run was terminated.`,
          { continuationId: sessionId ?? undefined },
        );
      }
      if (failureMessage !== null) {
        throw new RunnerExecutionError(failureMessage, {
          continuationId: sessionId ?? undefined,
        });
      }
      if (!completed) {
        throw new RunnerExecutionError(
          "OpenCode event stream ended before the session went idle.",
          { continuationId: sessionId ?? undefined },
        );
      }

      return sessionId ? { continuationId: sessionId } : {};
    },

    abort,

    async shutdown(): Promise<void> {
      // Per-thread runner teardown; the shared serve process is owned by the
      // agent lifecycle (see server.ts shutdownOpencodeServer).
      abort();
    },
  };
}
