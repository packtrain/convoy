import { beforeEach, describe, expect, test, vi } from "vitest";

const signIn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/auth-mode", () => ({ authMode: "convex", isLocalDemoAuthMode: false }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));
vi.mock("@/lib/auth/convex-auth-server", () => ({ signInWithPasswordCookies: signIn }));

const URL_BASE = "http://localhost:3000/api/agent/browser-login";

describe("agent browser login in Convex Auth mode", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    signIn.mockReset();
    vi.stubEnv("CONVOY_AGENT_BROWSER_LOGIN_ENABLED", "true");
    vi.stubEnv("CONVOY_AGENT_BROWSER_AUTH_SECRET", "s3cret");
    vi.stubEnv("CONVOY_AGENT_BROWSER_USER_EMAIL", "agent@example.com");
    vi.stubEnv("CONVOY_AGENT_BROWSER_USER_PASSWORD", "agent-password");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  });

  test("GET signs the agent in with its password and redirects with the session cookies", async () => {
    signIn.mockImplementation(async () => ({
      applyTo: (headers: Headers) => headers.append("set-cookie", "__convexAuthJWT=token; Path=/; HttpOnly"),
    }));
    const { GET } = await import("./route");

    const response = await GET(new Request(`${URL_BASE}?secret=s3cret&redirect_url=/o/acme`));

    expect(signIn).toHaveBeenCalledWith(expect.any(Request), "agent@example.com", "agent-password");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/auth/callback?redirect_url=%2Fo%2Facme");
    expect(response.headers.get("set-cookie")).toContain("__convexAuthJWT=token");
  });

  test("the redirect stays on the host that received the cookies, not the copied app URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.convoy.localhost");
    vi.stubEnv("CONVOY_AGENT_BROWSER_ALLOWED_HOSTS", "feature.app.convoy.localhost");
    signIn.mockImplementation(async () => ({ applyTo: () => {} }));
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://feature.app.convoy.localhost/api/agent/browser-login?secret=s3cret&redirect_url=/o/acme")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/auth/callback?redirect_url=%2Fo%2Facme");
  });

  test("a wrong secret answers 401 without signing in", async () => {
    const { GET } = await import("./route");

    const response = await GET(new Request(`${URL_BASE}?secret=wrong`));

    expect(response.status).toBe(401);
    expect(signIn).not.toHaveBeenCalled();
  });

  test("POST is refused: the cookies would land in the caller, not the agent's browser", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request(URL_BASE, { method: "POST", headers: { "x-convoy-agent-browser-secret": "s3cret" } })
    );

    expect(response.status).toBe(405);
    expect(signIn).not.toHaveBeenCalled();
  });

  test("answers 404 without a configured password", async () => {
    vi.stubEnv("CONVOY_AGENT_BROWSER_USER_PASSWORD", "");
    const { GET } = await import("./route");

    const response = await GET(new Request(`${URL_BASE}?secret=s3cret`));

    expect(response.status).toBe(404);
    expect(signIn).not.toHaveBeenCalled();
  });

  test("answers 401 when the password sign-in is refused", async () => {
    signIn.mockResolvedValue(null);
    const { GET } = await import("./route");

    const response = await GET(new Request(`${URL_BASE}?secret=s3cret`));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
