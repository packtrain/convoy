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

export interface AcpClientHandlers {
  onSessionUpdate(params: Record<string, unknown>): void;
  /** Answers `session/request_permission` with the full `{ outcome }` result. */
  onRequestPermission(params: Record<string, unknown>): Promise<unknown>;
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
      onRequest: (method, params) =>
        method === "session/request_permission"
          ? handlers.onRequestPermission(params)
          : Promise.reject(new Error(`Unsupported ACP request "${method}"`)),
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
