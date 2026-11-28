/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RunFileViewerPanel } from "./run-file-viewer-panel";

const enqueueMock = vi.fn();
let opDoc: Record<string, unknown> | undefined;

vi.mock("convex/react", () => ({
  useMutation: () => enqueueMock,
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : opDoc),
}));

const context = { profileId: "profile_1", pathId: "path_1", isProfileOnline: true };

function completedDiffOp(preRef: string, postRef: string) {
  return {
    _id: "op_1",
    profileId: context.profileId,
    pathId: context.pathId,
    status: "completed",
    kind: "diffFile",
    preRef,
    postRef,
    resultJson: JSON.stringify({ patch: "", truncated: false }),
  };
}

afterEach(cleanup);

// OS-1883: two ranges ending at the same postRef must not share a cache slot.
test("a range and a run sharing a postRef each fetch their own patch", async () => {
  enqueueMock.mockResolvedValue("op_1");
  opDoc = completedDiffOp("refs/pre-a", "refs/post-z");
  const { unmount } = render(
    <RunFileViewerPanel
      diffSummary={{ preRef: "refs/pre-a", postRef: "refs/post-z", files: [] }}
      deriveFilesFromPatch
      context={context}
    />
  );
  await screen.findByText("No changes between these checkpoints.");
  expect(enqueueMock).toHaveBeenCalledTimes(1);
  unmount();

  opDoc = completedDiffOp("refs/pre-z", "refs/post-z");
  render(
    <RunFileViewerPanel
      diffSummary={{ preRef: "refs/pre-z", postRef: "refs/post-z", files: [] }}
      deriveFilesFromPatch
      context={context}
    />
  );
  expect(enqueueMock).toHaveBeenCalledTimes(2);
  expect(enqueueMock).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "diffFile", preRef: "refs/pre-z", postRef: "refs/post-z" })
  );
});

// OS-2522: repos of one folder share checkpoint ref names, so the checkout is part of the cache key.
test("two repos with the same refs each fetch their own patch", async () => {
  enqueueMock.mockReset();
  enqueueMock.mockResolvedValue("op_1");
  const summary = { preRef: "refs/convoy/pre", postRef: "refs/convoy/post", files: [] };
  opDoc = { ...completedDiffOp(summary.preRef, summary.postRef), pathId: "repo_old" };
  const { unmount } = render(
    <RunFileViewerPanel diffSummary={summary} deriveFilesFromPatch context={{ ...context, pathId: "repo_old" }} />
  );
  await screen.findByText("No changes between these checkpoints.");
  unmount();

  opDoc = undefined;
  render(<RunFileViewerPanel diffSummary={summary} deriveFilesFromPatch context={{ ...context, pathId: "repo_new" }} />);
  expect(enqueueMock).toHaveBeenCalledTimes(2);
  expect(enqueueMock).toHaveBeenLastCalledWith(expect.objectContaining({ pathId: "repo_new" }));
  expect(screen.queryByText("No changes between these checkpoints.")).toBeNull();
});

vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: () => <div>Rendered patch</div>,
  File: () => <div>File content</div>,
}));

test("the optional tree uses patch files and expands and scrolls to a selected file", async () => {
  enqueueMock.mockResolvedValue("op_1");
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  opDoc = {
    ...completedDiffOp("tree-pre", "tree-post"),
    resultJson: JSON.stringify({ patch: "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n", truncated: false }),
  };
  const props = {
    diffSummary: { preRef: "tree-pre", postRef: "tree-post", files: [] },
    deriveFilesFromPatch: true,
    context,
    allCollapsed: true,
  };
  const { rerender } = render(<RunFileViewerPanel {...props} />);
  await screen.findByText("app.ts");
  expect(screen.queryByRole("complementary", { name: "Changed files" })).toBeNull();
  rerender(<RunFileViewerPanel {...props} fileTreeOpen />);
  const tree = screen.getByRole("complementary", { name: "Changed files" });
  const file = within(tree).getByRole("button", { name: /app.ts/ });
  fireEvent.click(file);
  expect(scroll).toHaveBeenCalledWith({ block: "start" });
  expect(file.getAttribute("aria-current")).toBe("true");
  expect(screen.getByText("Rendered patch")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open file" }));
  fireEvent.click(file);
  expect(screen.getByText("Rendered patch")).toBeTruthy();
  scroll.mockClear();
  fireEvent.click(file);
  expect(scroll).toHaveBeenCalledOnce();
});


test("file tree width supports dragging, keyboard steps, and persistence", async () => {
  window.localStorage.clear();
  enqueueMock.mockResolvedValue("op_1");
  opDoc = completedDiffOp("resize-pre", "resize-post");
  const props = {
    diffSummary: { preRef: "resize-pre", postRef: "resize-post", files: [
      { path: "file.ts", kind: "modified" as const, additions: 1, deletions: 0, binary: false },
    ] },
    context,
    fileTreeOpen: true,
  };
  const view = render(<RunFileViewerPanel {...props} />);
  const handle = await screen.findByRole("separator", { name: "Resize file tree" });
  expect(handle.getAttribute("aria-valuenow")).toBe("224");
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(handle.getAttribute("aria-valuenow")).toBe("240");
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    right: 1000, left: 0, width: 1000, top: 0, bottom: 600, height: 600, x: 0, y: 0, toJSON: () => ({}),
  });
  fireEvent.mouseDown(handle);
  fireEvent.mouseMove(document, { clientX: 640 });
  fireEvent.mouseUp(document);
  expect(handle.getAttribute("aria-valuenow")).toBe("360");
  view.unmount();
  render(<RunFileViewerPanel {...props} />);
  const restored = screen.getByRole("separator", { name: "Resize file tree" });
  expect(restored.getAttribute("aria-valuenow")).toBe("360");
  expect(screen.getByRole("complementary", { name: "Changed files" }).parentElement?.style.width).toBe("360px");
  rect.mockRestore();
  window.localStorage.clear();
});

test("a failed fetch offers Retry, which requests the file again", async () => {
  enqueueMock.mockReset();
  enqueueMock.mockRejectedValueOnce(new Error("CLI unreachable")).mockResolvedValue("op_retry");
  opDoc = undefined;
  render(
    <RunFileViewerPanel
      diffSummary={{ preRef: "refs/pre-retry", postRef: "refs/post-retry", files: [] }}
      deriveFilesFromPatch
      context={context}
    />
  );

  await screen.findByText("CLI unreachable");
  expect(enqueueMock).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  expect(enqueueMock).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("CLI unreachable")).toBeNull();
});

test("fetch states name the CLI, not an agent", async () => {
  enqueueMock.mockReset();
  enqueueMock.mockReturnValue(new Promise(() => {}));
  opDoc = undefined;
  const props = { diffSummary: { preRef: "refs/pre-copy", postRef: "refs/post-copy", files: [] }, deriveFilesFromPatch: true };
  const { rerender } = render(<RunFileViewerPanel {...props} context={context} />);
  expect(screen.getByText("Fetching from CLI…")).toBeTruthy();

  rerender(<RunFileViewerPanel {...props} context={{ ...context, isProfileOnline: false }} />);
  expect(screen.getByText(/^CLI offline\./)).toBeTruthy();
  expect(screen.queryByText(/agent/i)).toBeNull();
});
