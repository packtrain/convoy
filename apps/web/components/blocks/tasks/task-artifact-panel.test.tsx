/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, test, expect, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { TaskArtifactPanel } from "./task-artifact-panel";

const useTaskArtifactMock = vi.fn();
const mdxEditorMock = vi.hoisted(() => vi.fn());
const downloadArtifactMock = vi.hoisted(() =>
  vi.fn((content: string, fileName: string, contentType: "markdown" | "html") => {
    void content;
    void fileName;
    void contentType;
    return true;
  })
);
const { useIsMobileMock } = vi.hoisted(() => ({
  useIsMobileMock: vi.fn(() => false),
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    return function MockDynamicMdxEditor(props: {
      value: string;
      onChange: (value: string) => void;
      stickyToolbar?: boolean;
      contentPadding?: string;
    }) {
      mdxEditorMock(props);
      return (
        <textarea
          aria-label="Artifact editor"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      );
    };
  },
}));

vi.mock("@/lib/tasks/hooks/use-task-artifacts", () => ({
  useTaskArtifact: (...args: unknown[]) => useTaskArtifactMock(...args),
}));

vi.mock("@/lib/tasks/download-artifact", () => ({
  downloadArtifact: downloadArtifactMock,
}));

// Artifact comments need a Convex provider; the panel's comment wiring is
// exercised in the browser and by convex/tasks/artifactComments.test.ts.
const createCommentMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tasks/hooks/comments/use-artifact-comments", () => ({
  useArtifactComments: () => ({
    threads: [],
    isLoading: false,
    createComment: createCommentMock,
    createReply: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    setStatus: vi.fn(),
  }),
}));

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: useIsMobileMock,
}));

vi.mock("@/components/ui/drawer", () =>
  import("@/test-utils/mocks/drawer")
);

describe("TaskArtifactPanel", () => {
  beforeEach(() => {
    useTaskArtifactMock.mockReset();
    mdxEditorMock.mockReset();
    downloadArtifactMock.mockClear();
    createCommentMock.mockReset();
    useIsMobileMock.mockReturnValue(false);
    // Comment prefs (rail open state) persist in localStorage between tests.
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  test("calls onInvalidSelection when artifact id is invalid/inaccessible", async () => {
    useTaskArtifactMock.mockReturnValue(null);
    const onInvalidSelection = vi.fn();

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_invalid"
        onClose={vi.fn()}
        onInvalidSelection={onInvalidSelection}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      expect(onInvalidSelection).toHaveBeenCalled();
    });
  });

  test("renders the shared artifact editor in editor-first mode", () => {
    const markdownWithTable =
      "# Plan\n\n| Owner | Status |\n| --- | --- |\n| Agent | Ready |";
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: markdownWithTable,
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByDisplayValue("Implementation Plan")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Artifact editor" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Edit artifact" })).toBeNull();
    expect(mdxEditorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stickyToolbar: true,
        contentPadding: "spacious",
        value: markdownWithTable,
      })
    );
  });

  test("defaults to narrow content width and toggles to full width, persisting the choice", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_width",
      name: "Plan",
      content: "# Plan",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_width"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(mdxEditorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentWidth: "narrow" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Full width" }));

    expect(mdxEditorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentWidth: "default" })
    );
    expect(screen.getByRole("button", { name: "Narrow width" })).toBeDefined();
    expect(localStorage.getItem("task-artifact-full-width")).toBe("true");
  });

  test("uses Untitled as placeholder in header input", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_untitled",
      name: "Untitled",
      content: "",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_untitled"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const nameInput = screen.getByRole("textbox", { name: "Artifact name" }) as HTMLInputElement;
    expect(nameInput.value).toBe("");
    expect(nameInput.placeholder).toBe("Untitled");
  });

  test("downloads the current markdown content with the artifact filename", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_markdown",
      name: "Implementation Plan",
      fileName: "implementation-plan.md",
      content: "# Original plan",
      contentType: "markdown",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_markdown"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Artifact editor" }), {
      target: { value: "# Updated plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Download artifact" }));

    expect(downloadArtifactMock).toHaveBeenCalledWith(
      "# Updated plan",
      "implementation-plan.md",
      "markdown"
    );
  });

  test("downloads html source with the artifact filename", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_html",
      name: "Status Report",
      fileName: "status-report.html",
      content: "<!doctype html><title>Status</title>",
      contentType: "html",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_html"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Download artifact" }));

    expect(downloadArtifactMock).toHaveBeenCalledWith(
      "<!doctype html><title>Status</title>",
      "status-report.html",
      "html"
    );
  });

  test("applies provided CSS width token to loading state wrapper", () => {
    useTaskArtifactMock.mockReturnValue(undefined);
    const { container } = render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_loading"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
        widthCss={"var(--task-artifact-width)"}
      />
    );

    const wrapper = container.firstElementChild as HTMLDivElement;
    expect(wrapper.style.width).toBe("var(--task-artifact-width)");
  });

  test("falls back to 0px when width token is not provided", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });

    const { container } = render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const wrapper = container.firstElementChild as HTMLDivElement;
    expect(wrapper.style.width).toBe("0px");
  });

  test("compact mode fills the container instead of requesting a fixed width", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });

    const { container } = render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        compact
        widthCss={"var(--task-artifact-width)"}
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const frame = container.querySelector(
      "[data-testid='task-artifact-panel-frame']"
    ) as HTMLDivElement;
    expect(frame.style.width).toBe("");
    expect(frame.className).toContain("flex-1");
  });

  test("compact mode floats the comments rail over the editor without a resize handle", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        compact
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Show comments" }));

    const railRoot = screen.getByText("Comments").parentElement!
      .parentElement as HTMLDivElement;
    expect(railRoot.className).toContain("absolute");
    expect(screen.queryByLabelText("Resize comments panel")).toBeNull();
  });

  test("creates a general comment without an anchor via the rail's + button", async () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    let resolveCreateComment!: (commentId: string) => void;
    createCommentMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveCreateComment = resolve;
        })
    );

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Show comments" }));
    const addCommentButton = screen.getByRole("button", { name: "Add comment" });
    expect(addCommentButton.getAttribute("data-size")).toBe("icon-sm");
    fireEvent.click(addCommentButton);

    const composer = screen.getByPlaceholderText("Add a comment…");
    expect(document.activeElement).toBe(composer);

    fireEvent.change(composer, { target: { value: "General note" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(createCommentMock).toHaveBeenCalledWith("General note", undefined);
    });
    expect(screen.getByPlaceholderText("Add a comment…")).toBeDefined();

    await act(async () => {
      resolveCreateComment("comment_1");
    });

    // Composer closes after a successful submit.
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Add a comment…")).toBeNull();
    });
  });

  test("hides the + button when the panel is read-only", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    // A disabled panel with zero comments has no rail toggle; open the rail
    // through the persisted pref instead.
    localStorage.setItem(
      "task-artifact-comment-prefs",
      JSON.stringify({ isOpen: true })
    );

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        disabled
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("Comments")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add comment" })).toBeNull();
  });

  test("docked mode keeps the comments rail as a resizable column", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Show comments" }));

    const railRoot = screen.getByText("Comments").parentElement!
      .parentElement as HTMLDivElement;
    expect(railRoot.className).not.toContain("absolute");
    expect(screen.getByLabelText("Resize comments panel")).toBeDefined();
  });

  test("renders artifact content in a nested drawer on mobile", () => {
    useIsMobileMock.mockReturnValue(true);
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
        widthCss={"var(--task-artifact-width)"}
      />
    );

    expect(screen.getByTestId("task-artifact-drawer")).toBeDefined();
    expect(screen.getByDisplayValue("Implementation Plan")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Artifact editor" })).toBeDefined();
  });

  test("does not apply desktop width styles inside the mobile drawer", () => {
    useIsMobileMock.mockReturnValue(true);
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });

    const { container } = render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
        widthCss={"var(--task-artifact-width)"}
      />
    );

    const frame = container.querySelector(
      "[data-testid='task-artifact-panel-frame']"
    ) as HTMLDivElement;
    expect(frame.style.width).toBe("");
  });

  test("closes through the existing close handler when mobile artifact drawer dismisses", () => {
    useIsMobileMock.mockReturnValue(true);
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    const onClose = vi.fn();

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={onClose}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss drawer" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("renders loading state in a nested drawer on mobile", () => {
    useIsMobileMock.mockReturnValue(true);
    useTaskArtifactMock.mockReturnValue(undefined);

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_loading"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByTestId("task-artifact-drawer")).toBeDefined();
    expect(screen.getByLabelText("Loading artifact").querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });

  test("clears the saving indicator when an edit is reverted to the last saved value", async () => {
    vi.useFakeTimers();
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    const onUpdateArtifact = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={onUpdateArtifact}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Artifact editor" });

    // First edit autosaves successfully.
    fireEvent.change(editor, { target: { value: "# Plan v2" } });
    await vi.advanceTimersByTimeAsync(800);
    expect(onUpdateArtifact).toHaveBeenCalledTimes(1);

    // Let the "Saved" confirmation settle back to idle.
    await vi.advanceTimersByTimeAsync(1200);

    // Edit again, then revert to the just-saved value before the debounce fires.
    fireEvent.change(editor, { target: { value: "# Plan v3" } });
    fireEvent.change(editor, { target: { value: "# Plan v2" } });
    await vi.advanceTimersByTimeAsync(800);

    // Nothing new to persist, and the indicator must not be stuck on "Saving...".
    expect(onUpdateArtifact).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Saving...")).toBeNull();
  });

  test("waits until the autosave request starts before showing Saving", async () => {
    vi.useFakeTimers();
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    let resolveUpdate: () => void;
    const updatePromise = new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    });
    const onUpdateArtifact = vi.fn(() => updatePromise);

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={onUpdateArtifact}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Artifact editor" }), {
      target: { value: "# Plan v2" },
    });

    expect(screen.queryByText("Saving...")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });

    expect(onUpdateArtifact).not.toHaveBeenCalled();
    expect(screen.queryByText("Saving...")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(onUpdateArtifact).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saving...")).toBeDefined();

    await act(async () => {
      resolveUpdate!();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Saved")).toBeDefined();
  });

  test("persists a revert made while an autosave is in flight", async () => {
    vi.useFakeTimers();
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    let resolveFirstUpdate: () => void;
    const firstUpdatePromise = new Promise<void>((resolve) => {
      resolveFirstUpdate = resolve;
    });
    const onUpdateArtifact = vi
      .fn()
      .mockReturnValueOnce(firstUpdatePromise)
      .mockResolvedValue(undefined);

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={onUpdateArtifact}
      />
    );

    const editor = screen.getByRole("textbox", { name: "Artifact editor" });
    fireEvent.change(editor, { target: { value: "# Plan v2" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(onUpdateArtifact).toHaveBeenCalledTimes(1);
    expect(onUpdateArtifact).toHaveBeenNthCalledWith(1, {
      artifactId: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan v2",
    });

    fireEvent.change(editor, { target: { value: "# Plan" } });

    await act(async () => {
      resolveFirstUpdate!();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onUpdateArtifact).toHaveBeenCalledTimes(2);
    expect(onUpdateArtifact).toHaveBeenNthCalledWith(2, {
      artifactId: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    expect(screen.getByText("Saved")).toBeDefined();
  });

  test("does not flush a pending autosave when the update callback changes", async () => {
    vi.useFakeTimers();
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    const firstUpdateArtifact = vi.fn().mockResolvedValue(undefined);
    const secondUpdateArtifact = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={firstUpdateArtifact}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Artifact editor" }), {
      target: { value: "# Plan v2" },
    });

    rerender(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={secondUpdateArtifact}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });

    expect(firstUpdateArtifact).not.toHaveBeenCalled();
    expect(secondUpdateArtifact).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(firstUpdateArtifact).not.toHaveBeenCalled();
    expect(secondUpdateArtifact).toHaveBeenCalledWith({
      artifactId: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan v2",
    });
    expect(screen.getByText("Saved")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(screen.queryByText("Saving...")).toBeNull();
  });

  test("shows saved after autosave resolves in StrictMode", async () => {
    vi.useFakeTimers();
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    const onUpdateArtifact = vi.fn().mockResolvedValue(undefined);

    render(
      <StrictMode>
        <TaskArtifactPanel
          selectedArtifactId="artifact_1"
          onClose={vi.fn()}
          onInvalidSelection={vi.fn()}
          onUpdateArtifact={onUpdateArtifact}
        />
      </StrictMode>
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Artifact editor" }), {
      target: { value: "# Plan v2" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(onUpdateArtifact).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saved")).toBeDefined();
  });

  test("full-page mode swaps open-full-page and close for a back-to-task link", () => {
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      fileName: "implementation-plan.md",
      content: "# Plan",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        fullPage
        backTarget={{
          pathname: "/o/acme/ABC",
          query: { task: "ABC-42", artifact: "artifact_1" },
        }}
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const backLink = screen.getByRole("link", { name: "Back to task" });
    expect(backLink.getAttribute("href")).toBe(
      "/o/acme/ABC?task=ABC-42&artifact=artifact_1"
    );
    expect(screen.queryByRole("link", { name: "Open full page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close artifact" })).toBeNull();
    // Comments and download stay available on the full page.
    expect(screen.getByRole("button", { name: "Show comments" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Download artifact" })).toBeDefined();
  });

  test("full-page mode never wraps in the mobile drawer", () => {
    useIsMobileMock.mockReturnValue(true);
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        fullPage
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByTestId("task-artifact-drawer")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Artifact editor" })).toBeDefined();
  });

  // A compact host is already a drawer on mobile (the thread sidebar); nesting
  // another one inside it traps the user (OS-1569).
  test("compact mode never wraps in the mobile drawer", () => {
    useIsMobileMock.mockReturnValue(true);
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });

    render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        compact
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByTestId("task-artifact-drawer")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Artifact editor" })).toBeDefined();
  });

  test("flushes pending autosave on unmount", async () => {
    vi.useFakeTimers();
    useTaskArtifactMock.mockReturnValue({
      _id: "artifact_1",
      name: "Implementation Plan",
      content: "# Plan",
    });
    const onUpdateArtifact = vi.fn().mockResolvedValue(undefined);

    const { unmount } = render(
      <TaskArtifactPanel
        selectedArtifactId="artifact_1"
        onClose={vi.fn()}
        onInvalidSelection={vi.fn()}
        onUpdateArtifact={onUpdateArtifact}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Artifact name" }), {
      target: { value: "Implementation Plan v2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Artifact editor" }), {
      target: { value: "# Plan updated" },
    });

    unmount();
    await vi.advanceTimersByTimeAsync(0);

    expect(onUpdateArtifact).toHaveBeenCalledWith({
      artifactId: "artifact_1",
      name: "Implementation Plan v2",
      content: "# Plan updated",
    });
    expect(onUpdateArtifact).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    expect(onUpdateArtifact).toHaveBeenCalledTimes(1);
  });
});
