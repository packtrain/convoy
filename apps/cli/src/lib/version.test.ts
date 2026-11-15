import { spawnSync } from "node:child_process";
import { describe, it, expect, vi, afterEach } from "vitest";
import { checkForNewerVersion, getCliVersion } from "./version.js";

function mockFetch(impl: () => unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => impl()));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkForNewerVersion", () => {
  it("returns the npm version when it is newer", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ version: "999.0.0" }) }));
    await expect(checkForNewerVersion()).resolves.toBe("999.0.0");
  });

  it("returns null when npm matches the running version", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ version: getCliVersion() }),
    }));
    await expect(checkForNewerVersion()).resolves.toBeNull();
  });

  it("returns null when npm is older (local dev build)", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ version: "0.0.1" }) }));
    await expect(checkForNewerVersion()).resolves.toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    mockFetch(() => ({ ok: false, json: async () => ({}) }));
    await expect(checkForNewerVersion()).resolves.toBeNull();
  });

  it("returns null on an unexpected payload", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ version: 42 }) }));
    await expect(checkForNewerVersion()).resolves.toBeNull();
  });

  it("returns null when the network fails", async () => {
    mockFetch(() => {
      throw new Error("offline");
    });
    await expect(checkForNewerVersion()).resolves.toBeNull();
  });

  // A stalled fetch can hold no event-loop handle; the timeout must keep the CLI alive.
  it("settles on its timeout when the stalled fetch holds the process open with nothing", () => {
    const moduleUrl = new URL("./version.ts", import.meta.url).href;
    const script = `globalThis.fetch = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      const { checkForNewerVersion } = await import(${JSON.stringify(moduleUrl)});
      console.log(String(await checkForNewerVersion(50)));`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf-8" });
    expect({ status: child.status, stdout: child.stdout.trim() }).toEqual({ status: 0, stdout: "null" });
  });
});
