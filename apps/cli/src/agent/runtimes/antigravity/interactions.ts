import { randomUUID } from "node:crypto";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import type { InteractionBridge, InteractionRequestInput } from "../contracts.js";
import {
  ACP_PERMISSION_CANCELLED,
  type AcpPermissionOption,
  type AcpPermissionReply,
  type AcpPermissionRequest,
} from "../acp/client.js";

/** agy permission requests ↔ web approval and question cards. Spec: docs/specs/cli-antigravity-runtime.md. */

const SECURITY_WARNING_KEY = "agy.security.warning";

/** Web decision → option kinds to try, nearest first. Anything else is `cancelled`. */
const DECISION_KINDS: Record<string, string[]> = {
  allow: ["allow_once", "allow_always"],
  "allow-always": ["allow_always", "allow_once"],
  deny: ["reject_once", "reject_always"],
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const selected = (option: AcpPermissionOption | undefined): AcpPermissionReply =>
  option ? { outcome: { outcome: "selected", optionId: option.optionId } } : ACP_PERMISSION_CANCELLED;

const byKind = (options: AcpPermissionOption[], kinds: string[]) =>
  kinds.map((kind) => options.find((option) => option.kind === kind)).find(Boolean);

/** A question rides on the permission method; its options are choices, not approvals (t3code). */
const isQuestion = (request: AcpPermissionRequest) => request.toolCall.toolCallId.startsWith("interaction_");

function securityWarning(options: AcpPermissionOption[]): string | undefined {
  const warning = options.find((option) => option.kind === "allow_always")?._meta?.[SECURITY_WARNING_KEY];
  return isRecord(warning) ? (getString(warning.message) ?? getString(warning.title)) : undefined;
}

function approvalPayload(request: AcpPermissionRequest) {
  const { toolCall, options } = request;
  const input = isRecord(toolCall.rawInput) ? toolCall.rawInput : {};
  const command = getString(input.CommandLine);
  const filePath = getString(input.Path);
  const toolName = getString(toolCall.name) ?? getString(toolCall.title) ?? "a tool";
  const title =
    toolCall.kind === "execute"
      ? "Antigravity wants to run a command"
      : toolCall.kind === "edit"
        ? "Antigravity wants to edit a file"
        : `Antigravity wants to use ${toolName}`;
  const description = securityWarning(options);
  return {
    toolName,
    title,
    ...(description ? { description } : {}),
    inputJson: JSON.stringify({ ...(command ? { command } : {}), ...(filePath ? { file_path: filePath } : {}), ...input }),
    hasSuggestions: options.some((option) => option.kind === "allow_always"),
  };
}

function questionPayload(request: AcpPermissionRequest) {
  return {
    toolName: "AskUserQuestion",
    questions: [
      {
        id: request.toolCall.toolCallId,
        header: "",
        question: getString(request.toolCall.title) ?? "Choose an option.",
        multiSelect: false,
        isOther: false,
        options: request.options.map((option) => ({ label: option.name || option.optionId })),
      },
    ],
  };
}

function approvalReply(request: AcpPermissionRequest, response: Record<string, unknown>): AcpPermissionReply {
  const kinds = DECISION_KINDS[getString(response.decision) ?? ""];
  return kinds ? selected(byKind(request.options, kinds)) : ACP_PERMISSION_CANCELLED;
}

/** The picked label maps back to its option id; an ambiguous or unknown label cancels. */
function questionReply(request: AcpPermissionRequest, response: Record<string, unknown>): AcpPermissionReply {
  const answer = isRecord(response.answers) ? response.answers[request.toolCall.toolCallId] : undefined;
  const matches = request.options.filter((option) => (option.name || option.optionId) === answer);
  return matches.length === 1 ? selected(matches[0]) : ACP_PERMISSION_CANCELLED;
}

/** Without a bridge: `allow_once` for tools, `cancelled` for questions (slice 1). */
function answerWithoutUser(request: AcpPermissionRequest): AcpPermissionReply {
  return isQuestion(request) ? ACP_PERMISSION_CANCELLED : selected(byKind(request.options, DECISION_KINDS.allow!));
}

export function createAntigravityInteractions(options: { bridge?: InteractionBridge; signal: AbortSignal }) {
  const pending = new Map<string, AbortController>();
  let promptOpen = false;

  const ask = async (kind: InteractionRequestInput["kind"], payload: object): Promise<Record<string, unknown> | null> => {
    const { bridge, signal } = options;
    if (!bridge || signal.aborted) return null;
    const requestId = randomUUID();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    pending.set(requestId, controller);
    try {
      const response = parseJson(await bridge.request({ requestId, kind, payloadJson: JSON.stringify(payload) }, controller.signal));
      return isRecord(response) ? response : {};
    } catch {
      // Still pending means the run, not agy, ended the request.
      if (pending.has(requestId)) bridge.cancel(requestId, { abandoned: true, reason: "run ended" });
      return null;
    } finally {
      pending.delete(requestId);
      signal.removeEventListener("abort", abort);
    }
  };

  return {
    pendingCount: () => pending.size,

    startPrompt(): void {
      promptOpen = true;
    },

    /** agy answered the last prompt: requests still open are withdrawn, not abandoned. Later ones still ask. */
    endPrompt(): void {
      if (options.signal.aborted) return;
      for (const [requestId, controller] of pending) {
        pending.delete(requestId);
        options.bridge?.cancel(requestId, { abandoned: false, reason: "prompt ended" });
        controller.abort();
      }
    },

    async onRequestPermission(request: AcpPermissionRequest): Promise<AcpPermissionReply> {
      if (!promptOpen) return ACP_PERMISSION_CANCELLED;
      if (!options.bridge) return answerWithoutUser(request);
      if (isQuestion(request)) {
        const response = await ask("question", questionPayload(request));
        return response ? questionReply(request, response) : ACP_PERMISSION_CANCELLED;
      }
      const response = await ask("tool-approval", approvalPayload(request));
      return response ? approvalReply(request, response) : ACP_PERMISSION_CANCELLED;
    },
  };
}
