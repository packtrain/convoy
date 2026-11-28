/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChangesRepo } from "./use-changes-repo";

const repos = [
  { id: "r-new", label: "new-app" },
  { id: "r-old", label: "old-app" },
];
const run = (id: string, repo: string, pathId: string) => ({
  _id: id,
  role: "assistant",
  diffSummary: { preRef: `pre-${id}`, postRef: `post-${id}`, files: [{ path: "a.ts", repo }], repos: [{ path: repo, pathId }] },
});

describe("useChangesRepo", () => {
  test("settles the default once, so a new run in another repo doesn't move an open view", () => {
    localStorage.clear();
    const { result, rerender } = renderHook(({ envelopes }) => useChangesRepo("thread_1", repos, envelopes, true), {
      initialProps: { envelopes: [run("m1", "old-app", "r-old")] },
    });
    expect(result.current.repo?.id).toBe("r-old");

    rerender({ envelopes: [run("m1", "old-app", "r-old"), run("m2", "new-app", "r-new")] });
    expect(result.current.repo?.id).toBe("r-old");
    // Narrowed to the repo: the other repo's run carries no summary.
    expect(result.current.envelopes.map((message) => message.diffSummary?.postRef)).toEqual(["post-m1", undefined]);

    act(() => result.current.select("r-new"));
    expect(result.current.repo?.id).toBe("r-new");
  });

  test("waits for the messages before settling", () => {
    localStorage.clear();
    const { result, rerender } = renderHook(({ envelopes, ready }) => useChangesRepo("thread_1", repos, envelopes, ready), {
      initialProps: { envelopes: [] as ReturnType<typeof run>[], ready: false },
    });
    expect(result.current.repo?.id).toBe("r-new");
    rerender({ envelopes: [run("m1", "old-app", "r-old")], ready: true });
    expect(result.current.repo?.id).toBe("r-old");
  });

  test("a repo thread defaults to its own checkout, listed first, whatever the runs changed (OS-2647)", () => {
    localStorage.clear();
    const { result } = renderHook(() => useChangesRepo("thread_1", repos, [run("m1", "old-app", "r-old")], true, { ownFirst: true }));
    expect(result.current.repo?.id).toBe("r-new");
  });

  test("an older CLI's run without repos belongs to a repo thread's own checkout only", () => {
    localStorage.clear();
    const legacy = { _id: "m1", role: "assistant", diffSummary: { preRef: "pre", postRef: "post", files: [{ path: "a.ts" }] } };
    const { result } = renderHook(() => useChangesRepo("thread_1", repos, [legacy], true, { ownFirst: true }));
    expect(result.current.envelopes[0].diffSummary?.postRef).toBe("post");

    act(() => result.current.select("r-old"));
    expect(result.current.envelopes[0].diffSummary).toBeUndefined();
  });
});
