import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

async function client(t, elicitation = { form: {}, url: {} }) {
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], { stdio: ["pipe", "pipe", "inherit"] });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = (value) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
  const next = async () => JSON.parse((await lines.next()).value);
  send({ id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: elicitation === null ? {} : { elicitation } } });
  assert.equal((await next()).result.serverInfo.name, "convoy-elicitation-test");
  send({ method: "notifications/initialized" });
  return { send, next };
}

for (const mode of ["form", "url"]) {
  for (const action of ["accept", "decline", "cancel"]) {
    test(`${mode}: ${action} returns to the originating tool`, { timeout: 5000 }, async (t) => {
      const { send, next } = await client(t);
      send({ id: 2, method: "tools/call", params: { name: `test_${mode}`, arguments: {} } });
      const request = await next();
      assert.equal(request.method, "elicitation/create");
      assert.equal(request.params.mode, mode);
      if (mode === "form") assert.ok(request.params.requestedSchema.required.includes("nickname"));
      else assert.equal(request.params.url, "https://example.com/");
      const response = action === "accept" && mode === "form" ? { action, content: { nickname: "Tester", count: 2, color: "Blue", enabled: false } } : { action };
      send({ id: request.id, result: response });
      const reply = await next();
      assert.equal(reply.id, 2);
      assert.deepEqual(JSON.parse(reply.result.content[0].text), { mode, response });
    });
  }
}

test("unsupported capabilities return an actionable tool error", { timeout: 5000 }, async (t) => {
  const { send, next } = await client(t, null);
  send({ id: 2, method: "tools/call", params: { name: "test_form" } });
  assert.equal((await next()).result.isError, true);
});

test("parallel calls correlate reversed answers and cancel pending requests", { timeout: 5000 }, async (t) => {
  const { send, next } = await client(t);
  for (const id of [2, 3]) send({ id, method: "tools/call", params: { name: "test_form" } });
  const first = await next();
  const second = await next();
  send({ id: second.id, result: { action: "decline" } });
  assert.equal((await next()).id, 3);
  send({ method: "notifications/cancelled", params: { requestId: 2 } });
  assert.equal((await next()).params.requestId, first.id);
  send({ id: first.id, result: { action: "accept" } });
  send({ id: 4, method: "ping" });
  assert.equal((await next()).id, 4);
});

test("lists tools and supports legacy form capability", { timeout: 5000 }, async (t) => {
  const { send, next } = await client(t, {});
  send({ id: 2, method: "tools/list" });
  assert.deepEqual((await next()).result.tools.map((tool) => tool.name), ["test_form", "test_url"]);
  send({ id: 3, method: "tools/call", params: { name: "test_form" } });
  assert.equal((await next()).params.mode, "form");
});
