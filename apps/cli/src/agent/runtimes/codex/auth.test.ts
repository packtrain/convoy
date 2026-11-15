import { describe, it, expect, vi } from "vitest";
import { redactAuth } from "../../../lib/config/convex-client.js";
import { checkNativeCodexAuth, authenticateCodex, managedAuthArgs, managedAuthEnv, redactAuthParams } from "./auth.js";
import type { AppServerRpc } from "./app-server-rpc.js";
const auth = { mode: "managed" as const, secret: "sentinel-api-key" };
function rpc(
  config: unknown = { config: { cli_auth_credentials_store: "ephemeral", forced_login_method: "api", model_provider: "openai" } }
) {
  const methods: string[] = [];
  const request = vi.fn(async (method: string) => {
    methods.push(method);
    return method === "config/read" ? config : method === "account/read" ? { account: { type: "apiKey" } } : { type: "apiKey" };
  });
  return { client: { request, notify: vi.fn(), close: vi.fn() } satisfies AppServerRpc, methods };
}
describe("managed Codex authentication", () => {
  it("redacts structured values without corrupting JSON syntax", () => {
    expect(redactAuthParams({ message: 'contains " quote' }, '"')).toEqual({
      message: "contains [redacted] quote",
    });
  });
  it("requires ephemeral API configuration then authenticates over RPC", async () => {
    const { client, methods } = rpc();
    await authenticateCodex(client, auth);
    expect(methods).toEqual(["config/read", "account/login/start", "account/read"]);
    expect(client.request).toHaveBeenCalledWith("account/login/start", { type: "apiKey", apiKey: auth.secret });
    expect(managedAuthArgs(auth).join(" ")).not.toContain(auth.secret);
    expect(managedAuthArgs(auth).some((arg) => arg.startsWith("model_providers.openai."))).toBe(false);
    expect(managedAuthArgs(auth)).toContain('cli_auth_credentials_store="ephemeral"');
  });
  it("does not send the key to an incompatible auth configuration", async () => {
    const { client, methods } = rpc({ config: { cli_auth_credentials_store: "file" } });
    await expect(authenticateCodex(client, auth)).rejects.toThrow("setup failed");
    expect(methods).toEqual(["config/read"]);
  });
  it("removes competing inherited auth without modifying the worker environment", () => {
    const env = {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "other",
      OPENAI_BASE_URL: "http://other",
      CODEX_ACCESS_TOKEN: "other",
      OPENAI_FEDERATION_RULE_ID: "other",
      CODEX_HOME: "/private",
    };
    expect(managedAuthEnv(env, auth)).toEqual({ PATH: "/usr/bin", CODEX_HOME: "/private" });
    expect(env.OPENAI_API_KEY).toBe("other");
    expect(redactAuth(`failed ${auth.secret}`, auth.secret)).toBe("failed [redacted]");
  });
  it("does not expose provider-reflected credentials in errors", async () => {
    const { client } = rpc();
    client.request.mockRejectedValueOnce(new Error(auth.secret));
    await expect(authenticateCodex(client, auth)).rejects.not.toThrow(auth.secret);
  });
  it("redacts JSON-escaped credential values", () => {
    const escaped = { mode: "managed" as const, secret: 'key"with\\escape' };
    expect(redactAuth(JSON.stringify({ error: escaped.secret }), escaped.secret)).toBe('{"error":"[redacted]"}');
  });
  it("rejects overrides of the reserved OpenAI provider", async () => {
    const { client, methods } = rpc({
      config: {
        cli_auth_credentials_store: "ephemeral",
        forced_login_method: "api",
        model_provider: "openai",
        model_providers: { openai: { base_url: "https://elsewhere.invalid" } },
      },
    });
    await expect(authenticateCodex(client, auth)).rejects.toThrow("setup failed");
    expect(methods).toEqual(["config/read"]);
  });
  it("does not authenticate native mode", async () => {
    const { client } = rpc();
    await authenticateCodex(client, { mode: "native" });
    expect(client.request).not.toHaveBeenCalled();
  });
});

it.each(["http://127.0.0.1:1/v1", "https://proxy.example/v1"])(
  "rejects effective endpoint %s before sending the key",
  async (openai_base_url) => {
    const { client, methods } = rpc({
      config: { cli_auth_credentials_store: "ephemeral", forced_login_method: "api", model_provider: "openai", openai_base_url },
    });
    await expect(authenticateCodex(client, auth)).rejects.toThrow("setup failed");
    expect(methods).toEqual(["config/read"]);
  }
);

describe("native Codex authentication evidence", () => {
  it.each([
    { account: null, requiresOpenaiAuth: false },
    { account: { type: "chatgpt" }, requiresOpenaiAuth: true },
    { account: null },
    {},
    null,
  ])("does not infer missing login from %j", async (response) => {
    const client = { request: vi.fn().mockResolvedValue(response), notify: vi.fn(), close: vi.fn() };
    await expect(checkNativeCodexAuth(client)).resolves.toBeUndefined();
    expect(client.request).toHaveBeenCalledWith("account/read", { refreshToken: false });
  });

  it("ignores an unsupported account probe", async () => {
    const client = { request: vi.fn().mockRejectedValue(new Error("method not found")), notify: vi.fn(), close: vi.fn() };
    await expect(checkNativeCodexAuth(client)).resolves.toBeUndefined();
  });

  it("bounds a silent account probe", async () => {
    vi.useFakeTimers();
    try {
      const client = { request: vi.fn(() => new Promise(() => {})), notify: vi.fn(), close: vi.fn() };
      const probe = checkNativeCodexAuth(client);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(probe).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
