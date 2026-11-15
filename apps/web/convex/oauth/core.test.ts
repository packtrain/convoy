import { expect, test, describe } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { hashApiKey } from "../lib/access/apiKeys";
import { s256Challenge } from "./lib/pkce";
import { errors } from "./errors";

const CODE_VERIFIER = "test-code-verifier-test-code-verifier-test-1234";

type TestT = ReturnType<typeof createTestContext>["t"];

async function registerClient(t: TestT, redirectUris = ["http://localhost:33418/callback"]) {
  return t.mutation(internal.oauth.core.register, {
    clientName: "Claude Code",
    redirectUris,
  });
}

describe("oauth", () => {
  describe("register", () => {
    test("registers a public client", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      const { clientId } = await registerClient(t, [
        "http://localhost:33418/callback",
        "https://claude.ai/api/mcp/auth_callback",
      ]);
      expect(clientId).toMatch(/^[0-9a-f]{64}$/);

      await t.run(async (runCtx) => {
        const clients = await runCtx.db.query("oauthClients").collect();
        expect(clients).toHaveLength(1);
        expect(clients[0].clientName).toBe("Claude Code");
      });
    });

    test("rejects non-loopback http redirect URIs", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      await expect(registerClient(t, ["http://evil.example/callback"])).rejects.toThrow(
        errors.REDIRECT_URI_INVALID
      );
    });

    test("rejects an empty redirect URI list", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      await expect(registerClient(t, [])).rejects.toThrow(errors.REDIRECT_URIS_REQUIRED);
    });
  });

  describe("authorize → token", () => {
    test("full flow mints a key for the approving user, single-use", async () => {
      const ctx = createTestContext();
      const { user, asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t);
      const codeChallenge = await s256Challenge(CODE_VERIFIER);
      const redirectUri = "http://localhost:33418/callback";

      const { redirectTo } = await asUser.mutation(api.oauth.core.approve, {
        clientId,
        redirectUri,
        codeChallenge,
        responseType: "code",
        state: "abc123",
      });

      const redirect = new URL(redirectTo);
      expect(redirect.origin + redirect.pathname).toBe(redirectUri);
      expect(redirect.searchParams.get("state")).toBe("abc123");
      const code = redirect.searchParams.get("code");
      expect(code).toMatch(/^[0-9a-f]{64}$/);

      // Approve mints nothing
      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("apiKeys").collect()).toHaveLength(0);
      });

      const result = await t.mutation(internal.oauth.core.token, {
        code: code!,
        clientId,
        redirectUri,
        codeVerifier: CODE_VERIFIER,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.accessToken).toMatch(/^sk_user_/);

      await t.run(async (runCtx) => {
        const keys = await runCtx.db.query("apiKeys").collect();
        expect(keys).toHaveLength(1);
        expect(keys[0].userId).toBe(user._id);
        expect(keys[0].name).toBe("MCP (Claude Code)");
        expect(keys[0].keyHash).toBe(await hashApiKey(result.accessToken));
        // Row gone → single-use structurally
        expect(await runCtx.db.query("oauthAuthRequests").collect()).toHaveLength(0);
      });

      // Second exchange fails
      const again = await t.mutation(internal.oauth.core.token, {
        code: code!,
        clientId,
        redirectUri,
        codeVerifier: CODE_VERIFIER,
      });
      expect(again.ok).toBe(false);
    });

    test("loopback redirect URIs match on any port", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t, ["http://localhost:3000/callback"]);
      const codeChallenge = await s256Challenge(CODE_VERIFIER);

      const { redirectTo } = await asUser.mutation(api.oauth.core.approve, {
        clientId,
        redirectUri: "http://localhost:54321/callback",
        codeChallenge,
        responseType: "code",
      });
      expect(redirectTo).toContain("http://localhost:54321/callback");
    });

    test("rejects an unregistered redirect URI at approve", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t);
      const codeChallenge = await s256Challenge(CODE_VERIFIER);

      await expect(
        asUser.mutation(api.oauth.core.approve, {
          clientId,
          redirectUri: "https://evil.example/callback",
          codeChallenge,
          responseType: "code",
        })
      ).rejects.toThrow(errors.REDIRECT_URI_NOT_REGISTERED);
    });

    test("wrong code_verifier fails PKCE and mints nothing", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t);
      const redirectUri = "http://localhost:33418/callback";
      const codeChallenge = await s256Challenge(CODE_VERIFIER);

      const { redirectTo } = await asUser.mutation(api.oauth.core.approve, { clientId, redirectUri, codeChallenge, responseType: "code" });
      const code = new URL(redirectTo).searchParams.get("code")!;

      const result = await t.mutation(internal.oauth.core.token, {
        code,
        clientId,
        redirectUri,
        codeVerifier: "wrong-verifier-wrong-verifier-wrong-verifier-42",
      });

      expect(result).toMatchObject({ ok: false, error: "invalid_grant" });
      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("apiKeys").collect()).toHaveLength(0);
      });
    });

    test("redirect_uri mismatch at token exchange fails", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t, [
        "http://localhost:33418/callback",
        "https://claude.ai/api/mcp/auth_callback",
      ]);
      const redirectUri = "http://localhost:33418/callback";
      const codeChallenge = await s256Challenge(CODE_VERIFIER);

      const { redirectTo } = await asUser.mutation(api.oauth.core.approve, { clientId, redirectUri, codeChallenge, responseType: "code" });
      const code = new URL(redirectTo).searchParams.get("code")!;

      const result = await t.mutation(internal.oauth.core.token, {
        code,
        clientId,
        redirectUri: "https://claude.ai/api/mcp/auth_callback",
        codeVerifier: CODE_VERIFIER,
      });

      expect(result).toMatchObject({ ok: false, error: "invalid_grant" });
    });

    test("expired code fails", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t);
      const redirectUri = "http://localhost:33418/callback";
      const codeChallenge = await s256Challenge(CODE_VERIFIER);

      const { redirectTo } = await asUser.mutation(api.oauth.core.approve, { clientId, redirectUri, codeChallenge, responseType: "code" });
      const code = new URL(redirectTo).searchParams.get("code")!;

      await t.run(async (runCtx) => {
        const rows = await runCtx.db.query("oauthAuthRequests").collect();
        await runCtx.db.patch("oauthAuthRequests", rows[0]._id, { expiresAt: Date.now() - 1000 });
      });

      const result = await t.mutation(internal.oauth.core.token, {
        code,
        clientId,
        redirectUri,
        codeVerifier: CODE_VERIFIER,
      });

      expect(result).toMatchObject({ ok: false, error: "invalid_grant" });
    });

    test("malformed code_verifier is invalid_request", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      const result = await t.mutation(internal.oauth.core.token, {
        code: "whatever",
        clientId: "whatever",
        redirectUri: "http://localhost/cb",
        codeVerifier: "too-short",
      });

      expect(result).toMatchObject({ ok: false, error: "invalid_request" });
    });
  });

  describe("token audience + expiry", () => {
    test("minted key is kind mcp-oauth with a 30-day expiry", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t);
      const redirectUri = "http://localhost:33418/callback";
      const codeChallenge = await s256Challenge(CODE_VERIFIER);
      const { redirectTo } = await asUser.mutation(api.oauth.core.approve, { clientId, redirectUri, codeChallenge, responseType: "code" });
      const code = new URL(redirectTo).searchParams.get("code")!;

      const before = Date.now();
      const result = await t.mutation(internal.oauth.core.token, { code, clientId, redirectUri, codeVerifier: CODE_VERIFIER });
      if (!result.ok) throw new Error("token exchange failed");

      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(result.expiresInSeconds).toBe(Math.floor(thirtyDaysMs / 1000));

      await t.run(async (runCtx) => {
        const keys = await runCtx.db.query("apiKeys").collect();
        expect(keys[0].kind).toBe("mcp-oauth");
        expect(keys[0].expiresAt).toBeGreaterThanOrEqual(before + thirtyDaysMs);
      });

      // validateByKey surfaces the kind so non-MCP surfaces can reject it
      const validated = await t.query(internal.apiKeys.core.validateByKey, { apiKey: result.accessToken });
      expect(validated?.kind).toBe("mcp-oauth");
    });

    test("oauth mints past 100 existing keys", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      for (let i = 0; i < 100; i += 1) {
        await asUser.mutation(api.apiKeys.core.create, {
          name: `Manual ${i}`,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        });
      }

      const { clientId } = await registerClient(t);
      const redirectUri = "http://localhost:33418/callback";
      const codeChallenge = await s256Challenge(CODE_VERIFIER);
      const { redirectTo } = await asUser.mutation(api.oauth.core.approve, { clientId, redirectUri, codeChallenge, responseType: "code" });
      const code = new URL(redirectTo).searchParams.get("code")!;

      await expect(t.mutation(internal.oauth.core.token, { code, clientId, redirectUri, codeVerifier: CODE_VERIFIER })).resolves.toMatchObject({ ok: true });
    });
  });

  describe("registration hygiene", () => {
    test("identical re-registration reuses the existing client", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      const first = await registerClient(t);
      const second = await registerClient(t);
      expect(second.clientId).toBe(first.clientId);

      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("oauthClients").collect()).toHaveLength(1);
      });
    });

    test("rejects redirect URIs with fragments or credentials", async () => {
      const ctx = createTestContext();
      const { t } = await ctx.setupUser();

      await expect(registerClient(t, ["https://example.com/cb#frag"])).rejects.toThrow(errors.REDIRECT_URI_INVALID);
      await expect(registerClient(t, ["https://user:pw@example.com/cb"])).rejects.toThrow(errors.REDIRECT_URI_INVALID);
    });

    test("cleanupClient removes never-approved clients but keeps approved ones", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t);
      const abandoned = await t.mutation(internal.oauth.core.register, {
        clientName: "Abandoned",
        redirectUris: ["http://localhost:1234/cb"],
      });

      const codeChallenge = await s256Challenge(CODE_VERIFIER);
      await asUser.mutation(api.oauth.core.approve, {
        clientId,
        redirectUri: "http://localhost:33418/callback",
        codeChallenge,
        responseType: "code",
      });

      const clientDocIds = await t.run(async (runCtx) => {
        const clients = await runCtx.db.query("oauthClients").collect();
        return clients.map((client) => client._id);
      });
      for (const clientDocId of clientDocIds) {
        await t.mutation(internal.oauth.core.cleanupClient, { clientDocId });
      }

      await t.run(async (runCtx) => {
        const clients = await runCtx.db.query("oauthClients").collect();
        expect(clients).toHaveLength(1);
        expect(clients[0].clientId).toBe(clientId);
        expect(clients[0].clientId).not.toBe(abandoned.clientId);
      });
    });
  });

  describe("protocol validation", () => {
    test("approve rejects non-code response types", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t);
      const codeChallenge = await s256Challenge(CODE_VERIFIER);

      await expect(
        asUser.mutation(api.oauth.core.approve, {
          clientId,
          redirectUri: "http://localhost:33418/callback",
          codeChallenge,
          responseType: "token",
        })
      ).rejects.toThrow(errors.RESPONSE_TYPE_UNSUPPORTED);
    });

    test("loopback matching requires the same query string", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t, ["http://localhost:3000/cb?tenant=a"]);
      const codeChallenge = await s256Challenge(CODE_VERIFIER);

      await expect(
        asUser.mutation(api.oauth.core.approve, {
          clientId,
          redirectUri: "http://localhost:3000/cb?tenant=b",
          codeChallenge,
          responseType: "code",
        })
      ).rejects.toThrow(errors.REDIRECT_URI_NOT_REGISTERED);
    });
  });

  describe("getClient", () => {
    test("returns client info for the consent page, null when unknown", async () => {
      const ctx = createTestContext();
      const { asUser, t } = await ctx.setupUser();

      const { clientId } = await registerClient(t);

      const client = await asUser.query(api.oauth.core.getClient, { clientId });
      expect(client).toMatchObject({ clientName: "Claude Code" });

      const unknown = await asUser.query(api.oauth.core.getClient, { clientId: "nope" });
      expect(unknown).toBeNull();
    });
  });
});
