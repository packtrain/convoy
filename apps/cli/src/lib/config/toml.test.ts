import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "convoy-toml-"));
  vi.resetModules();
  vi.doMock("node:os", async () => ({ ...await vi.importActual<typeof os>("node:os"), homedir: () => home }));
});
afterEach(() => {
  vi.doUnmock("node:os");
  vi.doUnmock("node:fs");
  fs.rmSync(home, { recursive: true, force: true });
});

describe("config persistence", () => {
  it("does not try opening a directory for fsync on Windows", async () => {
    vi.doMock("node:fs", async () => ({
      ...await vi.importActual<typeof fs>("node:fs"),
      openSync: (file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
        if (String(file).endsWith(path.join(".config", "convoy"))) throw Object.assign(new Error("Windows directory handle"), { code: "EPERM" });
        return fs.openSync(file, flags, mode);
      },
    }));
    const config = await import("./toml.js");
    const platform = process.platform;
    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      expect(() => config.setProfile("a", { name: "A", url: "https://example.com", api_key: "secret", project_id: "a", paths: ["C:\\repo"] })).not.toThrow();
    } finally { Object.defineProperty(process, "platform", { value: platform }); }
  });
  it("preserves updates from concurrent CLI processes", async () => {
    const config = await import("./toml.js");
    const moduleUrl = new URL("./toml.ts", import.meta.url).href;
    await Promise.all(["one", "two", "three", "four"].map((key) => new Promise<void>((resolve, reject) => {
      const script = `import { setProfile } from ${JSON.stringify(moduleUrl)}; setProfile(${JSON.stringify(key)}, { name: "A", url: "https://example.com", api_key: "secret", project_id: "a", paths: ["/a"] });`;
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        env: { ...process.env, HOME: home }, stdio: ["ignore", "ignore", "pipe"],
      });
      let error = "";
      child.stderr.on("data", (data) => { error += data.toString(); });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(error)));
    })));
    expect(Object.keys(config.readConfig().profiles).sort()).toEqual(["four", "one", "three", "two"]);
  });
  it.each(["replace", "path", "delete", "provider"])("rejects legacy %s of an isolated registration", async (operation) => {
    const config = await import("./toml.js");
    const profile = { name: "Project", url: "https://example.com", api_key: "secret", project_id: "a", paths: ["/workspace/a"] };
    config.setProfile("a", { ...profile, project_isolation: { identity: "a".repeat(64), organization_id: "org" } });
    if (operation === "replace") expect(() => config.setProfile("a", profile)).toThrow(/project/);
    if (operation === "path") expect(() => config.addPathToProfile("a", "/workspace/b")).toThrow(/project/);
    if (operation === "provider") expect(() => config.setProfileProviderKey("a", undefined)).toThrow(/project/);
    if (operation === "delete") expect(() => config.deleteProfileByKey("a")).toThrow(/project/);
  });

  it("validates before replacement and writes secrets with private permissions", async () => {
    const config = await import("./toml.js");
    config.setProfile("a", { name: "A", url: "https://example.com", api_key: "secret", project_id: "a", paths: ["/a"] });
    const original = fs.readFileSync(config.getConfigPath(), "utf8");
    expect(fs.statSync(config.getConfigPath()).mode & 0o777).toBe(0o600);
    expect(() => config.setProfile("broken", { name: "B", url: "invalid", api_key: "secret", project_id: "b", paths: [] })).toThrow();
    expect(fs.readFileSync(config.getConfigPath(), "utf8")).toBe(original);
    expect(fs.readdirSync(path.dirname(config.getConfigPath()))).toEqual(["config.toml"]);
  });
  it("refuses to overwrite malformed configuration when adding a profile", async () => {
    const config = await import("./toml.js");
    fs.mkdirSync(path.dirname(config.getConfigPath()), { recursive: true });
    fs.writeFileSync(config.getConfigPath(), "[profiles.broken");
    expect(() => config.setProfile("new", {
      name: "New", url: "https://example.convex.cloud", api_key: "secret", project_id: "project", paths: ["/repo"],
    })).toThrow(/config/i);
    expect(fs.readFileSync(config.getConfigPath(), "utf8")).toBe("[profiles.broken");
  });
});

it("commits credentials without attempting an unchanged TOML replacement", async () => {
  const config = await import("./toml.js");
  config.setProfile("a", { name:"A", url:"https://example.com", api_key:"secret", project_id:"a", paths:["/a"] });
  const before = fs.readFileSync(config.getConfigPath(),"utf8");
  vi.doMock("node:fs", async () => ({
    ...await vi.importActual<typeof fs>("node:fs"),
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (String(to).endsWith("config.toml")) throw new Error("TOML must not be rewritten");
      fs.renameSync(from,to);
    },
  }));
  vi.resetModules();
  const { mutateCredentials } = await import("./credentials/resolution.js");
  const { CredentialStore } = await import("./credentials/store.js");
  expect(() => mutateCredentials({action:"add",name:"work",secret:"dummy"},{workspace:"/work",registrations:[]})).not.toThrow();
  expect(new CredentialStore().read().entries.work.current).toBe(1);
  expect(fs.readFileSync(config.getConfigPath(),"utf8")).toBe(before);
});

describe("Codex provider key assignment (OS-2105)", () => {
  const profile = { name: "A", url: "https://example.com", api_key: "secret", project_id: "a", paths: ["/a"] };

  it("assigns Codex independently from the Claude provider key", async () => {
    const config = await import("./toml.js");
    config.setProfile("a", profile);
    config.setProviderKey("claude-mantle", { provider: "mantle", token: "claude-token" });
    config.setProviderKey("codex-mantle", { provider: "mantle", token: "codex-token", region: "us-east-1" });
    config.setProfileProviderKey("a", "claude-mantle");
    config.setProfileProviderKey("a", "codex-mantle", "codex");
    expect(config.readConfig().profiles.a).toMatchObject({ provider_key: "claude-mantle", codex_provider_key: "codex-mantle" });
    config.setProfileProviderKey("a", undefined, "codex");
    expect(config.readConfig().profiles.a).toMatchObject({ provider_key: "claude-mantle" });
    expect(config.readConfig().profiles.a?.codex_provider_key).toBeUndefined();
  });

  it.each([
    ["no region", { provider: "mantle" as const, token: "t" }, /region/i],
    ["anthropic", { provider: "anthropic" as const }, /Mantle or Bedrock/],
  ])("refuses a Codex assignment with %s", async (_label, key, message) => {
    const config = await import("./toml.js");
    config.setProfile("a", profile);
    config.setProviderKey("k", key);
    expect(() => config.setProfileProviderKey("a", "k", "codex")).toThrow(message);
    expect(config.readConfig().profiles.a?.codex_provider_key).toBeUndefined();
  });

  it("guards deletion and incompatible edits while Codex references a key", async () => {
    const config = await import("./toml.js");
    config.setProfile("a", profile);
    config.setProviderKey("k", { provider: "bedrock", token: "t", region: "us-east-1" });
    config.setProfileProviderKey("a", "k", "codex");
    expect(() => config.deleteProviderKey("k")).toThrow(/a \(Codex\)/);
    expect(() => config.deleteProviderKey("k")).toThrow("unassign [--runtime codex] --profile <key>");
    expect(() => config.setProviderKey("k", { provider: "bedrock", token: "t" })).toThrow(/region/i);
    config.setProviderKey("k", { provider: "mantle", token: "rotated", region: "us-west-2" });
    expect(config.readConfig().keys?.k).toEqual({ provider: "mantle", token: "rotated", region: "us-west-2" });
  });
});
