import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(join(tmpdir(), "credential-failure-"));
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock("node:fs");
  fs.rmSync(directory, { recursive: true, force: true });
});

it.each(["rename", "marker"])("recovers from an initial %s failure", async (failure) => {
  let fail = true;
  vi.doMock("node:fs", () => ({
    ...fs,
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (fail && failure === "rename") throw new Error("injected rename failure");
      fs.renameSync(from, to);
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (fail && failure === "marker" && args[1] === "1\n") throw new Error("injected marker failure");
      return fs.writeFileSync(...args);
    },
  }));
  const { CredentialStore } = await import("./store.js");
  const store = new CredentialStore(directory);
  expect(() => store.mutate(() => {})).toThrow(/injected/);
  fail = false;
  expect(() => store.mutate(() => {})).not.toThrow();
  expect(store.read().generation).toBe(1);
});

it("retains an existing marker and committed store when a later rename fails", async () => {
  let fail = false;
  vi.doMock("node:fs", () => ({
    ...fs,
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (fail) throw new Error("injected rename failure");
      fs.renameSync(from, to);
    },
  }));
  const { CredentialStore } = await import("./store.js");
  const store = new CredentialStore(directory);
  store.mutate(() => {});
  fail = true;
  expect(() => store.mutate(() => {})).toThrow();
  expect(fs.existsSync(store.file + ".enabled")).toBe(true);
  expect(store.read().generation).toBe(1);
});
