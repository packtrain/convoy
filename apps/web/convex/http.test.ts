import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import * as apiKeysCore from "./apiKeys/core";
import { createTestContext } from "../convex-testing";
import { MIN_SUPPORTED_CLI_VERSION } from "./lib/http/registerBody";

const MINUTE = 60 * 1000;

/** convex-test runs `ctx.runMutation` through the export's `_handler`, so a spy counts the calls. */
function spyOnHandler(fn: unknown) {
  return vi.spyOn(fn as { _handler: (...args: unknown[]) => unknown }, "_handler");
}

async function setup(lastUsedAgoMs: number | undefined) {
  const ctx = createTestContext();
  const { project, user, asUser, t } = await ctx.setupProject();
  const key = await asUser.mutation(api.apiKeys.core.create, { name: "Usage", expiresAt: Date.now() + 86400000 });
  if (lastUsedAgoMs !== undefined) {
    await t.run((c) => c.db.patch("apiKeys", key.id, { lastUsedAt: Date.now() - lastUsedAgoMs }));
  }
  const profile = await ctx.cliProfile(user._id, project._id);
  const session = await ctx.cliSession(profile._id, key.id);
  const byId = spyOnHandler(apiKeysCore.recordUsageIfStale);
  const byKey = spyOnHandler(apiKeysCore.recordUsageByKeyIfStale);
  const usageCalls = () => byId.mock.calls.length + byKey.mock.calls.length;
  const post = (path: string, body: unknown) =>
    t.fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { project, session, post, usageCalls };
}

type Harness = Awaited<ReturnType<typeof setup>>;
const routes: Record<string, (h: Harness) => Promise<Response>> = {
  "/api/mcp": (h) => h.post("/api/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  "/api/agent/register": (h) =>
    h.post("/api/agent/register", { instanceId: "inst-1", projectId: h.project._id, appVersion: MIN_SUPPORTED_CLI_VERSION, force: true }),
  "/api/agent/heartbeat": (h) => h.post("/api/agent/heartbeat", { sessionId: h.session._id }),
};

afterEach(() => vi.restoreAllMocks());

describe("API key usage touch on HTTP routes (OS-2626)", () => {
  describe.each(Object.entries(routes))("%s", (_path, call) => {
    test.each([
      { label: "never used", lastUsedAgoMs: undefined, expected: 1 },
      { label: "used 1 minute ago", lastUsedAgoMs: MINUTE, expected: 0 },
      { label: "used 5 minutes ago", lastUsedAgoMs: 5 * MINUTE, expected: 1 },
    ])("$label → $expected usage mutation(s)", async ({ lastUsedAgoMs, expected }) => {
      const h = await setup(lastUsedAgoMs);
      const response = await call(h);
      expect(response.status).toBeLessThan(300);
      expect(h.usageCalls()).toBe(expected);
    });
  });

  test("back-to-back MCP requests run the usage mutation once", async () => {
    const h = await setup(undefined);
    await routes["/api/mcp"](h);
    await routes["/api/mcp"](h);
    expect(h.usageCalls()).toBe(1);
  });
});
