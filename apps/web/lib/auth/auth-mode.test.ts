import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function modeFor(value: string) {
  vi.stubEnv("NEXT_PUBLIC_AUTH_MODE", value);
  return (await import("./auth-mode")).authMode;
}

test("a build that sets no mode runs Convex Auth", async () => {
  expect(await modeFor("")).toBe("convex");
});

test("an explicit mode wins", async () => {
  expect(await modeFor("clerk")).toBe("clerk");
});
