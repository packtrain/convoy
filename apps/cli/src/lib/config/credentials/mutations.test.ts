import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ConfigFile } from "../types.js";
const fixture = vi.hoisted(() => ({ config: { profiles: {} } as ConfigFile }));
vi.mock("../toml.js", () => ({
  getConfigPath: () => "unused",
  readConfig: () => fixture.config,
  withConfigLock: (fn: (c: ConfigFile) => unknown) => fn(fixture.config),
}));
import { CredentialStore } from "./store.js";
import { mutateCredentials, authDescriptor } from "./resolution.js";
import type { Binding } from "./validators.js";
import { projectIdentity } from "../../../commands/project/validators.js";
const identity = projectIdentity("https://example.convex.cloud", "org", "project");
const environment = {
  capabilities: ["credentials-v1"],
  workspace: "/work",
  registrations: [{ identity, path: "/work/a", uid: 20000, active: false, status: "stopped" as const }],
};
let dir: string;
let store: CredentialStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "keys-mutate-"));
  store = new CredentialStore(dir);
  const profile = {
    name: "A",
    url: "https://example.convex.cloud",
    api_key: "convoy-key",
    project_id: "project",
    paths: ["/work/a"],
    project_isolation: { identity, organization_id: "org" },
  };
  fixture.config = { profiles: { a: profile, alias: profile } };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
describe("credential mutations", () => {
  it("shares identity across aliases and rotates with explicit rollback", () => {
    mutateCredentials({ action: "add", name: "work", secret: "first" }, environment, store);
    mutateCredentials({ action: "bind", profile: "a", binding: { mode: "managed", name: "work" } }, environment, store);
    mutateCredentials({ action: "bind", profile: "alias", binding: { mode: "managed", name: "work" } }, environment, store);
    expect(Object.keys(store.read().bindings)).toEqual([identity]);
    mutateCredentials({ action: "rotate", name: "work", secret: "second" }, environment, store);
    expect(authDescriptor(store.read(), identity)?.revision).toBe(2);
    mutateCredentials({ action: "rollback", name: "work", revision: 1 }, environment, store);
    expect(authDescriptor(store.read(), identity)?.revision).toBe(1);
  });
  it("preserves previous state on invalid rotation and rejects referenced/active deletion", () => {
    mutateCredentials({ action: "add", name: "work", secret: "first" }, environment, store);
    const before = readFileSync(store.file, "utf8");
    expect(() => mutateCredentials({ action: "rotate", name: "work", secret: "" }, environment, store)).toThrow();
    expect(readFileSync(store.file, "utf8")).toBe(before);
    mutateCredentials({ action: "bind", profile: "a", binding: { mode: "managed", name: "work" } }, environment, store);
    expect(() => mutateCredentials({ action: "remove", name: "work" }, environment, store)).toThrow("work is assigned to a project");
    mutateCredentials({ action: "bind", profile: "a", binding: { mode: "disabled" } }, environment, store);
    expect(() =>
      mutateCredentials(
        { action: "remove", name: "work" },
        { ...environment, registrations: environment.registrations.map((r) => ({ ...r, active: true })) },
        store
      )
    ).toThrow("Project /work/a is running");
    // The service vouches for its own running workers that hold no grant of the entry.
    mutateCredentials(
      { action: "remove", name: "work" },
      { ...environment, registrations: environment.registrations.map((r) => ({ ...r, active: true })) },
      store,
      [identity]
    );
    expect(store.read().entries.work).toBeUndefined();
    mutateCredentials({ action: "add", name: "work", secret: "again" }, environment, store);
    mutateCredentials({ action: "remove", name: "work" }, environment, store);
    expect(authDescriptor(store.read(), identity)).toEqual({ mode: "disabled" });
  });
  it("rejects legacy collisions without rewriting managed credentials", () => {
    mutateCredentials({ action: "add", name: "work", secret: "first" }, environment, store);
    const before = readFileSync(store.file, "utf8");
    expect(readFileSync(store.file, "utf8")).toBe(before);
    fixture.config.keys = { work: { provider: "anthropic" } };
    expect(() => mutateCredentials({ action: "disable", name: "work" }, environment, store)).toThrow("conflicts");
    expect(readFileSync(store.file, "utf8")).toBe(before);
  });
  it("does not bind another identity when a profile is reused", () => {
    mutateCredentials({ action: "bind", profile: "a", binding: { mode: "disabled" } }, environment, store);
    fixture.config.profiles.a = { ...fixture.config.profiles.a, project_id: "different" };
    expect(() => mutateCredentials({ action: "bind", profile: "a", binding: { mode: "native" } }, environment, store)).toThrow(
      "registered isolated"
    );
    expect(store.read().bindings[identity]).toEqual({ mode: "disabled" });
  });
});

describe("shared environments (OS-2248)", () => {
  const shared = { name: "S", url: "https://example.convex.cloud", api_key: "k", project_id: "project", paths: ["/code/s"], project_mode: "shared" as const, project_organization: "org" };
  beforeEach(() => {
    const { project_mode: _mode, project_organization: _org, ...ordinary } = shared;
    fixture.config = { profiles: { s: shared, ordinary } };
  });
  it("adds any key and binds it to a shared registration without launcher capabilities", () => {
    mutateCredentials({ action: "add", name: "bedrock-a", secret: "first", aws: { provider: "bedrock", region: "us-east-1" } }, "shared", store);
    mutateCredentials({ action: "add", name: "claude-api", secret: "second", provider: "anthropic" }, "shared", store);
    mutateCredentials({ action: "bind", profile: "s", runtime: "claude-code", binding: { mode: "managed", name: "bedrock-a" } }, "shared", store);
    mutateCredentials({ action: "bind", profile: "s", runtime: "opencode", binding: { mode: "managed", name: "claude-api" } }, "shared", store);
    expect(authDescriptor(store.read(), identity)).toMatchObject({ mode: "native", claude: { mode: "managed", name: "bedrock-a" }, opencode: { anthropic: { name: "claude-api" } } });
  });
  it("refuses an unregistered profile", () => {
    expect(() => mutateCredentials({ action: "bind", profile: "ordinary", binding: { mode: "native" } }, "shared", store)).toThrow("registered shared project");
  });
  it("removes an unassigned key without a launcher registry", () => {
    mutateCredentials({ action: "add", name: "work", secret: "first" }, "shared", store);
    mutateCredentials({ action: "remove", name: "work" }, "shared", store);
    expect(store.read().entries.work).toBeUndefined();
  });
});

it("does not re-enable a disabled entry during rollback", () => {
  mutateCredentials({ action: "add", name: "work", secret: "first" }, environment, store);
  mutateCredentials({ action: "rotate", name: "work", secret: "second" }, environment, store);
  mutateCredentials({ action: "disable", name: "work" }, environment, store);
  mutateCredentials({ action: "rollback", name: "work", revision: 1 }, environment, store);
  expect(store.read().entries.work).toMatchObject({ enabled: false, current: 1 });
});

describe("managed AWS credentials (OS-2107)", () => {
  const aws = { provider: "mantle" as const, region: "eu-west-1" };
  const awsEnvironment = { ...environment, capabilities: ["credentials-v1", "credentials-aws-v1"] };
  it("stores the provider and region, and keeps them across rotation", () => {
    mutateCredentials({ action: "add", name: "work", secret: "first", aws }, awsEnvironment, store);
    mutateCredentials({ action: "rotate", name: "work", secret: "second" }, awsEnvironment, store);
    expect(store.read().entries.work).toMatchObject({ aws, current: 2 });
  });
  it("refuses an older launcher and an invalid region", () => {
    expect(() => mutateCredentials({ action: "add", name: "work", secret: "first", aws }, environment, store)).toThrow("updated launcher");
    expect(() =>
      mutateCredentials({ action: "add", name: "work", secret: "first", aws: { ...aws, region: "eu west" } }, awsEnvironment, store)
    ).toThrow("Invalid managed credential request");
  });
});

describe("managed Claude Code credentials (OS-2108)", () => {
  const aws = { provider: "bedrock" as const, region: "us-west-2" };
  const claudeEnvironment = { ...environment, capabilities: ["credentials-v1", "credentials-aws-v1", "credentials-claude-v1"] };
  const bindClaude = (binding: { mode: "managed"; name: string } | { mode: "disabled" } | { mode: "native" }, env = claudeEnvironment) =>
    mutateCredentials({ action: "bind", profile: "a", runtime: "claude-code", binding }, env, store);
  it("binds Claude Code separately from Codex and guards removal", () => {
    mutateCredentials({ action: "add", name: "work", secret: "first", aws }, claudeEnvironment, store);
    bindClaude({ mode: "managed", name: "work" });
    expect(store.read().bindings).toEqual({});
    expect(store.read().claudeBindings).toEqual({ [identity]: { mode: "managed", name: "work" } });
    expect(() => mutateCredentials({ action: "remove", name: "work" }, claudeEnvironment, store)).toThrow("assigned to a project");
    bindClaude({ mode: "disabled" });
    mutateCredentials({ action: "remove", name: "work" }, claudeEnvironment, store);
  });
  it("refuses an OpenAI entry and an older launcher", () => {
    mutateCredentials({ action: "add", name: "openai", secret: "first" }, claudeEnvironment, store);
    expect(() => bindClaude({ mode: "managed", name: "openai" })).toThrow("Mantle or Bedrock");
    mutateCredentials({ action: "add", name: "work", secret: "first", aws }, claudeEnvironment, store);
    expect(() => bindClaude({ mode: "managed", name: "work" }, { ...environment, capabilities: ["credentials-v1", "credentials-aws-v1"] })).toThrow(
      "updated launcher"
    );
  });
});

describe("managed Anthropic API keys (OS-2016)", () => {
  const anthropicEnvironment = { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1", "credentials-anthropic-v1"] };
  const bind = (runtime: "codex" | "claude-code", env = anthropicEnvironment) =>
    mutateCredentials({ action: "bind", profile: "a", runtime, binding: { mode: "managed", name: "work" } }, env, store);
  it("binds an Anthropic key to Claude Code only and keeps its provider across rotation", () => {
    mutateCredentials({ action: "add", name: "work", secret: "first", provider: "anthropic" }, anthropicEnvironment, store);
    expect(() => bind("codex")).toThrow("OpenAI");
    bind("claude-code");
    mutateCredentials({ action: "rotate", name: "work", secret: "second" }, anthropicEnvironment, store);
    expect(store.read().entries.work).toMatchObject({ provider: "anthropic", current: 2 });
    expect(store.read().bindings).toEqual({});
    expect(store.read().claudeBindings).toEqual({ [identity]: { mode: "managed", name: "work" } });
  });
  it("refuses a launcher without the Anthropic capability and an entry that is also AWS", () => {
    const older = { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1"] };
    expect(() => mutateCredentials({ action: "add", name: "work", secret: "first", provider: "anthropic" }, older, store)).toThrow("updated launcher");
    expect(() =>
      mutateCredentials({ action: "add", name: "work", secret: "first", provider: "anthropic", aws: { provider: "mantle", region: "us-east-1" } },
        { ...anthropicEnvironment, capabilities: [...anthropicEnvironment.capabilities, "credentials-aws-v1"] }, store)
    ).toThrow("Invalid managed credential request");
    mutateCredentials({ action: "add", name: "work", secret: "first", provider: "anthropic" }, anthropicEnvironment, store);
    expect(() => bind("claude-code", older)).toThrow("updated launcher");
  });
});

describe("managed Cursor account keys (OS-2017)", () => {
  const cursorEnvironment = { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1", "credentials-anthropic-v1", "credentials-cursor-v1"] };
  const bind = (runtime: "codex" | "claude-code" | "cursor", name = "work", env = cursorEnvironment) =>
    mutateCredentials({ action: "bind", profile: "a", runtime, binding: { mode: "managed", name } }, env, store);
  it("binds a Cursor key to Cursor only, beside the other runtimes, and guards removal", () => {
    mutateCredentials({ action: "add", name: "work", secret: "first", provider: "cursor" }, cursorEnvironment, store);
    expect(() => bind("codex")).toThrow("Codex needs");
    expect(() => bind("claude-code")).toThrow("Claude Code needs");
    bind("cursor");
    expect(store.read().bindings).toEqual({});
    expect(store.read().claudeBindings).toBeUndefined();
    expect(store.read().cursorBindings).toEqual({ [identity]: { mode: "managed", name: "work" } });
    expect(authDescriptor(store.read(), identity)).toMatchObject({ mode: "native", cursor: { mode: "managed", name: "work", revision: 1 } });
    expect(() => mutateCredentials({ action: "remove", name: "work" }, cursorEnvironment, store)).toThrow("assigned to a project");
    mutateCredentials({ action: "bind", profile: "a", runtime: "cursor", binding: { mode: "native" } }, cursorEnvironment, store);
    mutateCredentials({ action: "remove", name: "work" }, cursorEnvironment, store);
  });
  it("refuses other providers' keys for Cursor and a launcher without the Cursor capability", () => {
    mutateCredentials({ action: "add", name: "openai", secret: "first" }, cursorEnvironment, store);
    mutateCredentials({ action: "add", name: "claude", secret: "first", provider: "anthropic" }, cursorEnvironment, store);
    expect(() => bind("cursor", "openai")).toThrow("Cursor needs");
    expect(() => bind("cursor", "claude")).toThrow("Cursor needs");
    const older = { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1", "credentials-anthropic-v1"] };
    expect(() => mutateCredentials({ action: "add", name: "work", secret: "first", provider: "cursor" }, older, store)).toThrow("updated launcher");
    mutateCredentials({ action: "add", name: "work", secret: "first", provider: "cursor" }, cursorEnvironment, store);
    expect(() => bind("cursor", "work", older)).toThrow("updated launcher");
  });
});

describe("managed OpenCode provider keys (OS-2018)", () => {
  const opencodeEnvironment = { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1", "credentials-anthropic-v1", "credentials-opencode-v1"] };
  const bind = (binding: Binding, env = opencodeEnvironment) =>
    mutateCredentials({ action: "bind", profile: "a", runtime: "opencode", binding }, env, store);
  it("fills one slot per provider, disables and restores native login, and guards removal", () => {
    mutateCredentials({ action: "add", name: "openai", secret: "first" }, opencodeEnvironment, store);
    mutateCredentials({ action: "add", name: "claude", secret: "first", provider: "anthropic" }, opencodeEnvironment, store);
    bind({ mode: "managed", name: "openai" });
    bind({ mode: "managed", name: "claude" });
    expect(store.read().bindings).toEqual({});
    expect(store.read().opencodeBindings).toEqual({ [identity]: { openai: "openai", anthropic: "claude" } });
    expect(authDescriptor(store.read(), identity)).toMatchObject({ mode: "native", opencode: {
      openai: { mode: "managed", name: "openai", revision: 1 }, anthropic: { mode: "managed", name: "claude", revision: 1 },
    } });
    expect(() => mutateCredentials({ action: "remove", name: "claude" }, opencodeEnvironment, store)).toThrow("assigned to a project");
    bind({ mode: "disabled" });
    expect(store.read().opencodeBindings).toEqual({ [identity]: {} });
    expect(authDescriptor(store.read(), identity)).toEqual({ mode: "native", opencode: {} });
    bind({ mode: "native" });
    expect(store.read().opencodeBindings).toEqual({});
    expect(authDescriptor(store.read(), identity)).toBeUndefined();
    mutateCredentials({ action: "remove", name: "claude" }, opencodeEnvironment, store);
  });
  it("refuses Mantle and Cursor keys and a launcher without the OpenCode capability", () => {
    const all = { ...opencodeEnvironment, capabilities: [...opencodeEnvironment.capabilities, "credentials-aws-v1", "credentials-cursor-v1"] };
    mutateCredentials({ action: "add", name: "mantle", secret: "first", aws: { provider: "mantle", region: "us-east-1" } }, all, store);
    mutateCredentials({ action: "add", name: "cursor", secret: "first", provider: "cursor" }, all, store);
    expect(() => bind({ mode: "managed", name: "mantle" })).toThrow("OpenCode needs a managed OpenAI, Anthropic or Bedrock key.");
    expect(() => bind({ mode: "managed", name: "cursor" })).toThrow("OpenCode needs");
    mutateCredentials({ action: "add", name: "openai", secret: "first" }, all, store);
    expect(() => bind({ mode: "managed", name: "openai" }, { ...environment, capabilities: ["credentials-v1"] })).toThrow("Managed OpenCode credentials require an updated launcher");
  });
  it("fills the Bedrock slot beside the others, only on a launcher with credentials-opencode-v2 (OS-2205)", () => {
    const v1 = { ...opencodeEnvironment, capabilities: [...opencodeEnvironment.capabilities, "credentials-aws-v1"] };
    const v2 = { ...v1, capabilities: [...v1.capabilities, "credentials-opencode-v2"] };
    mutateCredentials({ action: "add", name: "bedrock", secret: "first", aws: { provider: "bedrock", region: "eu-west-1" } }, v1, store);
    mutateCredentials({ action: "add", name: "openai", secret: "first" }, v1, store);
    expect(() => bind({ mode: "managed", name: "bedrock" }, v1)).toThrow("Managed OpenCode Bedrock credentials require an updated launcher");
    bind({ mode: "managed", name: "openai" }, v1);
    bind({ mode: "managed", name: "bedrock" }, v2);
    expect(store.read().opencodeBindings).toEqual({ [identity]: { openai: "openai", "amazon-bedrock": "bedrock" } });
    expect(authDescriptor(store.read(), identity)?.opencode?.["amazon-bedrock"]).toMatchObject({ mode: "managed", name: "bedrock", revision: 1 });
    expect(() => mutateCredentials({ action: "remove", name: "bedrock" }, v2, store)).toThrow("assigned to a project");
  });
});

describe("managed Gemini API keys for Antigravity (OS-2476)", () => {
  const geminiEnvironment = { ...environment, capabilities: ["credentials-v1", "credentials-claude-v1", "credentials-anthropic-v1", "credentials-cursor-v1", "credentials-antigravity-v1"] };
  const bind = (runtime: "codex" | "claude-code" | "cursor" | "antigravity" | "opencode", name = "work", env = geminiEnvironment) =>
    mutateCredentials({ action: "bind", profile: "a", runtime, binding: { mode: "managed", name } }, env, store);
  it("binds a Gemini key to Antigravity only, beside the other runtimes, and guards removal", () => {
    mutateCredentials({ action: "add", name: "work", secret: "first", provider: "gemini" }, geminiEnvironment, store);
    expect(() => bind("codex")).toThrow("Codex needs");
    expect(() => bind("claude-code")).toThrow("Claude Code needs");
    expect(() => bind("cursor")).toThrow("Cursor needs");
    expect(() => bind("opencode", "work", { ...geminiEnvironment, capabilities: [...geminiEnvironment.capabilities, "credentials-opencode-v1"] })).toThrow("OpenCode needs");
    bind("antigravity");
    expect(store.read().bindings).toEqual({});
    expect(store.read().antigravityBindings).toEqual({ [identity]: { mode: "managed", name: "work" } });
    expect(authDescriptor(store.read(), identity)).toMatchObject({ mode: "native", antigravity: { mode: "managed", name: "work", revision: 1 } });
    expect(() => mutateCredentials({ action: "remove", name: "work" }, geminiEnvironment, store)).toThrow("assigned to a project");
    mutateCredentials({ action: "bind", profile: "a", runtime: "antigravity", binding: { mode: "native" } }, geminiEnvironment, store);
    mutateCredentials({ action: "remove", name: "work" }, geminiEnvironment, store);
  });
  it("refuses other providers' keys for Antigravity and a launcher without the Antigravity capability", () => {
    mutateCredentials({ action: "add", name: "openai", secret: "first" }, geminiEnvironment, store);
    mutateCredentials({ action: "add", name: "cursor", secret: "first", provider: "cursor" }, geminiEnvironment, store);
    expect(() => bind("antigravity", "openai")).toThrow("Antigravity needs a managed Gemini API key.");
    expect(() => bind("antigravity", "cursor")).toThrow("Antigravity needs");
    const older = { ...environment, capabilities: ["credentials-v1", "credentials-cursor-v1"] };
    expect(() => mutateCredentials({ action: "add", name: "work", secret: "first", provider: "gemini" }, older, store)).toThrow("Managed Gemini keys require an updated launcher");
    mutateCredentials({ action: "add", name: "work", secret: "first", provider: "gemini" }, geminiEnvironment, store);
    expect(() => bind("antigravity", "work", older)).toThrow("Managed Antigravity credentials require an updated launcher");
  });
});
