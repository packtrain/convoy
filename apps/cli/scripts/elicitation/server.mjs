import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

// Local stdio fixture only. Protocol and manual checks: README.md in this folder.
const pending = new Map();
let capabilities = {};
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const result = (id, value) => send({ id, result: value });
const fail = (id, code, message) => send({ id, error: { code, message } });
const toolResult = (id, value, isError = false) => result(id, {
  content: [{ type: "text", text: JSON.stringify(value) }], isError,
});
const tools = ["form", "url"].map((mode) => ({
  name: `test_${mode}`,
  description: `Trigger a real MCP ${mode} elicitation for Convoy testing. Wait for the human response and echo it. No files or accounts are changed.`,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}));

function handle(message) {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;
  if (!message.method) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    toolResult(request.callId, message.error ? { error: message.error } : {
      mode: request.mode, response: message.result,
    }, !!message.error);
    return;
  }
  const { id, method, params = {} } = message;
  if (method === "notifications/cancelled") {
    for (const [requestId, request] of pending) {
      if (request.callId !== params.requestId) continue;
      pending.delete(requestId);
      send({ method: "notifications/cancelled", params: { requestId, reason: "Tool call cancelled" } });
    }
    return;
  }
  if (id === undefined) return;
  if (method === "initialize") {
    capabilities = params.capabilities ?? {};
    result(id, {
      protocolVersion: ["2025-03-26", "2025-06-18", "2025-11-25"].includes(params.protocolVersion)
        ? params.protocolVersion : "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "convoy-elicitation-test", version: "1.0.0" },
    });
    return;
  }
  if (method === "ping") return result(id, {});
  if (method === "tools/list") return result(id, { tools });
  if (method !== "tools/call") return fail(id, -32601, `Unknown method: ${method}`);
  const mode = params.name === "test_form" ? "form" : params.name === "test_url" ? "url" : null;
  if (!mode) return fail(id, -32602, "Unknown tool");
  const elicitation = capabilities.elicitation;
  const supported = elicitation && (mode === "url" ? !!elicitation.url
    : !!elicitation.form || Object.keys(elicitation).length === 0);
  if (!supported) return toolResult(id, { error: `Client did not advertise ${mode} elicitation support.` }, true);
  if (Object.keys(params.arguments ?? {}).length) return fail(id, -32602, "This tool takes no arguments");
  const requestId = randomUUID();
  pending.set(requestId, { callId: id, mode });
  send({ id: requestId, method: "elicitation/create", params: mode === "url" ? {
    mode, elicitationId: requestId, url: "https://example.com/",
    message: "URL test only: open Example Domain, return here, and choose Continue. No login or browser completion callback is involved.",
  } : {
    mode, message: "Convoy test form. Use made-up values. Submit, Decline, or Cancel; the tool echoes your response.",
    requestedSchema: {
      type: "object",
      properties: {
        nickname: { type: "string", title: "Nickname", minLength: 2, maxLength: 30 },
        count: { type: "integer", title: "Count (1–5)", minimum: 1, maximum: 5, default: 2 },
        color: { type: "string", title: "Color", enum: ["Blue", "Green", "Red"], default: "Blue" },
        enabled: { type: "boolean", title: "Enable test option", default: false },
      },
      required: ["nickname", "count", "color"],
    },
  } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { fail(null, -32700, "Invalid JSON"); return; }
  handle(message);
}).on("close", () => { pending.clear(); });
