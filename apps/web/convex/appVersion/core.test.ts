/// <reference types="vite/client" />
import { afterEach, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

const ENV_KEYS = [
  "CONVOY_BACKEND_BUILD_ID",
  "CONVOY_BACKEND_BUILD_TIME",
  "CONVOY_BACKEND_GIT_REF",
  "CONVOY_BACKEND_VERCEL_ENV",
  "CONVEX_SITE_URL",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const originalValue = originalEnv[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
});

describe("appVersion.core", () => {
  test("returns configured backend version metadata", async () => {
    process.env.CONVOY_BACKEND_BUILD_ID = "backend-build-123456";
    process.env.CONVOY_BACKEND_BUILD_TIME = "2026-05-31T12:00:00.000Z";
    process.env.CONVOY_BACKEND_GIT_REF = "main";
    process.env.CONVOY_BACKEND_VERCEL_ENV = "production";

    const ctx = createTestContext();

    await expect(ctx.t.query(api.appVersion.core.get, {})).resolves.toEqual({
      buildId: "backend-build-123456",
      buildTime: "2026-05-31T12:00:00.000Z",
      gitRef: "main",
      vercelEnvironment: "production",
    });
  });

  test("falls back to development when build id is unset", async () => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }

    const ctx = createTestContext();

    await expect(
      ctx.t.query(api.appVersion.core.get, {})
    ).resolves.toMatchObject({
      buildId: "development",
    });
  });

  test("returns the HTTP actions origin the backend serves", async () => {
    process.env.CONVEX_SITE_URL = "http://127.0.0.1:3213";

    const ctx = createTestContext();

    await expect(ctx.t.query(api.appVersion.core.siteUrl, {})).resolves.toBe("http://127.0.0.1:3213");
  });

  test("returns null when the backend does not know its HTTP actions origin", async () => {
    delete process.env.CONVEX_SITE_URL;

    const ctx = createTestContext();

    await expect(ctx.t.query(api.appVersion.core.siteUrl, {})).resolves.toBeNull();
  });
});
