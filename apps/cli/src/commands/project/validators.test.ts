import { describe, expect, it } from "vitest";
import { assertManagedPath, launcherCheckSchema, loginRuntimeSchema, projectIdentity, requireProjectScope } from "./validators.js";
import { keyRuntimeSchema } from "../../lib/config/credentials/validators.js";
import { workerStateSchema } from "../service/validators.js";

describe("project identities and credentials", () => {
  it("normalizes deployment origins and distinguishes organizations and projects", () => {
    const identity = projectIdentity("https://EXAMPLE.com/", "org", "a");
    expect(identity).toBe(projectIdentity("https://example.com", "org", "a"));
    expect(identity).not.toBe(projectIdentity("https://example.com", "org", "b"));
    expect(identity).not.toBe(projectIdentity("https://example.com", "other", "a"));
    expect(identity).not.toBe(projectIdentity("https://different.com", "org", "a"));
  });
  it.each(["http://example.com", "https://user:password@example.com", "https://example.com?token=x"])("rejects unsafe deployment %s", (url) => {
    expect(() => projectIdentity(url, "org", "a")).toThrow();
  });
  it.each([
    null, { kind: "unscoped" }, { kind: "organization", organizationId: "org", projectIds: [] },
    { kind: "organization", organizationId: "org", projectIds: ["a", "b"] },
    { kind: "organization", organizationId: "other", projectIds: ["a"] },
    { kind: "organization", organizationId: "org", projectIds: ["b"] },
  ])("rejects credentials outside the exact project boundary", (scope) => {
    expect(() => requireProjectScope(scope, "org", "a")).toThrow(/restricted/);
  });
  it("accepts exactly one project", () => {
    expect(() => requireProjectScope({ kind: "organization", organizationId: "org", projectIds: ["a"] }, "org", "a")).not.toThrow();
  });
});

describe("shared Docker project paths (OS-2251)", () => {
  const mounts = ["/Users/me/code"];
  it.each(["/workspace/app", "/workspace/a/b", "/Users/me/code/app"])("accepts %s", target => {
    expect(() => assertManagedPath(target, mounts)).not.toThrow();
  });
  it("refuses a mount root and says to mount its parent", () => {
    expect(() => assertManagedPath("/Users/me/code", mounts)).toThrow(/Mount its parent/);
  });
  it.each(["/workspace", "/home/node/app", "/Users/me/other", "/Users/me/codex"])("refuses %s, which a rebuild would delete", target => {
    expect(() => assertManagedPath(target, mounts)).toThrow(/under \/workspace or a mounted folder/);
  });
});

describe("Antigravity has a login but no managed key yet (OS-2474)", () => {
  it("logs in Antigravity without letting keys use it", () => {
    expect(loginRuntimeSchema.safeParse("antigravity").success).toBe(true);
    expect(keyRuntimeSchema.safeParse("antigravity").success).toBe(false);
  });
  it("reads a launcher's Antigravity facts and a service's five runtimes, and still reads older ones without them", () => {
    const facts = { state: "ready", home: true, loggedIn: false };
    const check = { sandbox: null, holder: null, runtimes: { codex: facts, "claude-code": facts } };
    expect(launcherCheckSchema.safeParse(check).success).toBe(true);
    expect(launcherCheckSchema.safeParse({ ...check, runtimes: { ...check.runtimes, antigravity: facts } }).success).toBe(true);
    const worker = { profile: "a", status: "online", attempts: 0 };
    expect(workerStateSchema.safeParse({ ...worker, runtimes: ["codex", "claude-code", "opencode", "cursor", "antigravity"] }).success).toBe(true);
    expect(workerStateSchema.safeParse({ ...worker, runtimes: ["codex"] }).success).toBe(true);
    // A later service may report a runtime this CLI does not know; it is dropped, not a parse failure.
    expect(workerStateSchema.parse({ ...worker, runtimes: ["codex", "later-runtime"] }).runtimes).toEqual(["codex"]);
  });
});
