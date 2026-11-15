/**
 * @vitest-environment jsdom
 */
import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorktreeOp } from "./use-worktree-op";

const state = vi.hoisted(() => ({
  op: undefined as unknown,
  enqueue: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (_reference: unknown, args: unknown) => (args === "skip" ? undefined : state.op),
  useMutation: () => state.enqueue,
}));

function opRow(overrides: Record<string, unknown>) {
  return {
    _id: "op_1",
    profileId: "profile_1",
    pathId: "path_a",
    kind: "worktreeChanges",
    status: "pending",
    ...overrides,
  };
}

function render(pathId = "path_a") {
  return renderHook(
    (props: { pathId: string }) =>
      useWorktreeOp({
        profileId: "profile_1" as Id<"cliProfiles">,
        pathId: props.pathId,
        kind: "worktreeChanges",
        enabled: true,
      }),
    { initialProps: { pathId } }
  );
}

describe("useWorktreeOp", () => {
  beforeEach(() => {
    state.op = undefined;
    state.enqueue.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("settles on a done op and stops loading", async () => {
    state.enqueue.mockResolvedValueOnce("op_1");
    const { result, rerender } = render();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(state.enqueue).toHaveBeenCalledTimes(1));
    state.op = opRow({ status: "done", resultJson: '{"patch":"x"}' });
    rerender({ pathId: "path_a" });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resultJson).toBe('{"patch":"x"}');
    expect(result.current.error).toBeNull();
  });

  test("a rejected refresh after a success reports the error and keeps the patch", async () => {
    state.enqueue.mockResolvedValueOnce("op_1");
    const { result, rerender } = render();
    await waitFor(() => expect(state.enqueue).toHaveBeenCalledTimes(1));
    state.op = opRow({ status: "done", resultJson: '{"patch":"x"}' });
    rerender({ pathId: "path_a" });
    await waitFor(() => expect(result.current.loading).toBe(false));

    state.enqueue.mockRejectedValueOnce(new Error("Request failed"));
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.error).toBe("Request failed"));
    expect(result.current.loading).toBe(false);
    expect(result.current.resultJson).toBe('{"patch":"x"}');
  });

  test("a pending row that disappears settles as expired instead of loading forever", async () => {
    state.enqueue.mockResolvedValueOnce("op_1");
    const { result, rerender } = render();
    await waitFor(() => expect(state.enqueue).toHaveBeenCalledTimes(1));
    state.op = opRow({ status: "pending" });
    rerender({ pathId: "path_a" });
    expect(result.current.loading).toBe(true);

    state.op = null;
    rerender({ pathId: "path_a" });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/Refresh/);
  });

  test("a result for another path is not shown after switching", async () => {
    state.enqueue.mockResolvedValueOnce("op_1").mockResolvedValueOnce("op_2");
    const { result, rerender } = render();
    await waitFor(() => expect(state.enqueue).toHaveBeenCalledTimes(1));
    state.op = opRow({ status: "done", resultJson: '{"patch":"a"}' });
    rerender({ pathId: "path_a" });
    await waitFor(() => expect(result.current.resultJson).toBe('{"patch":"a"}'));

    state.op = undefined;
    rerender({ pathId: "path_b" });

    expect(result.current.resultJson).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(state.enqueue).toHaveBeenCalledTimes(2));
  });

  test("a file path is sent with the op and keys the result (OS-2041)", async () => {
    state.enqueue.mockResolvedValueOnce("op_1").mockResolvedValueOnce("op_2");
    const { result, rerender } = renderHook(
      (props: { filePath: string }) =>
        useWorktreeOp({
          profileId: "profile_1" as Id<"cliProfiles">,
          pathId: "path_a",
          kind: "readFile",
          filePath: props.filePath,
          enabled: true,
        }),
      { initialProps: { filePath: "a.ts" } }
    );
    await waitFor(() => expect(state.enqueue).toHaveBeenCalledTimes(1));
    expect(state.enqueue).toHaveBeenCalledWith({ profileId: "profile_1", kind: "readFile", pathId: "path_a", filePath: "a.ts" });
    state.op = opRow({ kind: "readFile", status: "done", resultJson: '{"content":"a"}' });
    rerender({ filePath: "a.ts" });
    await waitFor(() => expect(result.current.resultJson).toBe('{"content":"a"}'));

    state.op = undefined;
    rerender({ filePath: "b.ts" });

    expect(result.current.resultJson).toBeUndefined();
    await waitFor(() => expect(state.enqueue).toHaveBeenCalledTimes(2));
  });

  test("StrictMode's doubled effect enqueues once", async () => {
    state.enqueue.mockResolvedValue("op_1");
    renderHook(
      () =>
        useWorktreeOp({
          profileId: "profile_1" as Id<"cliProfiles">,
          pathId: "path_a",
          kind: "worktreeChanges",
          enabled: true,
        }),
      { wrapper: StrictMode }
    );

    await waitFor(() => expect(state.enqueue).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });
});
