import { describe, expect, it } from "vitest";
import { assertManagedPath, projectIdentity, requireProjectScope } from "./validators.js";

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
