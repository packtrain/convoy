import { z } from "zod";
import { validMcpForm } from "../validators.js";
import { randomUUID } from "node:crypto";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import type { InteractionBridge, InteractionRequestInput } from "../contracts.js";

function safeJsonParse(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Web tool-approval response → codex approval decision. */
export function toCodexApprovalDecision(responseJson: string): "accept" | "acceptForSession" | "decline" {
  const parsed = safeJsonParse(responseJson);
  const decision = isRecord(parsed) ? getString(parsed.decision) : undefined;
  if (decision === "allow") {
    return "accept";
  }
  if (decision === "allow-always") {
    return "acceptForSession";
  }
  return "decline";
}

export interface CodexUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
  isOther?: boolean;
  isSecret?: boolean;
}

/** `item/tool/requestUserInput` questions → typed entries (unknown shapes dropped). */
export function parseCodexUserInputQuestions(value: unknown): CodexUserInputQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry): CodexUserInputQuestion | null => {
      if (!isRecord(entry)) {
        return null;
      }
      const id = getString(entry.id);
      const question = getString(entry.question);
      if (!id || !question) {
        return null;
      }
      const options = Array.isArray(entry.options)
        ? entry.options
            .map((option) => {
              if (!isRecord(option)) {
                return null;
              }
              const label = getString(option.label);
              return label ? { label, description: getString(option.description) ?? "" } : null;
            })
            .filter((option): option is { label: string; description: string } => option !== null)
        : [];
      return {
        id,
        question,
        header: getString(entry.header) ?? "",
        options,
        ...(typeof entry.isOther === "boolean" ? { isOther: entry.isOther } : {}),
        ...(typeof entry.isSecret === "boolean" ? { isSecret: entry.isSecret } : {}),
      };
    })
    .filter((entry): entry is CodexUserInputQuestion => entry !== null);
}

/** Prefer provider IDs; accept question text from older web clients. */
export function toCodexUserInputAnswers(
  questions: CodexUserInputQuestion[],
  responseJson: string
): { answers: Record<string, { answers: string[] }> } {
  const parsed = safeJsonParse(responseJson);
  const answers = isRecord(parsed) && isRecord(parsed.answers) ? parsed.answers : {};
  const result: Record<string, { answers: string[] }> = {};
  for (const question of questions) {
    const value = getString(answers[question.id]) ?? getString(answers[question.question]);
    const allowed =
      question.isOther !== false || question.options.length === 0 || question.options.some((option) => option.label === value);
    Object.defineProperty(result, question.id, { value: { answers: value && allowed ? [value] : [] }, enumerable: true });
  }
  return { answers: result };
}

function approvalDecisions(params: Record<string, unknown>): unknown[] {
  return Array.isArray(params.availableDecisions) ? params.availableDecisions : ["accept", "acceptForSession", "decline", "cancel"];
}

function approvalResponse(params: Record<string, unknown>, response: Record<string, unknown>) {
  const decisions = approvalDecisions(params);
  const index = response.decisionIndex;
  const choice =
    typeof index === "number" && Number.isInteger(index) && index >= 0
      ? decisions[index]
      : toCodexApprovalDecision(JSON.stringify(response));
  return { decision: decisions.includes(choice) && choice !== undefined ? choice : "decline" };
}

export function createCodexInteractions(options: {
  bridge?: InteractionBridge;
  signal: AbortSignal;
  pendingBlockingIds: Set<string>;
  sendMessage: (threadId: string, turnId: string, text: string) => Promise<unknown>;
}) {
  const pending = new Map<string, { requestId: string; controller: AbortController; threadId: unknown; turnId: unknown }>();
  const seenAsyncItems = new Set<string>();
  const keyFor = (threadId: unknown, id: unknown) => JSON.stringify([threadId, id]);

  const ask = async (
    key: string,
    params: Record<string, unknown>,
    kind: InteractionRequestInput["kind"],
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> => {
    if (!options.bridge || options.signal.aborted) return null;
    const requestId = randomUUID();
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    pending.set(key, { requestId, controller, threadId: params.threadId, turnId: params.turnId });
    if (payload.isBlocking !== false) options.pendingBlockingIds.add(requestId);
    try {
      const response = safeJsonParse(
        await options.bridge.request({ requestId, kind, payloadJson: JSON.stringify(payload) }, controller.signal)
      );
      if (controller.signal.aborted) return null;
      return isRecord(response) ? response : {};
    } catch {
      if (pending.has(key)) options.bridge.cancel(requestId, { abandoned: true, reason: "run ended" });
      return null;
    } finally {
      pending.delete(key);
      options.pendingBlockingIds.delete(requestId);
      options.signal.removeEventListener("abort", abort);
    }
  };

  const cancel = (key: string, reason: string) => {
    const request = pending.get(key);
    if (!request) return;
    pending.delete(key);
    options.bridge?.cancel(request.requestId, { abandoned: false, reason });
    request.controller.abort();
  };

  return {
    async onRequest(method: string, params: Record<string, unknown>, providerRequestId: unknown, changes?: unknown): Promise<unknown> {
      const key = keyFor(params.threadId, providerRequestId);
      const context = { provider: "codex", providerRequestId, threadId: params.threadId, turnId: params.turnId, itemId: params.itemId };
      if (method === "item/tool/requestUserInput") {
        const questions = parseCodexUserInputQuestions(params.questions);
        if (!questions.length) return { answers: {} };
        const response = await ask(key, params, "question", {
          ...context,
          toolName: "AskUserQuestion",
          isBlocking: params.isBlocking !== false,
          responseMode: "rpc",
          questions,
        });
        return response ? toCodexUserInputAnswers(questions, JSON.stringify(response)) : { answers: {} };
      }
      if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
        const command = method === "item/commandExecution/requestApproval";
        const response = await ask(key, params, "tool-approval", {
          ...params,
          ...context,
          toolName: command ? "Shell" : "Apply changes",
          title: command ? "Codex wants to run a command" : "Codex wants to edit files",
          description: params.reason,
          inputJson: JSON.stringify(
            command
              ? { command: params.command ?? "", cwd: params.cwd ?? null }
              : { changes: changes ?? [], reason: params.reason, grantRoot: params.grantRoot }
          ),
          availableDecisions: approvalDecisions(params),
        });
        return response ? approvalResponse(params, response) : { decision: options.bridge ? "cancel" : "decline" };
      }
      if (method === "item/permissions/requestApproval") {
        const response = await ask(key, params, "tool-approval", {
          ...params,
          ...context,
          toolName: "Permissions",
          title: "Codex requests permissions",
          description: params.reason,
          inputJson: JSON.stringify(params.permissions),
          hasSuggestions: true,
          permissionRequest: true,
        });
        const allowed = response?.decision === "allow" || response?.decision === "allow-always";
        const permissions =
          allowed && isRecord(params.permissions)
            ? Object.fromEntries(
                Object.entries(params.permissions).filter(([key, value]) => (key === "network" || key === "fileSystem") && isRecord(value))
              )
            : {};
        return { permissions, scope: allowed && response?.decision === "allow-always" ? "session" : "turn" };
      }
      if (method === "mcpServer/elicitation/request") {
        const response = await ask(key, params, "question", { ...params, ...context, elicitation: true, isBlocking: true });
        const action = response?.action;
        const url = typeof params.url === "string" ? z.url({ protocol: /^https?$/ }).safeParse(params.url) : null;
        const accepted =
          action === "accept" &&
          (params.mode === "url" ? url?.success === true : params.mode === "form" && validMcpForm(params.requestedSchema, response?.content));
        return {
          action: accepted ? "accept" : action === "cancel" || (!response && !!options.bridge) ? "cancel" : "decline",
          content: accepted && params.mode !== "url" ? response?.content : null,
          _meta: null,
        };
      }
      // These require host execution/auth contracts separate from interactive requests.
      throw new Error(`Unsupported codex app-server request "${method}"`);
    },

    onNotification(method: string, params: Record<string, unknown>): void {
      if (method === "serverRequest/resolved") {
        cancel(keyFor(params.threadId, params.requestId), "provider resolved request");
        return;
      }
      if (method === "turn/completed") {
        const turnId = isRecord(params.turn) ? params.turn.id : params.turnId;
        for (const [key, request] of pending) {
          if (request.threadId === params.threadId && request.turnId === turnId) cancel(key, "turn completed");
        }
        return;
      }
      const item = params.item;
      if (
        method !== "item/completed" ||
        !isRecord(item) ||
        item.type !== "agentMessage" ||
        item.delivery !== "async" ||
        !Array.isArray(item.questions)
      )
        return;
      if (typeof params.threadId !== "string" || typeof params.turnId !== "string" || typeof item.id !== "string") return;
      const key = keyFor(params.threadId, [params.turnId, item.id]);
      if (seenAsyncItems.has(key)) return;
      seenAsyncItems.add(key);
      const questions = item.questions.filter(isRecord).flatMap((question, index) =>
        typeof question.title === "string"
          ? [
              {
                id: `${item.id}:${index}`,
                question: question.title,
                header: "",
                isOther: true,
                isSecret: false,
                options: Array.isArray(question.options)
                  ? question.options
                      .filter((value): value is string => typeof value === "string")
                      .map((label) => ({ label, description: "" }))
                  : [],
              },
            ]
          : []
      );
      if (!questions.length) return;
      const threadId = params.threadId;
      const turnId = params.turnId;
      void ask(key, params, "question", {
        provider: "codex",
        threadId,
        turnId,
        itemId: item.id,
        text: item.text,
        isBlocking: false,
        responseMode: "message",
        questions,
      })
        .then(async (response) => {
          if (!response || options.signal.aborted) return;
          const { answers } = toCodexUserInputAnswers(questions, JSON.stringify(response));
          const lines = questions.flatMap((question) =>
            answers[question.id]?.answers.length ? [`${question.question}\n${answers[question.id]!.answers.join(", ")}`] : []
          );
          if (lines.length) await options.sendMessage(threadId, turnId, lines.join("\n\n"));
        })
        .catch(() => {
          /* A completed or interrupted turn rejects late steering. */
        });
    },
  };
}
