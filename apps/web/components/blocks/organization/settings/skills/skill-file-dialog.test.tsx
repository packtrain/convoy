/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SkillFileDialog } from "./skill-file-dialog";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
      return <textarea aria-label="File content" value={value} onChange={(event) => onChange(event.target.value)} />;
    },
}));

describe("SkillFileDialog", () => {
  afterEach(() => {
    cleanup();
  });

  test("add mode collects the path and markdown content, then hands the file back", () => {
    const onSave = vi.fn();

    render(<SkillFileDialog file={null} takenPaths={[]} onSave={onSave} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Create file" })).toBeDefined();
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: " references/fields.md " } });
    fireEvent.change(screen.getByLabelText("File content"), { target: { value: "# Fields" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onSave).toHaveBeenCalledWith({ path: "references/fields.md", content: "# Fields" });
  });

  test("rejects a path with no file name", () => {
    const onSave = vi.fn();

    render(<SkillFileDialog file={null} takenPaths={[]} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "references/" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByText("Include a file name in the path, like references/fields.md")).toBeDefined();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("rejects a path another draft file already uses", () => {
    const onSave = vi.fn();

    render(<SkillFileDialog file={null} takenPaths={["notes.md"]} onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "notes.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByText("A file with this path already exists in this skill")).toBeDefined();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("edit mode seeds from the file and returns the renamed draft", () => {
    const onSave = vi.fn();

    render(
      <SkillFileDialog
        file={{ path: "references/fields.md", content: "# Fields" }}
        takenPaths={[]}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Edit file" })).toBeDefined();
    expect((screen.getByLabelText("Path") as HTMLInputElement).value).toBe("references/fields.md");
    expect((screen.getByLabelText("File content") as HTMLTextAreaElement).value).toBe("# Fields");

    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "references/renamed.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onSave).toHaveBeenCalledWith({ path: "references/renamed.md", content: "# Fields" });
  });
});
