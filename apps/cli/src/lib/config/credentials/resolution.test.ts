import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialStore } from "./store.js";
import { authDescriptor, launchAuth, launchCapabilities, assertCredentialNames } from "./resolution.js";
import { credentialStoreSchema, credentialMutationSchema } from "./validators.js";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
describe("credential resolution", () => {
  it("delivers only the bound credential and keeps descriptors secret-free", () => {
    const dir = mkdtempSync(join(tmpdir(), "keys-resolve-"));
    dirs.push(dir);
    const store = new CredentialStore(dir);
    store.mutate((d) => {
      d.entries.work = { id: "id", enabled: true, current: 1, revisions: [{ revision: 1, secret: "A-only", createdAt: 1 }] };
      d.bindings["a".repeat(64)] = { mode: "managed", name: "work" };
    });
    const descriptor = authDescriptor(store.read(), "a".repeat(64));
    expect(JSON.stringify(descriptor)).not.toContain("A-only");
    expect(launchAuth("a".repeat(64), descriptor, store)).toEqual({ codexAuth: { mode: "managed", secret: "A-only" } });
    expect(launchAuth("b".repeat(64), undefined, store)).toEqual({});
    store.mutate((d) => {
      d.entries.work.enabled = false;
    });
    expect(() => launchAuth("a".repeat(64), descriptor, store)).toThrow("changed before launch");
    expect(launchAuth("a".repeat(64), authDescriptor(store.read(), "a".repeat(64)), store)).toEqual({ codexAuth: { mode: "disabled" } });
  });
  it("rejects collisions with legacy names", () => {
    expect(() =>
      assertCredentialNames(
        {
          version: 1,
          generation: 1,
          bindings: {},
          entries: { work: { id: "id", enabled: true, current: 1, revisions: [{ revision: 1, secret: "secret", createdAt: 1 }] } },
        },
        { work: { provider: "anthropic" } }
      )
    ).toThrow("conflicts");
  });
});

it("delivers native restoration as unbound while retaining its status descriptor", () => {
  const dir = mkdtempSync(join(tmpdir(), "keys-native-"));
  dirs.push(dir);
  const store = new CredentialStore(dir);
  store.mutate((data) => {
    data.bindings["a".repeat(64)] = { mode: "native" };
  });
  const descriptor = authDescriptor(store.read(), "a".repeat(64));
  expect(descriptor).toEqual({ mode: "native" });
  expect(launchAuth("a".repeat(64), descriptor, store)).toEqual({});
});

it("delivers an AWS entry with its provider and region (OS-2107)", () => {
  const dir = mkdtempSync(join(tmpdir(), "keys-aws-"));
  dirs.push(dir);
  const store = new CredentialStore(dir);
  store.mutate((d) => {
    d.entries.work = { id: "id", enabled: true, current: 1, aws: { provider: "bedrock", region: "us-west-2" },
      revisions: [{ revision: 1, secret: "aws-token", createdAt: 1 }] };
    d.bindings["a".repeat(64)] = { mode: "managed", name: "work" };
  });
  const descriptor = authDescriptor(store.read(), "a".repeat(64));
  expect(launchAuth("a".repeat(64), descriptor, store)).toEqual({ codexAuth: { mode: "bedrock", secret: "aws-token", region: "us-west-2" } });
});

it("delivers Claude Code's binding beside Codex's, one runtime at a time (OS-2108)", () => {
  const dir = mkdtempSync(join(tmpdir(), "keys-claude-"));
  dirs.push(dir);
  const store = new CredentialStore(dir);
  const identity = "a".repeat(64);
  store.mutate((d) => {
    d.entries.work = { id: "id", enabled: true, current: 1, aws: { provider: "mantle", region: "us-east-1" },
      revisions: [{ revision: 1, secret: "aws-token", createdAt: 1 }] };
    d.claudeBindings = { [identity]: { mode: "managed", name: "work" } };
  });
  const descriptor = authDescriptor(store.read(), identity);
  expect(descriptor).toEqual({ mode: "native", claude: { mode: "managed", name: "work", entryId: "id", revision: 1 } });
  expect(launchAuth(identity, descriptor, store)).toEqual({ claudeAuth: { mode: "mantle", secret: "aws-token", region: "us-east-1" } });
  store.mutate((d) => {
    d.bindings[identity] = { mode: "disabled" };
    d.claudeBindings![identity] = { mode: "disabled" };
  });
  expect(launchAuth(identity, authDescriptor(store.read(), identity), store)).toEqual({ codexAuth: { mode: "disabled" }, claudeAuth: { mode: "disabled" } });
  store.mutate((d) => {
    d.claudeBindings![identity] = { mode: "native" };
  });
  expect(launchAuth(identity, authDescriptor(store.read(), identity), store)).toEqual({ codexAuth: { mode: "disabled" } });
});

it("delivers an Anthropic entry to Claude Code only (OS-2016)", () => {
  const dir = mkdtempSync(join(tmpdir(), "keys-anthropic-"));
  dirs.push(dir);
  const store = new CredentialStore(dir);
  const identity = "a".repeat(64);
  store.mutate((d) => {
    d.entries.work = { id: "id", enabled: true, current: 1, provider: "anthropic", revisions: [{ revision: 1, secret: "sk-ant", createdAt: 1 }] };
    d.claudeBindings = { [identity]: { mode: "managed", name: "work" } };
  });
  expect(launchAuth(identity, authDescriptor(store.read(), identity), store)).toEqual({ claudeAuth: { mode: "anthropic", secret: "sk-ant" } });
  // A hand-edited Codex binding must never send an Anthropic key to OpenAI.
  store.mutate((d) => { d.bindings[identity] = { mode: "managed", name: "work" }; });
  expect(() => launchAuth(identity, authDescriptor(store.read(), identity), store)).toThrow("Codex needs");
});

it("names the conflict when an entry is both AWS and Anthropic (OS-2016)", () => {
  const aws = { provider: "mantle", region: "us-east-1" };
  const store = credentialStoreSchema.safeParse({
    version: 1, generation: 1, bindings: {},
    entries: { work: { id: "id", enabled: true, current: 1, aws, provider: "anthropic", revisions: [{ revision: 1, secret: "s", createdAt: 1 }] } },
  });
  const add = credentialMutationSchema.safeParse({ action: "add", name: "work", secret: "s", aws, provider: "anthropic" });
  expect(store.error?.issues[0]?.message).toBe("An entry has either aws or provider, never both.");
  expect(add.error?.issues[0]?.message).toBe("An entry has either aws or provider, never both.");
});

it("delivers a Cursor entry to Cursor only (OS-2017)", () => {
  const dir = mkdtempSync(join(tmpdir(), "keys-cursor-"));
  dirs.push(dir);
  const store = new CredentialStore(dir);
  const identity = "a".repeat(64);
  store.mutate((d) => {
    d.entries.work = { id: "id", enabled: true, current: 1, provider: "cursor", revisions: [{ revision: 1, secret: "key_cursor", createdAt: 1 }] };
    d.cursorBindings = { [identity]: { mode: "managed", name: "work" } };
  });
  const payload = launchAuth(identity, authDescriptor(store.read(), identity), store);
  expect(payload).toEqual({ cursorAuth: { mode: "managed", secret: "key_cursor" } });
  expect(launchCapabilities(payload)).toEqual(["credentials-cursor-v1"]);
  store.mutate((d) => { d.cursorBindings = { [identity]: { mode: "disabled" } }; });
  expect(launchAuth(identity, authDescriptor(store.read(), identity), store)).toEqual({ cursorAuth: { mode: "disabled" } });
  // Hand-edited bindings never send a Cursor key to another runtime, or another key to Cursor.
  store.mutate((d) => { d.claudeBindings = { [identity]: { mode: "managed", name: "work" } }; });
  expect(() => launchAuth(identity, authDescriptor(store.read(), identity), store)).toThrow("Claude Code needs");
  store.mutate((d) => {
    d.claudeBindings = {};
    d.entries.openai = { id: "id2", enabled: true, current: 1, revisions: [{ revision: 1, secret: "sk", createdAt: 1 }] };
    d.cursorBindings = { [identity]: { mode: "managed", name: "openai" } };
  });
  expect(() => launchAuth(identity, authDescriptor(store.read(), identity), store)).toThrow("Cursor needs");
});

it("delivers each OpenCode slot's key to OpenCode only (OS-2018)", () => {
  const dir = mkdtempSync(join(tmpdir(), "keys-opencode-"));
  dirs.push(dir);
  const store = new CredentialStore(dir);
  const identity = "a".repeat(64);
  store.mutate((d) => {
    d.entries.openai = { id: "id1", enabled: true, current: 1, revisions: [{ revision: 1, secret: "sk-openai", createdAt: 1 }] };
    d.entries.claude = { id: "id2", enabled: true, current: 1, provider: "anthropic", revisions: [{ revision: 1, secret: "sk-ant", createdAt: 1 }] };
    d.opencodeBindings = { [identity]: { openai: "openai", anthropic: "claude" } };
  });
  const payload = launchAuth(identity, authDescriptor(store.read(), identity), store);
  expect(payload).toEqual({ opencodeAuth: { mode: "managed", keys: { openai: "sk-openai", anthropic: "sk-ant" } } });
  expect(launchCapabilities(payload)).toEqual(["credentials-opencode-v1"]);
  // A disabled entry stops its slot only; no slot left means OpenCode is disabled.
  store.mutate((d) => { d.entries.claude.enabled = false; });
  expect(launchAuth(identity, authDescriptor(store.read(), identity), store)).toEqual({ opencodeAuth: { mode: "managed", keys: { openai: "sk-openai" } } });
  store.mutate((d) => { d.opencodeBindings = { [identity]: {} }; });
  expect(launchAuth(identity, authDescriptor(store.read(), identity), store)).toEqual({ opencodeAuth: { mode: "disabled" } });
  // A hand-edited slot never sends a key to the wrong provider.
  store.mutate((d) => { d.opencodeBindings = { [identity]: { openai: "claude" } }; d.entries.claude.enabled = true; });
  expect(() => launchAuth(identity, authDescriptor(store.read(), identity), store)).toThrow("OpenCode needs");
});
