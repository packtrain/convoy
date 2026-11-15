/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SkillFile } from "@/convex/lib/contracts/skills";
import { SkillFileList } from "./skill-file-list";
import { expectEmptyState } from "@/test-utils/empty-state";

vi.mock("./skill-file-dialog", () => ({
  SkillFileDialog: ({ file, onSave }: { file: SkillFile | null; onSave: (file: SkillFile) => void }) => (
    <div data-testid="skill-file-dialog">
      {file?.path ?? "new-file"}
      <button type="button" onClick={() => onSave({ path: "saved.md", content: "saved" })}>
        Save from dialog
      </button>
    </div>
  ),
}));

const fields: SkillFile = { path: "references/fields.md", content: "# Fields" };

describe("SkillFileList", () => {
  afterEach(() => {
    cleanup();
  });

  test("deleting a file asks for confirmation first, then drops it from the draft", async () => {
    const onChange = vi.fn();

    render(<SkillFileList files={[fields]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete references/fields.md" }));
    expect(onChange).not.toHaveBeenCalled();

    expect(await screen.findByText("Delete references/fields.md?")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  test("an empty file set offers the add dialog from the empty state", () => {
    const onChange = vi.fn();

    const { container } = render(<SkillFileList files={[]} onChange={onChange} />);

    expectEmptyState("No additional files", {
      boundary: container.firstElementChild as HTMLElement,
      action: { role: "button", name: "Add file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add file" }));

    expect(screen.getByTestId("skill-file-dialog").textContent).toContain("new-file");
    fireEvent.click(screen.getByRole("button", { name: "Save from dialog" }));

    expect(onChange).toHaveBeenCalledWith([{ path: "saved.md", content: "saved" }]);
  });

  test("editing a file replaces it in place instead of adding a second entry", () => {
    const onChange = vi.fn();

    render(<SkillFileList files={[fields, { path: "notes.md", content: "keep" }]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "references/fields.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Save from dialog" }));

    expect(onChange).toHaveBeenCalledWith([
      { path: "saved.md", content: "saved" },
      { path: "notes.md", content: "keep" },
    ]);
  });
});
