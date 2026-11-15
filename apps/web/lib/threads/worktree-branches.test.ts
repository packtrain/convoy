import { describe, expect, it } from "vitest";
import {
  deriveTaskWorktreeBranchName,
  deriveWorktreeBranchName,
  getWorktreeBranchNameError,
  isValidWorktreeBranchName,
  sanitizeBranchFragment,
  WORKTREE_BRANCH_MAX_LENGTH,
} from "./worktree-branches";

describe("isValidWorktreeBranchName", () => {
  it.each(["main", "feat/fix-login", "release/1.2.3", "a_b-c.d", "codex/os-616-mdx"])(
    "accepts %s",
    (name) => {
      expect(isValidWorktreeBranchName(name)).toBe(true);
    }
  );

  it.each([
    ["", "empty"],
    ["-rf", "leading dash (argument injection)"],
    ["--force", "leading double dash"],
    ["/feat", "leading slash"],
    ["feat/", "trailing slash"],
    ["feat/.hidden", "dot-leading segment"],
    ["feat//x", "empty segment"],
    ["a..b", "double dot"],
    ["x.lock", "lock suffix"],
    ["x.", "trailing dot"],
    ["a@{b", "reflog syntax"],
    ["has space", "space"],
    ["tilde~1", "tilde"],
    ["caret^", "caret"],
    ["colon:x", "colon"],
    ["back\\slash", "backslash"],
    ["a".repeat(WORKTREE_BRANCH_MAX_LENGTH + 1), "over length"],
  ])("rejects %s (%s)", (name) => {
    expect(isValidWorktreeBranchName(name)).toBe(false);
  });
});

describe("getWorktreeBranchNameError", () => {
  it("returns null for empty input and valid names", () => {
    expect(getWorktreeBranchNameError("")).toBeNull();
    expect(getWorktreeBranchNameError("feat/fix")).toBeNull();
  });

  it("names the specific problem", () => {
    expect(getWorktreeBranchNameError("feat/")).toContain('end with "/"');
    expect(getWorktreeBranchNameError("x.lock")).toContain(".lock");
    expect(getWorktreeBranchNameError("-rf")).toContain('start with "-"');
    expect(getWorktreeBranchNameError("a..b")).toContain('".."');
    expect(getWorktreeBranchNameError("has space")).toContain("can only contain");
    expect(
      getWorktreeBranchNameError("a".repeat(WORKTREE_BRANCH_MAX_LENGTH + 1))
    ).toContain(`${WORKTREE_BRANCH_MAX_LENGTH} characters`);
    // Valid characters but still an invalid ref shape (dot-leading segment).
    expect(getWorktreeBranchNameError("feat/.hidden")).toBe("Invalid branch name.");
  });
});

describe("sanitizeBranchFragment", () => {
  it("lowercases and collapses separators", () => {
    expect(sanitizeBranchFragment("Fix the Login Bug!")).toBe("fix-the-login-bug");
  });

  it("strips quotes and non-ascii", () => {
    expect(sanitizeBranchFragment(`Émoji 🚀 "name"`)).toBe("moji-name");
  });

  it("falls back to 'thread' when nothing survives", () => {
    expect(sanitizeBranchFragment("")).toBe("thread");
    expect(sanitizeBranchFragment("///")).toBe("thread");
    expect(sanitizeBranchFragment("🚀🚀")).toBe("thread");
  });

  it("caps length without a trailing separator", () => {
    const long = sanitizeBranchFragment(`${"a".repeat(63)}-tail`);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("deriveWorktreeBranchName", () => {
  it("uses the first non-empty line with the feat/ prefix", () => {
    expect(deriveWorktreeBranchName("\n\nFix login flow\nmore detail")).toBe(
      "feat/fix-login-flow"
    );
  });

  it("always yields a valid branch name", () => {
    for (const seed of ["", "🚀", "-- --", "a..b @{ x.lock"]) {
      expect(isValidWorktreeBranchName(deriveWorktreeBranchName(seed))).toBe(true);
    }
  });
});

describe("deriveTaskWorktreeBranchName", () => {
  it("builds <type-prefix>/<ref>-<first task-name words>", () => {
    expect(
      deriveTaskWorktreeBranchName({ refId: "OS-808", name: "Fix login crash on mobile Safari", taskTypeKey: "bug" })
    ).toBe("bug/os-808-fix-login-crash-on");
  });

  it("maps task types to prefixes and falls back to feat/", () => {
    const task = { refId: "OS-1", name: "Something" };
    expect(deriveTaskWorktreeBranchName({ ...task, taskTypeKey: "feature" })).toBe("feat/os-1-something");
    expect(deriveTaskWorktreeBranchName({ ...task, taskTypeKey: "task" })).toBe("feat/os-1-something");
    expect(deriveTaskWorktreeBranchName({ ...task, taskTypeKey: "chore" })).toBe("chore/os-1-something");
    expect(deriveTaskWorktreeBranchName({ ...task, taskTypeKey: "epic" })).toBe("epic/os-1-something");
    expect(deriveTaskWorktreeBranchName({ ...task, taskTypeKey: "investigation" })).toBe("spike/os-1-something");
    expect(deriveTaskWorktreeBranchName({ ...task, taskTypeKey: "idea" })).toBe("spike/os-1-something");
    expect(deriveTaskWorktreeBranchName({ ...task, taskTypeKey: "custom" })).toBe("feat/os-1-something");
    expect(deriveTaskWorktreeBranchName(task)).toBe("feat/os-1-something");
  });

  it("always yields a valid branch name", () => {
    for (const name of ["", "🚀 rocket", "a..b @{ x.lock", "  spaced   out   name here and more  "]) {
      expect(isValidWorktreeBranchName(deriveTaskWorktreeBranchName({ refId: "OS-9", name, taskTypeKey: "bug" }))).toBe(true);
    }
  });
});
