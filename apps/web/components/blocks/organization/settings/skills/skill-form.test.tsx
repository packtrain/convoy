/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkillForm, type SkillFormValues } from "./skill-form";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
      return <textarea aria-label="Skill editor" value={value} onChange={(event) => onChange(event.target.value)} />;
    },
}));

const initialValues: SkillFormValues = {
  name: "",
  description: "",
  category: "",
  content: "",
  files: [],
};

function fieldContainer(label: string): HTMLElement {
  const field = screen.getByLabelText(label);
  const container = field.closest("[data-slot='form-item'], .grid.gap-2");

  if (!(container instanceof HTMLElement)) {
    throw new Error(`No field container for ${label}`);
  }

  return container;
}

describe("SkillForm", () => {
  beforeAll(() => {
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserver);
  });

  afterEach(() => {
    cleanup();
  });

  test("renders name, category, description, and the SKILL.md editor", () => {
    render(<SkillForm mode="create" resetKey="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText("Name")).toBeDefined();
    expect(screen.getByLabelText("Category")).toBeDefined();
    expect(screen.getByLabelText("Description")).toBeDefined();
    expect(screen.getByRole("button", { name: "Create" })).toBeDefined();
  });

  test("validates on blur, not while typing", async () => {
    render(<SkillForm mode="create" resetKey="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "a" } });

    await waitFor(() => {
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("a");
    });
    expect(screen.queryByText("Name must be at least 2 characters")).toBeNull();

    fireEvent.blur(screen.getByLabelText("Name"));

    expect(await screen.findByText("Name must be at least 2 characters")).toBeDefined();
  });

  test("side-by-side Details fields stay top-aligned when one shows a validation error", async () => {
    render(<SkillForm mode="create" resetKey="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "a" } });
    fireEvent.blur(screen.getByLabelText("Name"));

    expect(await screen.findByText("Name must be at least 2 characters")).toBeDefined();
    // The error grows the grid row; a stretched field would center its label.
    expect(fieldContainer("Name").className).toContain("self-start");
    expect(fieldContainer("Category").className).toContain("self-start");
  });

  test("clears a validation error while the user types a valid value", async () => {
    render(<SkillForm mode="create" resetKey="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "a" } });
    fireEvent.blur(screen.getByLabelText("Name"));
    expect(await screen.findByText("Name must be at least 2 characters")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ab" } });

    await waitFor(() => {
      expect(screen.queryByText("Name must be at least 2 characters")).toBeNull();
    });
  });

  test("keeps unsaved edits when the same skill re-emits, and re-seeds for a different one", async () => {
    const seeded: SkillFormValues = { name: "pdf-tools", description: "", category: "", content: "# PDF tools", files: [] };
    const view = render(
      <SkillForm mode="edit" resetKey="skill_1" initialValues={seeded} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText("Skill editor"), { target: { value: "# Unsaved work" } });

    // A file mutation bumps `version`, so the skill query re-emits an equal but
    // fresh object — that must not discard the draft.
    view.rerender(
      <SkillForm mode="edit" resetKey="skill_1" initialValues={{ ...seeded }} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />
    );

    await waitFor(() => {
      expect((screen.getByLabelText("Skill editor") as HTMLTextAreaElement).value).toBe("# Unsaved work");
    });

    view.rerender(
      <SkillForm
        mode="edit"
        resetKey="skill_2"
        initialValues={{ ...seeded, content: "# Other skill" }}
        canManage
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await waitFor(() => {
      expect((screen.getByLabelText("Skill editor") as HTMLTextAreaElement).value).toBe("# Other skill");
    });
  });

  test("a file added through the dialog is submitted with the form, not written on its own", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SkillForm
        mode="create"
        resetKey="create"
        initialValues={{ ...initialValues, name: "pdf-tools", content: "# PDF tools" }}
        canManage
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add file" }));
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "references/fields.md" } });
    // The dialog mounts its own editor instance; the page's is the first one.
    fireEvent.change(screen.getAllByLabelText("Skill editor")[1], { target: { value: "# Fields" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByText("references/fields.md")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: "pdf-tools", files: [{ path: "references/fields.md", content: "# Fields" }] }),
        expect.anything()
      );
    });
  });

  test("the metadata fields are typed by the user and submitted as the skill's source", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SkillForm
        mode="create"
        resetKey="create"
        initialValues={{ ...initialValues, name: "pdf-tools", content: "# PDF tools" }}
        canManage
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: "https://github.com/anthropics/skills" } });
    fireEvent.change(screen.getByLabelText("Commit"), { target: { value: "0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12" } });
    fireEvent.change(screen.getByLabelText("Ref"), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText("Subpath"), { target: { value: "document-skills/pdf" } });
    // The section is inputs only; the list row carries the link to the source.
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          source: {
            repoUrl: "https://github.com/anthropics/skills",
            commitSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f0abcdef12",
            ref: "main",
            subpath: "document-skills/pdf",
          },
        }),
        expect.anything()
      );
    });
  });

  test("pasting a github URL splits it across the metadata fields", async () => {
    render(<SkillForm mode="create" resetKey="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.paste(screen.getByLabelText("Repository URL"), {
      clipboardData: { getData: () => "https://github.com/dmmulroy/anti-slop/tree/main/skills/install-anti-slop" },
    });

    await waitFor(() => {
      expect((screen.getByLabelText("Repository URL") as HTMLInputElement).value).toBe("https://github.com/dmmulroy/anti-slop");
    });
    expect((screen.getByLabelText("Subpath") as HTMLInputElement).value).toBe("skills/install-anti-slop");
    expect((screen.getByLabelText("Ref") as HTMLInputElement).value).toBe("main");
    expect((screen.getByLabelText("Commit") as HTMLInputElement).value).toBe("");
  });

  test("any single metadata field saves on its own, but a commit must look like one", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SkillForm
        mode="create"
        resetKey="create"
        initialValues={{ ...initialValues, name: "pdf-tools", content: "# PDF tools" }}
        canManage
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: "https://github.com/anthropics/skills" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      // The form holds strings; `skillSourceFromFields` drops the blank ones on save.
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ source: { repoUrl: "https://github.com/anthropics/skills", commitSha: "", ref: "", subpath: "" } }),
        expect.anything()
      );
    });

    // Optional does not mean unchecked: a branch name in the commit field is still
    // not a version.
    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText("Commit"), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Commit must be 7 to 64 hex characters")).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("lowercases the name and drops a typed leading slash", async () => {
    render(<SkillForm mode="create" resetKey="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "PDF-Tools" } });

    await waitFor(() => {
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("pdf-tools");
    });

    // The `/` is an addon, so it never becomes part of the stored name — including
    // a pasted path-like value.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "/other-skill" } });

    await waitFor(() => {
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("other-skill");
    });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "pdf/tools" } });

    await waitFor(() => {
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("pdftools");
    });
  });
});
