/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SlashCommandForm, type SlashCommandFormValues } from "./slash-command-form";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockMdxEditor({
      value,
      className,
      onChange,
    }: {
      value: string;
      className?: string;
      onChange: (value: string) => void;
    }) {
      return (
        <textarea
          aria-label="Prompt editor"
          className={className}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    },
}));

const initialValues: SlashCommandFormValues = {
  key: "",
  description: "",
  category: "",
  autoExpand: false,
  autoSubmit: false,
  content: "",
};

describe("SlashCommandForm", () => {
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

  test("create mode renders all fields and defaults automation toggles false", () => {
    render(<SlashCommandForm mode="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText("Command key")).toBeDefined();
    expect(screen.getByLabelText("Description")).toBeDefined();
    expect(screen.getByLabelText("Category")).toBeDefined();
    expect(screen.getByRole("checkbox", { name: "Auto expand" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("checkbox", { name: "Autosubmit" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Submit when selected in an empty thread composer.")).toBeDefined();
    expect(screen.getByLabelText("Prompt editor")).toBeDefined();
    expect(screen.getByRole("button", { name: "Open prompt editor wide view" })).toBeDefined();
  });

  test("caps the inline prompt editor and scrolls overflowing content internally", () => {
    render(<SlashCommandForm mode="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const editor = screen.getByLabelText("Prompt editor");

    expect(editor.parentElement?.className.split(" ")).toContain("h-[420px]");
    expect(editor.className).toContain("[&_.mdxeditor]:overflow-hidden");
    expect(editor.className).toContain("[&_.mdxeditor-rich-text-editor]:overflow-y-auto");
  });

  test("required validation blocks submit", async () => {
    const onSubmit = vi.fn();
    render(<SlashCommandForm mode="create" initialValues={initialValues} canManage onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText("Key must be at least 2 characters")).toBeDefined();
      expect(screen.getByText("Content is required")).toBeDefined();
    });
  });

  test("side-by-side Details fields stay top-aligned when one shows a validation error", async () => {
    render(<SlashCommandForm mode="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Key must be at least 2 characters")).toBeDefined();
    // The key error grows the grid row; a stretched field would sink its label.
    expect(screen.getByLabelText("Category").closest("[data-slot='form-item']")?.className).toContain("content-start");
  });

  test("normalizes command key input", async () => {
    render(<SlashCommandForm mode="create" initialValues={initialValues} canManage onSubmit={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Command key"), {
      target: { value: "/ORG:Custom-Review" },
    });

    expect((screen.getByLabelText("Command key") as HTMLInputElement).value).toBe("org:custom-review");

    // The `/` is an addon, so it never becomes part of the stored key — including
    // a pasted path-like value.
    fireEvent.change(screen.getByLabelText("Command key"), {
      target: { value: "org/review" },
    });

    expect((screen.getByLabelText("Command key") as HTMLInputElement).value).toBe("orgreview");
  });

  test("key format accepts colons and hyphens", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SlashCommandForm mode="create" initialValues={initialValues} canManage onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Command key"), {
      target: { value: "org:client-summary" },
    });
    fireEvent.change(screen.getByLabelText("Prompt editor"), {
      target: { value: "Summarize the client context." },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Auto expand" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Autosubmit" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "org:client-summary",
          content: "Summarize the client context.",
          autoExpand: true,
          autoSubmit: true,
        }),
        expect.anything()
      );
    });
  });

  test("strips the trailing-space escapes the markdown serializer emits", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SlashCommandForm mode="create" initialValues={initialValues} canManage onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Command key"), {
      target: { value: "cra" },
    });
    fireEvent.change(screen.getByLabelText("Prompt editor"), {
      target: { value: "Do you agree? Don't fix it yet.&#x20;\n\nArtifact:&#x20;" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Do you agree? Don't fix it yet.\n\nArtifact:",
        }),
        expect.anything()
      );
    });
  });

  test("rejects content that is only a trailing-space escape", async () => {
    const onSubmit = vi.fn();
    render(<SlashCommandForm mode="create" initialValues={initialValues} canManage onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Command key"), {
      target: { value: "cra" },
    });
    fireEvent.change(screen.getByLabelText("Prompt editor"), {
      target: { value: "&#x20;" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText("Content is required")).toBeDefined();
    });
  });
});
