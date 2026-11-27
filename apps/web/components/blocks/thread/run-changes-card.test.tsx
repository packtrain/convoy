/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import { RunChangesCard } from "./run-changes-card";

afterEach(cleanup);

const file = (index: number): CliRunDiffFile => ({
  path: `src/file-${index}.ts`,
  kind: "modified",
  additions: 2,
  deletions: 1,
});

/**
 * The envelope-sized preview (OS-1600): 5 leading rows, but totals and the
 * file count describe all 40 stored files.
 */
const preview = {
  preRef: "refs/pre",
  postRef: "refs/post",
  files: Array.from({ length: 5 }, (_, index) => file(index)),
  fileCount: 40,
  additions: 80,
  deletions: 40,
};

describe("RunChangesCard", () => {
  test("renders header totals from the preview, not from the previewed rows", () => {
    render(<RunChangesCard diffSummary={preview} />);

    expect(screen.getByText("Edited 40 files")).toBeDefined();
    expect(screen.getByText("+80")).toBeDefined();
    expect(screen.getByText("-40")).toBeDefined();
  });

  test("collapsed shows the first three rows and offers the rest", () => {
    render(<RunChangesCard diffSummary={preview} />);

    expect(screen.getByText("file-0.ts")).toBeDefined();
    expect(screen.getByText("file-2.ts")).toBeDefined();
    expect(screen.queryByText("file-3.ts")).toBeNull();
    expect(screen.getByRole("button", { name: /show 37 more files/i })).toBeDefined();
  });

  test("expanding asks the host to load the full list and shows a spinner meanwhile", () => {
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <RunChangesCard diffSummary={preview} onExpandedChange={onExpandedChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: /show 37 more files/i }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);

    // Still loading: the preview rows stay put so the card never flashes empty.
    expect(screen.getByText(/loading files/i)).toBeDefined();
    expect(screen.getByText("file-0.ts")).toBeDefined();

    // The fetched list lands.
    rerender(
      <RunChangesCard
        diffSummary={preview}
        allFiles={Array.from({ length: 40 }, (_, index) => file(index))}
        onExpandedChange={onExpandedChange}
      />
    );

    expect(screen.getByText("file-39.ts")).toBeDefined();
    expect(screen.queryByText(/loading files/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /show fewer files/i })
    ).toBeDefined();
  });

  test("a run inside the preview slice needs no fetch to expand fully", () => {
    const small = {
      ...preview,
      files: Array.from({ length: 4 }, (_, index) => file(index)),
      fileCount: 4,
      additions: 8,
      deletions: 4,
    };
    render(<RunChangesCard diffSummary={small} allFiles={small.files} />);

    fireEvent.click(screen.getByRole("button", { name: /show 1 more file/i }));

    expect(screen.getByText("file-3.ts")).toBeDefined();
    expect(screen.queryByText(/loading files/i)).toBeNull();
  });

  test("expanding a complete preview shows no spinner even with no fetched list", () => {
    // The common case: the preview (5 rows) already holds every file, so the
    // host never issues a fetch and `allFiles` stays undefined. The card must
    // not read that as "loading" (OS-1600).
    const small = {
      ...preview,
      files: Array.from({ length: 4 }, (_, index) => file(index)),
      fileCount: 4,
      additions: 8,
      deletions: 4,
    };
    render(<RunChangesCard diffSummary={small} />);

    fireEvent.click(screen.getByRole("button", { name: /show 1 more file/i }));

    expect(screen.getByText("file-3.ts")).toBeDefined();
    expect(screen.queryByText(/loading files/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /show fewer files/i })
    ).toBeDefined();
  });

  test("renders nothing when the run changed no files", () => {
    const { container } = render(
      <RunChangesCard
        diffSummary={{ ...preview, files: [], fileCount: 0, additions: 0, deletions: 0 }}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  test("Review opens the viewer on the first previewed file", () => {
    const onSelectFile = vi.fn();
    render(<RunChangesCard diffSummary={preview} onSelectFile={onSelectFile} />);

    fireEvent.click(screen.getByRole("button", { name: /^review$/i }));

    expect(onSelectFile).toHaveBeenCalledWith(preview.files[0]);
  });
});

describe("RunChangesCard in a multi-repo folder", () => {
  const multiRepo = {
    preRef: "refs/pre",
    postRef: "refs/post",
    files: [
      { path: "src/a.ts", kind: "modified" as const, additions: 1, deletions: 0, repo: "new-app" },
      { path: "src/b.ts", kind: "added" as const, additions: 2, deletions: 0, repo: "old-app" },
    ],
    fileCount: 2,
    additions: 3,
    deletions: 0,
    repos: [
      { path: "new-app", pathId: "repo-new", fileCount: 1, additions: 1, deletions: 0 },
      { path: "old-app", fileCount: 1, additions: 2, deletions: 0 },
    ],
  };

  test("groups files under a repo header and keeps totals for the whole run", () => {
    render(<RunChangesCard diffSummary={multiRepo} onUndo={vi.fn()} />);

    expect(screen.getByText("Edited 2 files")).toBeDefined();
    expect(screen.getByText("new-app")).toBeDefined();
    expect(screen.getByText("old-app")).toBeDefined();
    // Undo restores one checkout; a multi-repo run has several.
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  test("mentions a file by its path in the folder, and offers ops only for a known repo entry", () => {
    const onMentionFile = vi.fn();
    const onRevertFile = vi.fn();
    render(<RunChangesCard diffSummary={multiRepo} onMentionFile={onMentionFile} onRevertFile={onRevertFile} onSelectFile={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Mention new-app/src/a.ts in reply" }));
    expect(onMentionFile).toHaveBeenCalledWith("new-app/src/a.ts");
    fireEvent.click(screen.getByRole("button", { name: "Revert new-app/src/a.ts" }));
    expect(onRevertFile).toHaveBeenCalledWith(multiRepo.files[0]);
    // old-app has no repo entry yet, so nothing can address it.
    expect(screen.queryByRole("button", { name: "Revert old-app/src/b.ts" })).toBeNull();
  });
});
