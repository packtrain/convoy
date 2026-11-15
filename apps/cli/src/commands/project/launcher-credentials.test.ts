import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock("node:child_process", () => mocks);
import { spawnProjectLauncher } from "./launcher.js";
const config = {
  convexUrl: "https://example.convex.cloud",
  apiKey: "convoy-key",
  projectId: "p",
  organizationId: "o",
  profileKey: "a",
  codexAuth: { mode: "managed" as const, secret: "sentinel" },
};
it("uses an already validated service capability without blocking on another registry read", () => {
  mocks.spawnSync.mockReturnValue({ status: 1, stderr: "registry locked" });
  mocks.spawn.mockReturnValue({ stdin: { on: vi.fn(), write: vi.fn() } });
  expect(() => spawnProjectLauncher("a".repeat(64), config, "pipe", true)).not.toThrow();
  expect(mocks.spawnSync).not.toHaveBeenCalled();
});
it("still checks capability for a direct launch", () => {
  mocks.spawnSync.mockClear();
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify({ workspace: "/work", registrations: [] }) });
  expect(() => spawnProjectLauncher("a".repeat(64), config, "pipe")).toThrow("updated project launcher");
});
it("refuses AWS credentials on a launcher without credentials-aws-v1 (OS-2107)", () => {
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify({ capabilities: ["credentials-v1"], workspace: "/work", registrations: [] }) });
  const aws = { ...config, codexAuth: { mode: "mantle" as const, secret: "sentinel", region: "us-east-1" } };
  expect(() => spawnProjectLauncher("a".repeat(64), aws, "pipe")).toThrow("updated project launcher");
  expect(() => spawnProjectLauncher("a".repeat(64), config, "pipe")).not.toThrow();
});
it("refuses Claude Code credentials on a launcher without credentials-claude-v1 (OS-2108)", () => {
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify({ capabilities: ["credentials-v1", "credentials-aws-v1"], workspace: "/work", registrations: [] }) });
  const claude = { ...config, codexAuth: undefined, claudeAuth: { mode: "disabled" as const } };
  expect(() => spawnProjectLauncher("a".repeat(64), claude, "pipe")).toThrow("updated project launcher");
});
it("refuses an Anthropic key on a launcher without credentials-anthropic-v1 (OS-2016)", () => {
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify({ capabilities: ["credentials-v1", "credentials-claude-v1"], workspace: "/work", registrations: [] }) });
  const anthropic = { ...config, codexAuth: undefined, claudeAuth: { mode: "anthropic" as const, secret: "sentinel" } };
  expect(() => spawnProjectLauncher("a".repeat(64), anthropic, "pipe")).toThrow("updated project launcher");
  expect(() => spawnProjectLauncher("a".repeat(64), { ...anthropic, claudeAuth: { mode: "disabled" as const } }, "pipe")).not.toThrow();
});
