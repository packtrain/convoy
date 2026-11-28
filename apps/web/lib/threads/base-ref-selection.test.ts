import { describe, expect, it } from "vitest";
import {
  isBaseRefSelectionValid,
  resolveThreadTarget,
  sanitizeBaseRefSelection,
  withTaskBranchFallback,
  type BaseRefPathEntry,
} from "./base-ref-selection";

const repoPath: BaseRefPathEntry = {
  id: "repo-1",
  path: "/home/dev/repo",
  label: "repo",
  gitRemoteUrl: "git@github.com:acme/repo.git",
};
const worktreePath: BaseRefPathEntry = {
  id: "wt-1",
  path: "/home/dev/repo-worktrees/feat-a",
  label: "feat/a",
  kind: "worktree",
  parentPathId: "repo-1",
  branch: "feat/a",
};
const paths = [repoPath, worktreePath];

describe("sanitizeBaseRefSelection", () => {
  it("round-trips the three selection shapes", () => {
    expect(sanitizeBaseRefSelection({ type: "current" })).toEqual({ type: "current" });
    expect(sanitizeBaseRefSelection({ type: "worktree", pathId: "wt-1" })).toEqual({
      type: "worktree",
      pathId: "wt-1",
    });
    expect(
      sanitizeBaseRefSelection({
        type: "branch",
        baseRef: "main",
        startFromOrigin: true,
        branch: "feat/x",
      })
    ).toEqual({ type: "branch", baseRef: "main", startFromOrigin: true, branch: "feat/x" });
  });

  it("rejects malformed values", () => {
    expect(sanitizeBaseRefSelection(null)).toBeUndefined();
    expect(sanitizeBaseRefSelection("current")).toBeUndefined();
    expect(sanitizeBaseRefSelection({ type: "worktree" })).toBeUndefined();
  });

  it("keeps a bare branch selection (agent-automation workspace preference: default base, auto-derived name)", () => {
    expect(sanitizeBaseRefSelection({ type: "branch", startFromOrigin: true })).toEqual({
      type: "branch",
      baseRef: undefined,
      startFromOrigin: true,
      branch: undefined,
    });
  });

  it("keeps a name-only branch selection (dialog path, default base)", () => {
    expect(
      sanitizeBaseRefSelection({ type: "branch", branch: "feat/x", startFromOrigin: false })
    ).toEqual({ type: "branch", baseRef: undefined, startFromOrigin: false, branch: "feat/x" });
  });
});

describe("isBaseRefSelectionValid", () => {
  it("only constrains worktree selections", () => {
    expect(isBaseRefSelectionValid({ type: "current" }, "repo-1", paths)).toBe(true);
    expect(
      isBaseRefSelectionValid({ type: "branch", baseRef: "main", startFromOrigin: false }, "repo-1", paths)
    ).toBe(true);
  });

  it("requires the worktree to belong to the selected parent", () => {
    expect(isBaseRefSelectionValid({ type: "worktree", pathId: "wt-1" }, "repo-1", paths)).toBe(true);
    expect(isBaseRefSelectionValid({ type: "worktree", pathId: "wt-1" }, "other", paths)).toBe(false);
    expect(isBaseRefSelectionValid({ type: "worktree", pathId: "gone" }, "repo-1", paths)).toBe(false);
  });
});

describe("resolveThreadTarget", () => {
  const base = { pathId: "repo-1", paths, messageSeed: "Fix login" };

  it("runs in the selected path for current/absent selections", () => {
    expect(resolveThreadTarget({ ...base, selection: undefined })).toEqual({ pathId: "repo-1" });
    expect(resolveThreadTarget({ ...base, selection: { type: "current" } })).toEqual({
      pathId: "repo-1",
    });
  });

  it("repoints at a valid worktree and falls back for stale ones", () => {
    expect(
      resolveThreadTarget({ ...base, selection: { type: "worktree", pathId: "wt-1" } })
    ).toEqual({ pathId: "wt-1" });
    expect(
      resolveThreadTarget({ ...base, selection: { type: "worktree", pathId: "gone" } })
    ).toEqual({ pathId: "repo-1" });
  });

  it("builds a worktree spec with the override name when valid", () => {
    expect(
      resolveThreadTarget({
        ...base,
        selection: { type: "branch", baseRef: "main", startFromOrigin: true, branch: "feat/x" },
      })
    ).toEqual({
      pathId: "repo-1",
      worktree: { parentPathId: "repo-1", branch: "feat/x", baseRef: "main", startFromOrigin: true },
    });
  });

  it("derives the branch from the message when the override is missing or invalid", () => {
    const derived = resolveThreadTarget({
      ...base,
      selection: { type: "branch", baseRef: "main", startFromOrigin: false, branch: "bad..name" },
    });
    expect(derived.worktree).toMatchObject({ branch: "feat/fix-login", baseRef: "main" });
    // False origin flag is omitted from the payload entirely.
    expect(derived.worktree?.startFromOrigin).toBeUndefined();
  });

  it("branches from a repo of a folder, never from the folder itself (OS-2647)", () => {
    const folderPaths: BaseRefPathEntry[] = [
      { id: "acme", path: "/code/acme", label: "acme" },
      { id: "new-app", path: "/code/acme/new-app", label: "new-app", kind: "repo", parentPathId: "acme" },
    ];
    const selection = { type: "branch", baseRef: "main", startFromOrigin: false, branch: "feat/x" } as const;
    expect(resolveThreadTarget({ selection, pathId: "acme", paths: folderPaths, messageSeed: "x" })).toEqual({ pathId: "acme" });
    expect(resolveThreadTarget({ selection, pathId: "new-app", paths: folderPaths, messageSeed: "x" })).toEqual({
      pathId: "new-app",
      worktree: { parentPathId: "new-app", branch: "feat/x", baseRef: "main" },
    });
  });
});

describe("withTaskBranchFallback", () => {
  const task = { refId: "OS-808", name: "Fix login crash", taskType: { key: "bug" } };

  it("fills a bare new-worktree selection from the attached task", () => {
    expect(withTaskBranchFallback({ type: "branch", startFromOrigin: false }, task)).toEqual({
      type: "branch",
      startFromOrigin: false,
      branch: "bug/os-808-fix-login-crash",
    });
  });

  it("keeps explicit branch names and non-branch selections", () => {
    const named = { type: "branch" as const, startFromOrigin: false, branch: "feat/custom" };
    expect(withTaskBranchFallback(named, task)).toBe(named);
    const current = { type: "current" as const };
    expect(withTaskBranchFallback(current, task)).toBe(current);
    expect(withTaskBranchFallback(undefined, task)).toBeUndefined();
  });

  it("is a no-op without a task", () => {
    const selection = { type: "branch" as const, startFromOrigin: false };
    expect(withTaskBranchFallback(selection, null)).toBe(selection);
  });
});
