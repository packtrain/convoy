/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadHeader } from "./thread-header";
import {
  ThreadListCollapseProvider,
  type ThreadListCollapseValue,
} from "./thread-list-collapse-context";

const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe("ThreadHeader", () => {
  afterEach(() => {
    cleanup();
    toastErrorMock.mockReset();
  });

  test("renders the thread title", () => {
    render(<ThreadHeader title="Release planning" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Release planning" })
    ).toBeDefined();
  });

  test("renders slash command links as display labels in read-only titles", () => {
    render(
      <ThreadHeader title="[/client-summary](convoy://command/org:client-summary) test" />
    );

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "/client-summary test",
    });
    expect(heading).toBeDefined();
    expect(heading.textContent).toBe("/client-summary test");
    expect(heading.textContent).not.toContain("convoy://command");
    expect(screen.getByText("/client-summary").className).not.toContain(
      "text-info"
    );
  });

  test("renders custom action content when provided", () => {
    render(
      <ThreadHeader
        title="Release planning"
        actions={<button type="button">Action</button>}
      />
    );

    expect(screen.getByRole("button", { name: "Action" })).toBeDefined();
  });

  test("renders leading content before the title", () => {
    render(
      <ThreadHeader
        title="Release planning"
        leading={<span>OS-42</span>}
      />
    );

    expect(screen.getByText("OS-42")).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 1, name: "Release planning" })
    ).toBeDefined();
  });

  test("uses centered line-height for the read-only title", () => {
    render(<ThreadHeader title="Release planning" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Release planning" }).className
    ).toContain("leading-5");
  });

  test("editable title is an input from the start so a click keeps the caret where it lands", () => {
    render(
      <ThreadHeader
        title="Release planning"
        onTitleCommit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByRole("button", { name: "Thread title" })).toBeNull();
    expect(
      screen
        .getByRole("heading", { level: 1, name: "Release planning" })
        .parentElement?.className
    ).toContain("-mt-px");

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    expect((titleInput as HTMLInputElement).value).toBe("Release planning");
    expect(titleInput.className).toContain("h-5");
    expect(titleInput.className).toContain("leading-5");
  });

  test("keeps trailing title action beside the title", () => {
    render(
      <ThreadHeader
        title="Release planning"
        titleTrailing={<button type="button">Add thread</button>}
        onTitleCommit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    const titleLayout = screen.getByRole("button", {
      name: "Add thread",
    }).parentElement?.previousElementSibling;

    expect(titleLayout?.className).not.toContain("flex-1");
    expect(titleInput.className).toContain("absolute");
    expect(
      titleInput.parentElement?.querySelector('[aria-hidden="true"]')
        ?.textContent
    ).toBe("Release planning");
  });

  test("title input has no horizontal padding beyond its sizer", () => {
    // The sizer sets the input's width, so any extra padding clips the text: "hi" vanished.
    render(<ThreadHeader title="hi" onTitleCommit={vi.fn().mockResolvedValue(undefined)} />);

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    const sizer = titleInput.parentElement?.querySelector('[aria-hidden="true"]');
    const inlinePadding = (className = "") => className.split(/\s+/).filter((c) => /^p[xrl]-/.test(c));

    expect(inlinePadding(titleInput.className)).toEqual(inlinePadding(sizer?.className));
  });

  test("editable title shows the plain slash command display text", () => {
    render(
      <ThreadHeader
        title="[/client-summary](convoy://command/org:client-summary) test"
        onTitleCommit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    expect((titleInput as HTMLInputElement).value).toBe(
      "/client-summary test"
    );
  });

  test("external title updates sync into the unfocused input", () => {
    const onTitleCommit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ThreadHeader title="Release planning" onTitleCommit={onTitleCommit} />
    );

    rerender(<ThreadHeader title="Renamed elsewhere" onTitleCommit={onTitleCommit} />);

    expect(
      (screen.getByRole("textbox", { name: "Thread title" }) as HTMLInputElement)
        .value
    ).toBe("Renamed elsewhere");
  });

  test("external title updates do not clobber a focused draft", () => {
    const onTitleCommit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ThreadHeader title="Release planning" onTitleCommit={onTitleCommit} />
    );

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "My draft" } });
    rerender(<ThreadHeader title="Renamed elsewhere" onTitleCommit={onTitleCommit} />);

    expect((titleInput as HTMLInputElement).value).toBe("My draft");
  });

  test("blur saves trimmed title when changed", async () => {
    const onTitleCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <ThreadHeader
        title="Release planning"
        onTitleCommit={onTitleCommit}
      />
    );

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "  Updated title  " } });
    fireEvent.blur(titleInput);

    await vi.waitFor(() => {
      expect(onTitleCommit).toHaveBeenCalledWith("Updated title");
    });
  });

  test("blur does not save unchanged title", async () => {
    const onTitleCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <ThreadHeader
        title="Release planning"
        onTitleCommit={onTitleCommit}
      />
    );

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, {
      target: { value: "  Release planning  " },
    });
    fireEvent.blur(titleInput);

    await vi.waitFor(() => {
      expect(onTitleCommit).not.toHaveBeenCalled();
    });
  });

  test("enter saves edited title", async () => {
    const onTitleCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <ThreadHeader
        title="Release planning"
        onTitleCommit={onTitleCommit}
      />
    );

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "Updated title" } });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    await vi.waitFor(() => {
      expect(onTitleCommit).toHaveBeenCalledWith("Updated title");
    });
    expect(onTitleCommit).toHaveBeenCalledTimes(1);
  });

  test("empty title on blur reverts without saving", async () => {
    const onTitleCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <ThreadHeader
        title="Release planning"
        onTitleCommit={onTitleCommit}
      />
    );

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "   " } });
    fireEvent.blur(titleInput);

    await vi.waitFor(() => {
      expect(onTitleCommit).not.toHaveBeenCalled();
    });
    expect((titleInput as HTMLInputElement).value).toBe("Release planning");
  });

  test("escape cancels edit without saving", async () => {
    const onTitleCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <ThreadHeader
        title="Release planning"
        onTitleCommit={onTitleCommit}
      />
    );

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "Updated title" } });
    fireEvent.keyDown(titleInput, { key: "Escape" });

    await vi.waitFor(() => {
      expect(onTitleCommit).not.toHaveBeenCalled();
    });
    expect((titleInput as HTMLInputElement).value).toBe("Release planning");
  });

  test("failed save shows toast and reverts title", async () => {
    const onTitleCommit = vi
      .fn()
      .mockRejectedValue(new Error("Not authorized"));
    render(
      <ThreadHeader
        title="Release planning"
        onTitleCommit={onTitleCommit}
      />
    );

    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    fireEvent.focus(titleInput);
    fireEvent.change(titleInput, { target: { value: "Updated title" } });
    fireEvent.blur(titleInput);

    await vi.waitFor(() => {
      expect(onTitleCommit).toHaveBeenCalledWith("Updated title");
    });
    await vi.waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Not authorized");
    });
    await vi.waitFor(() => {
      expect((titleInput as HTMLInputElement).value).toBe("Release planning");
    });
  });
});

describe("ThreadHeader thread list reopen button", () => {
  afterEach(cleanup);

  function renderWithList(value: Partial<ThreadListCollapseValue>) {
    const toggle = vi.fn();
    render(
      <ThreadListCollapseProvider
        value={{ collapsed: false, toggle, hasAttention: false, setHasAttention: () => {}, ...value }}
      >
        <ThreadHeader title="Release planning" />
      </ThreadListCollapseProvider>
    );
    return toggle;
  }

  test("is absent while the list is open", () => {
    renderWithList({ collapsed: false });
    expect(screen.queryByRole("button", { name: "Show thread list" })).toBeNull();
  });

  test("reopens the collapsed list", () => {
    const toggle = renderWithList({ collapsed: true });
    fireEvent.click(screen.getByRole("button", { name: "Show thread list" }));
    expect(toggle).toHaveBeenCalledOnce();
  });

  test("spaces the first tab from the button like the header edge", () => {
    render(
      <ThreadListCollapseProvider
        value={{ collapsed: true, toggle: vi.fn(), hasAttention: false, setHasAttention: () => {} }}
      >
        <ThreadHeader title="Release planning" tabs={<button type="button">First tab</button>} />
      </ThreadListCollapseProvider>
    );
    // Beside the button the row gets the header's own inset (px-4), not -ml-3.
    const classes = screen.getByRole("button", { name: "First tab" }).parentElement!.className.split(/\s+/);
    expect(classes).not.toContain("-ml-3");
    expect(classes).toContain("ml-4");
  });

  test("badges the button when a thread needs attention", () => {
    renderWithList({ collapsed: true, hasAttention: true });
    expect(screen.getByRole("button", { name: "Show thread list (unread threads)" })).toBeDefined();
  });
});
