import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";

const mocks = vi.hoisted(() => ({
  directory: "",
  mutate: vi.fn(),
  set: vi.fn(),
  assign: vi.fn(),
  remove: vi.fn(),
  input: vi.fn(async () => ""),
  select: vi.fn(),
  targeted: false,
  profiles: [] as Array<{ key: string; profile: Record<string, unknown> }>,
  keys: [] as Array<{ name: string; key: Record<string, unknown> }>,
}));
vi.mock("../../cli.js", () => ({
  addGlobalOptions: (cmd: Command) => cmd.option("--profile <name>"),
}));
vi.mock("../../lib/config/toml.js", () => ({ getConfigPath: () => join(mocks.directory, "config.toml") }));
vi.mock("../../lib/config/index.js", () => ({
  PROVIDER_LABELS: { anthropic: "Claude", bedrock: "Bedrock", mantle: "Mantle" },
  deleteProviderKey: mocks.remove,
  getProviderKey: (name: string) =>
    name === "openai" ? undefined : name === "aws" ? { provider: "mantle", token: "t", region: "us-east-1" } : { provider: "anthropic" },
  listAllProfiles: () => mocks.profiles,
  listProviderKeys: () => mocks.keys,
  providerRequiresToken: (provider: string) => provider !== "anthropic",
  resolveProfile: (_cwd: string, { profile }: { profile?: string }) =>
    profile === "iso" ? { key: "iso", profile: { project_isolation: {} } }
      : profile === "sh" ? { key: "sh", profile: { url: "https://example.convex.cloud", project_id: "p", project_mode: "shared", project_organization: "o" } }
      : { key: profile ?? "a", profile: {} },
  setProfileProviderKey: mocks.assign,
  setProviderKey: mocks.set,
}));
vi.mock("./workflow.js", () => ({
  changeCredentials: mocks.mutate,
  inputSecret: async () => "dummy",
  managedProfile: (profile: string) => profile,
  managedStatus: async () => ({}),
  printManagedStatus: vi.fn(),
  runManagedCommand: async (fn: () => unknown) => fn(),
  targeted: () => mocks.targeted,
}));
vi.mock("@inquirer/prompts", () => ({ input: mocks.input, password: async () => "token", select: mocks.select }));
let directory: string;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  directory = mkdtempSync(join(tmpdir(), "key-routing-"));
  mkdirSync(join(directory, "real"));
  symlinkSync(join(directory, "real"), join(directory, "home"));
  mocks.directory = join(directory, "home", "config");
  mocks.remove.mockReturnValue(true);
  mocks.profiles = [];
  mocks.keys = [];
  mocks.targeted = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
async function run(...args: string[]) {
  const { keysCommand } = await import("./command.js");
  await keysCommand.exitOverride().parseAsync(args, { from: "user" });
}
it("lists Claude providers under a symlinked HOME without a managed store", async () => {
  await run("list");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("stores a Claude entry without invoking managed auth", async () => {
  await run("add", "claude", "--provider", "anthropic");
  expect(mocks.set).toHaveBeenCalledWith("claude", { provider: "anthropic" });
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("asks for the provider in a select that does not wrap around", async () => {
  mocks.select.mockResolvedValue("anthropic");
  await run("add", "claude");
  expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ message: "Provider", loop: false }));
});
it("asks for a region that Claude Code may skip and Codex needs", async () => {
  await run("add", "aws", "--provider", "mantle");
  expect(mocks.input).toHaveBeenCalledWith({ message: "AWS region (optional for Claude Code, required for Codex)" });
  expect(mocks.set).toHaveBeenCalledWith("aws", { provider: "mantle", token: "token" });
});
it("stores a legacy Bedrock entry without managed auth, so it works in a shared environment (OS-2248)", async () => {
  await run("add", "bedrock", "--provider", "bedrock", "--token", "t", "--region", "us-east-1");
  expect(mocks.set).toHaveBeenCalledWith("bedrock", { provider: "bedrock", token: "t", region: "us-east-1" });
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("routes OpenAI add to managed credentials", async () => {
  await run("add", "openai", "--provider", "openai", "--auth", "api-key");
  expect(mocks.mutate).toHaveBeenCalledWith({ action: "add", name: "openai", secret: "dummy" });
  expect(mocks.set).not.toHaveBeenCalled();
});
it("assigns and removes a Claude key through its existing provider API", async () => {
  await run("use", "claude", "--profile", "a");
  expect(mocks.assign).toHaveBeenCalledWith("a", "claude");
  await run("remove", "claude");
  expect(mocks.remove).toHaveBeenCalledWith("claude");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("assigns Codex independently from the Claude provider", async () => {
  await run("use", "openai", "--runtime", "codex", "--profile", "iso");
  expect(mocks.mutate).toHaveBeenCalledWith({ action: "bind", profile: "iso", binding: { mode: "managed", name: "openai" } });
  expect(mocks.assign).not.toHaveBeenCalled();
});
it.each([false, true])("unassigns Codex with explicit native choice %s", async (native) => {
  await run("unassign", "--runtime", "codex", "--profile", "iso", ...(native ? ["--native-login"] : []));
  expect(mocks.mutate).toHaveBeenCalledWith({ action: "bind", profile: "iso", binding: { mode: native ? "native" : "disabled" } });
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("unassigns Claude independently from Codex", async () => {
  await run("unassign", "--profile", "a");
  expect(mocks.assign).toHaveBeenCalledWith("a", undefined);
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it("describes every managed operation in keys help", async () => {
  const { keysCommand } = await import("./command.js");
  for (const name of ["status", "rotate", "rollback", "disable"]) {
    expect(keysCommand.commands.find((command) => command.name() === name)?.description()).toBeTruthy();
  }
});

it("assigns an AWS key to Codex on an ordinary profile (OS-2105)", async () => {
  await run("use", "aws", "--runtime", "codex", "--profile", "a");
  expect(mocks.assign).toHaveBeenCalledWith("a", "aws", "codex");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("reports an unknown Codex key on an ordinary profile through the TOML path", async () => {
  await run("use", "openai", "--runtime", "codex", "--profile", "a");
  expect(mocks.assign).toHaveBeenCalledWith("a", "openai", "codex");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("restores the machine's Codex config on an ordinary profile (OS-2105)", async () => {
  await run("unassign", "--runtime", "codex", "--profile", "a");
  expect(mocks.assign).toHaveBeenCalledWith("a", undefined, "codex");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("lists which runtime uses each key (OS-2105)", async () => {
  mocks.keys = [{ name: "aws", key: { provider: "mantle", token: "abcdefghijklmnop", region: "us-east-1" } }];
  mocks.profiles = [{ key: "a", profile: { provider_key: "aws" } }, { key: "b", profile: { codex_provider_key: "aws" } }];
  await run("list");
  const output = vi.mocked(console.log).mock.calls.flat().join("\n");
  expect(output).toMatch(/Used by:.*a.*b \(Codex\)/);
});
it("routes a Mantle or Bedrock add with --auth api-key to managed credentials (OS-2107)", async () => {
  await run("add", "work", "--provider", "bedrock", "--auth", "api-key", "--region", "us-west-2");
  expect(mocks.mutate).toHaveBeenCalledWith({ action: "add", name: "work", secret: "dummy", aws: { provider: "bedrock", region: "us-west-2" } });
  expect(mocks.set).not.toHaveBeenCalled();
});
it("refuses a managed AWS add without a region, and a managed OpenAI add with one (OS-2107)", async () => {
  await expect(run("add", "work", "--provider", "mantle", "--auth", "api-key")).rejects.toThrow("--region");
  await expect(run("add", "work", "--provider", "openai", "--auth", "api-key", "--region", "us-east-1")).rejects.toThrow("region");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("binds and unassigns Claude Code on an isolated profile through managed credentials (OS-2108)", async () => {
  await run("use", "work", "--runtime", "claude-code", "--profile", "iso");
  expect(mocks.mutate).toHaveBeenCalledWith({ action: "bind", profile: "iso", runtime: "claude-code", binding: { mode: "managed", name: "work" } });
  await run("unassign", "--runtime", "claude-code", "--profile", "iso");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "iso", runtime: "claude-code", binding: { mode: "disabled" } });
  await run("unassign", "--runtime", "claude-code", "--native-login", "--profile", "iso");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "iso", runtime: "claude-code", binding: { mode: "native" } });
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("binds Claude Code and Codex on a shared registration through managed credentials (OS-2248)", async () => {
  await run("use", "bedrock-a", "--runtime", "claude-code", "--profile", "sh");
  expect(mocks.mutate).toHaveBeenCalledWith({ action: "bind", profile: "sh", runtime: "claude-code", binding: { mode: "managed", name: "bedrock-a" } });
  await run("use", "openai", "--runtime", "codex", "--profile", "sh");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "sh", binding: { mode: "managed", name: "openai" } });
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("keeps --runtime claude-code on an ordinary profile in config.toml (OS-2108)", async () => {
  await run("use", "aws", "--runtime", "claude-code", "--profile", "a");
  expect(mocks.assign).toHaveBeenCalledWith("a", "aws");
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("routes an Anthropic add with --auth api-key to managed credentials, keeping the credential-free entry (OS-2016)", async () => {
  await run("add", "work", "--provider", "anthropic", "--auth", "api-key");
  expect(mocks.mutate).toHaveBeenCalledWith({ action: "add", name: "work", secret: "dummy", provider: "anthropic" });
  await expect(run("add", "work", "--provider", "anthropic", "--auth", "api-key", "--region", "us-east-1")).rejects.toThrow("region");
  expect(mocks.set).not.toHaveBeenCalled();
});
it("routes a Cursor add, use and unassign to managed credentials, never config.toml (OS-2017)", async () => {
  await run("add", "work", "--provider", "cursor", "--auth", "api-key");
  expect(mocks.mutate).toHaveBeenCalledWith({ action: "add", name: "work", secret: "dummy", provider: "cursor" });
  await expect(run("add", "work", "--provider", "cursor")).rejects.toThrow("--auth api-key");
  await expect(run("add", "work", "--provider", "cursor", "--auth", "api-key", "--region", "us-east-1")).rejects.toThrow("region");
  await run("use", "work", "--runtime", "cursor", "--profile", "a");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "a", runtime: "cursor", binding: { mode: "managed", name: "work" } });
  await run("unassign", "--runtime", "cursor", "--native-login", "--profile", "iso");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "iso", runtime: "cursor", binding: { mode: "native" } });
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("routes a Gemini add, use and unassign to managed credentials for Antigravity, never config.toml (OS-2476)", async () => {
  await run("add", "work", "--provider", "gemini", "--auth", "api-key");
  expect(mocks.mutate).toHaveBeenCalledWith({ action: "add", name: "work", secret: "dummy", provider: "gemini" });
  await expect(run("add", "work", "--provider", "gemini")).rejects.toThrow("--auth api-key");
  await expect(run("add", "work", "--provider", "gemini", "--auth", "api-key", "--region", "us-east-1")).rejects.toThrow("region");
  await run("use", "work", "--runtime", "antigravity", "--profile", "a");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "a", runtime: "antigravity", binding: { mode: "managed", name: "work" } });
  await run("unassign", "--runtime", "antigravity", "--profile", "iso");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "iso", runtime: "antigravity", binding: { mode: "disabled" } });
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("routes OpenCode use and unassign to managed credentials, never config.toml (OS-2018)", async () => {
  await run("use", "work", "--runtime", "opencode", "--profile", "a");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "a", runtime: "opencode", binding: { mode: "managed", name: "work" } });
  await run("unassign", "--runtime", "opencode", "--profile", "a");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "a", runtime: "opencode", binding: { mode: "disabled" } });
  await run("unassign", "--runtime", "opencode", "--native-login", "--profile", "iso");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "iso", runtime: "opencode", binding: { mode: "native" } });
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("never writes host config.toml for a --env or --remote target (OS-2020)", async () => {
  mocks.targeted = true;
  await expect(run("add", "work", "--provider", "bedrock")).rejects.toThrow("--auth api-key");
  await expect(run("use", "work", "--profile", "a")).rejects.toThrow("--runtime");
  await expect(run("unassign", "--profile", "a")).rejects.toThrow("--runtime");
  await run("use", "work", "--runtime", "codex", "--profile", "a");
  expect(mocks.mutate).toHaveBeenLastCalledWith({ action: "bind", profile: "a", binding: { mode: "managed", name: "work" } });
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.assign).not.toHaveBeenCalled();
});
