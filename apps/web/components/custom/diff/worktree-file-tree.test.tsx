/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import { WorktreeFileTree } from "./worktree-file-tree";

const FILES: CliRunDiffFile[] = [
  { path: "src/a.ts", kind: "modified", additions: 2, deletions: 1 },
  { path: "src/old.ts", kind: "deleted", additions: 0, deletions: 9 },
  { path: "README.md", kind: "added", additions: 5, deletions: 0 },
];

describe("WorktreeFileTree", () => {
  afterEach(cleanup);

  test("reports the clicked file and marks it selected", () => {
    const onSelectFile = vi.fn();
    render(<WorktreeFileTree files={FILES} selectedPath="README.md" onSelectFile={onSelectFile} />);

    fireEvent.click(screen.getByRole("button", { name: "a.ts+2-1" }));

    expect(onSelectFile).toHaveBeenCalledWith("src/a.ts");
    expect(screen.getByRole("button", { name: "README.md+5-0" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("old.ts").classList.contains("line-through")).toBe(true);
  });

  test("right-click offers Open file on every row, disabled on deleted files (OS-2041)", () => {
    const onOpenFile = vi.fn();
    render(<WorktreeFileTree files={FILES} onSelectFile={() => {}} onOpenFile={onOpenFile} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: /a\.ts/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open file" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");

    fireEvent.contextMenu(screen.getByRole("button", { name: /old\.ts/ }));
    const item = screen.getByRole("menuitem", { name: "Open file" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  test("right-click offers Revert for any file, disabled while a revert runs (OS-2043)", () => {
    const onRevertFile = vi.fn();
    const { rerender } = render(<WorktreeFileTree files={FILES} onSelectFile={() => {}} onRevertFile={onRevertFile} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: /old\.ts/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Revert" }));
    expect(onRevertFile).toHaveBeenCalledWith(FILES[1]);

    rerender(<WorktreeFileTree files={FILES} onSelectFile={() => {}} onRevertFile={onRevertFile} reverting />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /a\.ts/ }));
    expect(screen.getByRole("menuitem", { name: "Revert" }).getAttribute("aria-disabled")).toBe("true");
  });

  test("right-click offers Download, disabled on deleted files (OS-2050)", () => {
    const onDownloadFile = vi.fn();
    render(<WorktreeFileTree files={FILES} onSelectFile={() => {}} onDownloadFile={onDownloadFile} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: /README/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(onDownloadFile).toHaveBeenCalledWith("README.md");

    fireEvent.contextMenu(screen.getByRole("button", { name: /old\.ts/ }));
    expect(screen.getByRole("menuitem", { name: "Download" }).getAttribute("aria-disabled")).toBe("true");
  });

  test("collapsing a folder hides its files and keeps the folder totals", () => {
    render(<WorktreeFileTree files={FILES} onSelectFile={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "src+2-10" }));

    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.getByRole("button", { name: "src+2-10" }).getAttribute("aria-expanded")).toBe("false");
  });

  test("shows vscode-icons for files and folders, swapping the folder icon when collapsed", () => {
    render(<WorktreeFileTree files={FILES} onSelectFile={() => {}} />);
    const iconOf = (name: string) => screen.getByRole("button", { name }).querySelector("img")?.getAttribute("src");

    expect(iconOf("a.ts+2-1")).toBe("/file-icons/file_type_typescript.svg");
    expect(iconOf("README.md+5-0")).toBe("/file-icons/file_type_markdown.svg");
    expect(iconOf("src+2-10")).toBe("/file-icons/folder_type_src_opened.svg");
    fireEvent.click(screen.getByRole("button", { name: "src+2-10" }));
    expect(iconOf("src+2-10")).toBe("/file-icons/folder_type_src.svg");
  });
});
