/**
 * Vitest setup for Convex tests. Suppresses expected scheduler warnings: convex-test
 * doesn't fully support `ctx.scheduler.runAfter`, so scheduled callbacks try to write
 * after the test transaction ended.
 */

import { afterEach, vi } from "vitest";

// Convex sets this on every deployment; Convex Auth token issuers derive from it.
process.env.CONVEX_CLOUD_URL ??= "https://some-deployment.convex.cloud";

// Captured before any vi.useFakeTimers() so the flush below never hangs.
const realSetTimeout = globalThis.setTimeout;

// Let setTimeout(0) unmount callbacks (Radix FocusScope) run while jsdom is alive (OS-1925).
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  await new Promise((resolve) => realSetTimeout(resolve, 0));
});

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  usePathname: () =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () =>
    new URLSearchParams(
      typeof window === "undefined" ? "" : window.location.search
    ),
}));

// Suppress unhandled rejection errors from scheduled functions
process.on("unhandledRejection", (reason: unknown) => {
  // Check if this is the expected convex-test scheduler error
  if (
    reason instanceof Error &&
    reason.message.includes("Write outside of transaction") &&
    reason.message.includes("_scheduled_functions")
  ) {
    // Silently ignore - this is expected behavior when testing mutations
    // that use ctx.scheduler.runAfter()
    return;
  }

  // Re-throw other unhandled rejections
  throw reason;
});

// Suppress TimeoutOverflowWarning for 30-day scheduler delays
// The warning occurs because 2592000000ms (30 days) doesn't fit in a 32-bit int
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalEmit = process.emit.bind(process) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(process.emit as any) = function (event: string, ...args: unknown[]) {
  if (
    event === "warning" &&
    args[0] instanceof Error &&
    args[0].name === "TimeoutOverflowWarning"
  ) {
    // Silently ignore timeout overflow warnings
    return false;
  }
  return originalEmit(event, ...args);
};
