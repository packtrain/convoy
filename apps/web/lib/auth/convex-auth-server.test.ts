import { afterEach, describe, expect, test, vi } from "vitest";

const urls = vi.hoisted(() => ({ server: [] as string[], nextjs: [] as string[], provider: [] as string[] }));
const signInMutation = vi.hoisted(() => vi.fn());

vi.mock("./auth-mode", () => ({ authMode: "convex" }));
vi.mock("@/convex/_generated/api", () => ({ api: { auth: {} } }));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = signInMutation;
  },
}));
vi.mock("@convex-dev/auth/ssr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/auth/ssr")>()),
  setupConvexAuthServer: ({ convexUrl }: { convexUrl: string }) => {
    urls.server.push(convexUrl);
    const handler = async () => new Response(null, { status: 200 });
    return { convexProxyHandler: handler, refreshHandler: handler, signOutHandler: handler };
  },
}));
vi.mock("@convex-dev/auth/ssr/nextjs", () => ({
  setupConvexAuthNextjs: ({ convexUrl }: { convexUrl: string }) => {
    urls.nextjs.push(convexUrl);
    return {
      convexAuthNextjsProxy: () => () => null,
      ConvexAuthNextjsServerProvider: () => urls.provider.push(convexUrl),
    };
  },
}));

describe("Convex Auth server setup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("server calls use CONVEX_SERVER_URL; the rendered provider keeps the browser's URL", async () => {
    // Self-hosted Docker: the browser reaches the backend on loopback, the web container by service name.
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210");
    vi.stubEnv("CONVEX_SERVER_URL", "http://backend:3210");
    const { convexAuthRoute, buildConvexAuthProxy, ConvexAuthServerProvider } = await import("./convex-auth-server");

    await convexAuthRoute("convexProxyHandler")(new Request("http://127.0.0.1:3000/auth/signin"));
    buildConvexAuthProxy(() => undefined);
    ConvexAuthServerProvider({ children: null });

    expect(urls.server).toEqual(["http://backend:3210"]);
    expect(urls.nextjs).toContain("http://backend:3210");
    expect(urls.provider).toEqual(["http://127.0.0.1:3210"]);
  });

  test("a password sign-in puts the refresh token in an httpOnly cookie", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    signInMutation.mockResolvedValue({
      status: "complete",
      tokens: { accessToken: "jwt", refreshToken: "refresh", refreshTokenExpiresAt: Date.now() + 60_000, userId: "u1" },
    });
    const { signInWithPasswordCookies } = await import("./convex-auth-server");

    const cookies = await signInWithPasswordCookies(new Request("https://app.example.com/x"), "a@b.c", "pw");
    const headers = new Headers();
    cookies?.applyTo(headers);

    const refreshCookie = headers.getSetCookie().find((cookie) => cookie.startsWith("__convexAuthRefreshToken="));
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/Secure/i);
  });

  test("a refused password sign-in sets no cookies", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210");
    signInMutation.mockResolvedValue({ status: "error", userError: { error: "INVALID_CREDENTIALS" } });
    const { signInWithPasswordCookies } = await import("./convex-auth-server");

    expect(await signInWithPasswordCookies(new Request("http://localhost/x"), "a@b.c", "pw")).toBeNull();
  });
});
