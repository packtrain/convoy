/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ThreadComposerDraft } from "@/lib/threads/draft-storage";
import { useNewThreadComposer } from "./use-new-thread-composer";

function draft(overrides: Partial<ThreadComposerDraft>): ThreadComposerDraft {
  return { text: "", updatedAt: 1, ...overrides };
}

function renderComposer(current: ThreadComposerDraft | undefined) {
  return renderHook(
    (props: { draft: ThreadComposerDraft | undefined }) =>
      useNewThreadComposer({
        profiles: [],
        draft: props.draft,
        setDraft: vi.fn(),
        fallbackCliType: "claude-code",
      }),
    { initialProps: { draft: current } }
  );
}

describe("useNewThreadComposer", () => {
  // OS-1716: the artifact-comments handoff can seed this draft while the
  // composer is mounted, and the tiptap editor only reads its content on mount
  // — so the seed count has to move the scope key callers remount on.
  test("the composer seed key tracks the draft's seed count", () => {
    const { result, rerender } = renderComposer(draft({}));
    const initialKey = result.current.composerSeedKey;

    rerender({ draft: draft({ text: "Seeded", seedCount: 1 }) });
    expect(result.current.composerSeedKey).not.toBe(initialKey);

    // Same count, other fields changed: no remount.
    const seededKey = result.current.composerSeedKey;
    rerender({ draft: draft({ text: "Seeded edited", seedCount: 1 }) });
    expect(result.current.composerSeedKey).toBe(seededKey);
  });
});
