/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";
import { useCreateThreadSubmit } from "./use-create-thread-submit";

const toastErrorMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

const create = vi.fn().mockResolvedValue("thread_1");
const addToGroup = vi.fn().mockResolvedValue({ threadId: "thread_1", containerId: "group_1" });
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "cli/threads/core:create" ? create : addToGroup,
}));

function setup(overrides: Partial<Parameters<typeof useCreateThreadSubmit>[0]> = {}) {
  return renderHook(() => useCreateThreadSubmit({
    profiles: [{
      _id: "profile_1" as Id<"cliProfiles">,
      paths: [
        { id: "repo", path: "/repo", label: "repo", gitRemoteUrl: "https://github.com/example/repo" },
        { id: "wt", path: "/wt", label: "wt", kind: "worktree", parentPathId: "repo", branch: "feat/worktree" },
      ],
    }],
    draftState: {
      profileId: "profile_1", pathId: "repo", cliType: "codex", mode: "agent",
      cliModel: undefined, cliEffort: undefined, baseRef: undefined,
    },
    prepareAttachmentsForSubmit: async () => [],
    clearAfterSubmit: vi.fn(), setDraft: vi.fn(), rememberCliModel: vi.fn(),
    ...overrides,
  }));
}

function cacheBranch(profileId: string, pathId: string, branch: string) {
  window.localStorage.setItem(`convoy.base-ref-refs:${profileId}:${pathId}`,
    JSON.stringify({ refs: [{ name: branch, isCurrent: true, remoteOnly: false }] }));
}

describe("new-thread branch snapshot", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); });

  test.each([false, true])("forwards the first runtime command into creation, group=%s", async (group) => {
    const { result } = setup(group ? { sourceThreadId: "source_1" as Id<"cliThreads"> } : {});
    await act(() => result.current.handleSubmit({ text: "/usage", files: [], runtimeCommand: true }));
    expect(group ? addToGroup : create).toHaveBeenCalledWith(expect.objectContaining({
      content: "/usage", runtimeCommand: true,
    }));
  });

  test.each([false, true])("carries the scanned local branch into creation, group=%s", async (group) => {
    cacheBranch("profile_1", "repo", "feat/visible");
    const { result } = setup(group ? { sourceThreadId: "source_1" as Id<"cliThreads"> } : {});
    await act(() => result.current.handleSubmit({ text: "Hello", files: [] }));
    expect(group ? addToGroup : create).toHaveBeenCalledWith(expect.objectContaining({
      initialBranch: "feat/visible", pathId: "repo",
    }));
  });

  test("does not borrow a branch from another profile or path", async () => {
    cacheBranch("other_profile", "repo", "feat/other-profile");
    cacheBranch("profile_1", "other_path", "feat/other-path");
    const { result } = setup();
    await act(() => result.current.handleSubmit({ text: "Hello", files: [] }));
    expect(create.mock.calls.at(-1)?.[0]).not.toHaveProperty("initialBranch", expect.any(String));
  });

  test.each(["existing", "new"])("does not seed a %s worktree with the parent branch", async (kind) => {
    cacheBranch("profile_1", "repo", "feat/parent");
    const { result } = setup({ draftState: {
      profileId: "profile_1", pathId: "repo", cliType: "codex", mode: "agent",
      cliModel: undefined, cliEffort: undefined,
      baseRef: kind === "existing" ? { type: "worktree", pathId: "wt" }
        : { type: "branch", branch: "feat/new", startFromOrigin: false },
    } });
    await act(() => result.current.handleSubmit({ text: "Hello", files: [] }));
    expect(create.mock.calls.at(-1)?.[0]).not.toHaveProperty("initialBranch", "feat/parent");
  });
});

test("a permission denial (role revoked mid-session) toasts friendly copy, not the server string", async () => {
  create.mockRejectedValueOnce(new ConvexError("Permission denied: cli:thread"));
  const { result } = setup();
  await act(() => expect(result.current.handleSubmit({ text: "Hello", files: [] })).rejects.toBeInstanceOf(ConvexError));
  expect(toastErrorMock).toHaveBeenCalledWith(PERMISSION_DENIED_MESSAGE);
  cleanup();
});

test("a Guide run passes its head and leaves the new-thread model default alone (OS-2412)", async () => {
  const rememberCliModel = vi.fn();
  const { result } = setup({ rememberCliModel, pullRequestGuide: { headSha: "h1" } });
  await act(() => result.current.handleSubmit({ text: "Write a guide", files: [] }));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ pullRequestGuide: { headSha: "h1" } }));
  expect(rememberCliModel).not.toHaveBeenCalled();
  cleanup();

  const plain = setup({ rememberCliModel });
  await act(() => plain.result.current.handleSubmit({ text: "Hello", files: [] }));
  expect(rememberCliModel).toHaveBeenCalled();
});
