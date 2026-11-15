import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ options: undefined as undefined | { fetch: typeof fetch } }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class {
  constructor(_url: string, options: { fetch: typeof fetch }) { mocks.options = options; }
} }));
import { createConvexHttpClient } from "./convex-client.js";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("composes caller cancellation with the HTTP deadline", async () => {
  let received: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_input, init) => { received = init.signal; return new Response(); }));
  const abort = new AbortController();
  createConvexHttpClient({ url: "https://example.convex.cloud", apiKey: "secret" }, abort.signal);
  await mocks.options!.fetch("https://example.convex.cloud");
  expect(received?.aborted).toBe(false);
  abort.abort();
  expect(received?.aborted).toBe(true);
});
