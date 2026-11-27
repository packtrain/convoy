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
});
