import type { Readable, Writable } from "node:stream";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import { createJsonRpc } from "../json-rpc.js";

/** Typed Agent Client Protocol calls over JSON-RPC 2.0 stdio. Protocol only, no agent quirks. */

/** ACP error code an agent answers `session/new` with when it needs sign-in. */
export const ACP_AUTH_REQUIRED_CODE = -32000;

export interface AcpInitializeResult {
  protocolVersion?: number;
  agentCapabilities?: Record<string, unknown>;
  agentInfo?: { name?: string; version?: string };
  authMethods?: Array<{ id: string; name?: string }>;
}

export interface AcpPromptResult {
  stopReason: string;
  usage?: unknown;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  /** `allow_once`, `allow_always`, `reject_once` or `reject_always`. */
  kind: string;
  _meta?: Record<string, unknown>;
}

/** `session/request_permission` params. `toolCall` is a tool call update. */
export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: Record<string, unknown> & { toolCallId: string };
  options: AcpPermissionOption[];
}

export type AcpPermissionReply = {
  outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
};

export const ACP_PERMISSION_CANCELLED: AcpPermissionReply = { outcome: { outcome: "cancelled" } };

/** Null when the tool call id is missing or an option id is empty or repeated. */
export function parseAcpPermissionRequest(params: Record<string, unknown>): AcpPermissionRequest | null {
  const toolCall = isRecord(params.toolCall) ? params.toolCall : {};
  if (typeof toolCall.toolCallId !== "string" || !Array.isArray(params.options)) return null;
  const options: AcpPermissionOption[] = [];
  for (const option of params.options) {
    if (!isRecord(option) || typeof option.optionId !== "string" || !option.optionId.trim()) return null;
    if (options.some((seen) => seen.optionId === option.optionId)) return null;
    options.push({
      optionId: option.optionId,
      name: typeof option.name === "string" ? option.name : "",
      kind: typeof option.kind === "string" ? option.kind : "",
      ...(isRecord(option._meta) ? { _meta: option._meta } : {}),
    });
  }
  return {
    sessionId: typeof params.sessionId === "string" ? params.sessionId : "",
    toolCall: { ...toolCall, toolCallId: toolCall.toolCallId },
    options,
  };
}

export interface AcpClientHandlers {
  onSessionUpdate(params: Record<string, unknown>): void;
  /** Never sees a malformed request; the client answers those `cancelled`. */
  onRequestPermission(request: AcpPermissionRequest): Promise<AcpPermissionReply>;
}

export interface AcpClient {
  initialize(clientCapabilities: Record<string, unknown>): Promise<AcpInitializeResult>;
  authenticate(methodId: string): Promise<void>;
  newSession(params: { cwd: string; _meta?: Record<string, unknown> }): Promise<{ sessionId: string }>;
  resumeSession(params: { sessionId: string; cwd: string; _meta?: Record<string, unknown> }): Promise<void>;
  prompt(sessionId: string, text: string): Promise<AcpPromptResult>;
  cancel(sessionId: string): void;
  close(reason?: string): void;
}

export function createAcpClient(
  io: { stdin: Writable; stdout: Readable },
  handlers: AcpClientHandlers,
  label: string
): AcpClient {
  const rpc = createJsonRpc(
    io,
    {
      onNotification: (method, params) => {
        if (method === "session/update") handlers.onSessionUpdate(params);
      },
      onRequest: async (method, params) => {
        if (method !== "session/request_permission") throw new Error(`Unsupported ACP request "${method}"`);
        const request = parseAcpPermissionRequest(params);
        return request ? handlers.onRequestPermission(request) : ACP_PERMISSION_CANCELLED;
      },
    },
    { label, envelope: true }
  );

  return {
    async initialize(clientCapabilities) {
      const result = await rpc.request("initialize", { protocolVersion: 1, clientCapabilities });
      return isRecord(result) ? (result as AcpInitializeResult) : {};
    },
    async authenticate(methodId) {
      await rpc.request("authenticate", { methodId });
    },
    async newSession({ cwd, _meta }) {
      const result = await rpc.request("session/new", { cwd, mcpServers: [], ...(_meta ? { _meta } : {}) });
      const sessionId = isRecord(result) && typeof result.sessionId === "string" ? result.sessionId : "";
      if (!sessionId) throw new Error(`${label} did not return a session id`);
      return { sessionId };
    },
    async resumeSession({ sessionId, cwd, _meta }) {
      await rpc.request("session/resume", { sessionId, cwd, mcpServers: [], ...(_meta ? { _meta } : {}) });
    },
    async prompt(sessionId, text) {
      const result = await rpc.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
      const stopReason = isRecord(result) && typeof result.stopReason === "string" ? result.stopReason : "end_turn";
      return { stopReason, ...(isRecord(result) && result.usage !== undefined ? { usage: result.usage } : {}) };
    },
    cancel(sessionId) {
      rpc.notify("session/cancel", { sessionId });
    },
    close(reason) {
      rpc.close(reason);
    },
  };
}
