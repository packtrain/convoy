/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ConvoyTaskWriterPayload } from "@/lib/ai-tools/convoy-task-writer-tool";
import { ConvoyTaskWriterPart } from "./convoy-task-writer-part";

vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  useRouteParams: () => ({ organizationSlug: "acme", projectAlias: "WEB" }),
  useNavigation: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    location: { pathname: "/o/acme/WEB/threads/thread_1", search: "" },
  }),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const created: ConvoyTaskWriterPayload = {
  kind: "create_task",
  toolCallId: "call_1",
  server: "contoso",
  state: "output-available",
  action: "Created task",
  refId: "WEB-1685",
  detail: "“Task drag-and-drop is dead”",
  taskName: "Task drag-and-drop is dead",
};

const TASK_HREF = "/o/acme/WEB?task=WEB-1685";

describe("ConvoyTaskWriterPart", () => {
  test("hides the debug button unless the tool-call debug developer setting is on", () => {
    const onDebug = vi.fn();
    const { rerender } = render(<ConvoyTaskWriterPart payload={created} onDebug={onDebug} />);
    expect(screen.queryByRole("button", { name: "Copy raw tool call JSON" })).toBeNull();

    window.localStorage.setItem("convoy.dev-setting.tool-call-debug", "1");
    rerender(<ConvoyTaskWriterPart payload={created} onDebug={onDebug} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy raw tool call JSON" }));
    expect(onDebug).toHaveBeenCalledTimes(1);
  });

  test("opens the task in the sidebar on a plain left click", () => {
    const onOpenTask = vi.fn();
    render(<ConvoyTaskWriterPart payload={created} onOpenTask={onOpenTask} />);

    const link = screen.getByRole("link", { name: /Created task WEB-1685/ });
    expect(link.getAttribute("href")).toBe(TASK_HREF);

    const handled = fireEvent.click(link, { button: 0 });

    expect(onOpenTask).toHaveBeenCalledWith("WEB-1685");
    // preventDefault ran, so the browser never follows the href.
    expect(handled).toBe(false);
  });

  test("leaves modified and middle clicks to the browser", () => {
    const onOpenTask = vi.fn();
    render(<ConvoyTaskWriterPart payload={created} onOpenTask={onOpenTask} />);

    const link = screen.getByRole("link", { name: /Created task WEB-1685/ });
    fireEvent.click(link, { button: 0, metaKey: true });
    fireEvent.click(link, { button: 0, ctrlKey: true });
    fireEvent.click(link, { button: 0, shiftKey: true });
    fireEvent.click(link, { button: 1 });

    expect(onOpenTask).not.toHaveBeenCalled();
  });

  test("stays a plain link when the host offers no handler", () => {
    render(<ConvoyTaskWriterPart payload={created} />);

    const link = screen.getByRole("link", { name: /Created task WEB-1685/ });
    expect(link.getAttribute("href")).toBe(TASK_HREF);
  });

  test("renders no link for a ref that is not a task ref", () => {
    render(
      <ConvoyTaskWriterPart
        payload={{ ...created, refId: "k17abc123def456" }}
        onOpenTask={vi.fn()}
      />
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Created task k17abc123def456/)).toBeTruthy();
  });

  test("shows the changed fields on the row itself, with no box under it", () => {
    const { container } = render(
      <ConvoyTaskWriterPart
        payload={{
          kind: "update_task",
          toolCallId: "call_2",
          server: "contoso",
          state: "output-available",
          action: "Updated",
          refId: "WEB-1250",
          detail: "→ In Progress",
          status: "In Progress",
          priority: "high",
          changes: ["Description updated", "Tags: soc2"],
        }}
        onOpenTask={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /Updated WEB-1250/ })).toBeNull();
    // One truncating line, not a wrapping stack of chips.
    expect(screen.getByText("Description updated · Tags: soc2")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    expect(container.querySelector("[data-slot='tool-surface']")).toBeNull();
    // The row's summary already carries the ref; no standalone ref chip repeats it.
    expect(screen.getByText(/Updated WEB-1250 → In Progress/)).toBeTruthy();
    expect(screen.queryAllByText("WEB-1250")).toHaveLength(0);
  });

  test("renders no body when it would only repeat the row", () => {
    const { container } = render(<ConvoyTaskWriterPart payload={created} />);

    // The row already reads `Created task WEB-1685 “…”`.
    expect(screen.queryByText(created.taskName!)).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(1);
    // The empty surface must be gone, not just its text: a `<CompletedBody />`
    // element is truthy even when the component renders null.
    expect(container.querySelector("[data-slot='tool-surface']")).toBeNull();
  });

  test("renders no body for a status-only update, which the row carries", () => {
    const { container } = render(
      <ConvoyTaskWriterPart
        payload={{
          kind: "update_task",
          toolCallId: "call_3",
          server: "contoso",
          state: "output-available",
          action: "Updated",
          refId: "WEB-1250",
          detail: "→ In Progress",
          status: "In Progress",
          changes: [],
        }}
      />
    );

    expect(screen.queryByText("Task updated")).toBeNull();
    expect(screen.queryByText(/Status →/)).toBeNull();
    expect(container.querySelector("[data-slot='tool-surface']")).toBeNull();
  });

  test("renders no body for a delete, which the row carries", () => {
    const { container } = render(
      <ConvoyTaskWriterPart
        payload={{
          kind: "delete_task",
          toolCallId: "call_4",
          server: "contoso",
          state: "output-available",
          action: "Deleted",
          refId: "WEB-1250",
          detail: "(keeping subtasks)",
        }}
      />
    );

    expect(screen.queryByText("Done")).toBeNull();
    expect(container.querySelector("[data-slot='tool-surface']")).toBeNull();
  });

  test("renders no body for a single-task move, which the row carries", () => {
    const { container } = render(
      <ConvoyTaskWriterPart
        payload={{
          kind: "move_tasks_to_list",
          toolCallId: "call_6",
          server: "contoso",
          state: "output-available",
          action: "Moved",
          refId: "WEB-1250",
          detail: "to Inbox",
        }}
      />
    );

    expect(container.querySelector("[data-slot='tool-surface']")).toBeNull();
  });

  test("renders no body for a link update with no link details", () => {
    const { container } = render(
      <ConvoyTaskWriterPart
        payload={{
          kind: "update_task_link",
          toolCallId: "call_7",
          server: "contoso",
          state: "output-available",
          action: "Removed link from",
          refId: "WEB-1269",
        }}
      />
    );

    expect(container.querySelector("[data-slot='tool-surface']")).toBeNull();
  });

  test("renders a link update inline, with the sidebar's link label", () => {
    const { container } = render(
      <ConvoyTaskWriterPart
        payload={{
          kind: "update_task_link",
          toolCallId: "call_8",
          server: "contoso",
          state: "output-available",
          action: "Updated link on",
          refId: "WEB-1269",
          link: {
            kind: "commit",
            sha: "83f69e1abc",
            title: "docs(specs): rescope thread groups",
            url: "https://github.com/acme/web/commit/83f69e1abc",
          },
        }}
      />
    );

    const link = screen.getByRole("link", {
      name: "83f69e1 docs(specs): rescope thread groups",
    });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/web/commit/83f69e1abc"
    );
    // Colored kind icon, same as the task sidebar.
    expect(link.querySelector(".text-amber-500")).not.toBeNull();
    expect(container.querySelector("[data-slot='tool-surface']")).toBeNull();
  });

  test("keeps a body that carries more than the row", () => {
    const { container } = render(
      <ConvoyTaskWriterPart
        payload={{
          kind: "move_tasks_to_list",
          toolCallId: "call_5",
          server: "contoso",
          state: "output-available",
          action: "Moved",
          detail: "2 tasks to Inbox",
          taskRefs: ["WEB-1", "WEB-2"],
        }}
        onOpenTask={vi.fn()}
      />
    );

    expect(screen.getByText("WEB-1")).toBeTruthy();
    expect(screen.getByText("WEB-2")).toBeTruthy();
    expect(container.querySelector("[data-slot='tool-surface']")).not.toBeNull();
  });

  test("swaps the write icon for a spinner while pending, with no body", () => {
    const { container } = render(
      <ConvoyTaskWriterPart
        payload={{ ...created, state: "input-available", action: "Create task" }}
      />
    );

    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    expect(screen.queryByText(/Waiting for result/)).toBeNull();
    expect(container.querySelector("[data-slot='tool-surface']")).toBeNull();
  });

  test("marks a failure with a red icon carrying the error message", () => {
    const { container } = render(
      <ConvoyTaskWriterPart
        payload={{
          ...created,
          state: "output-error",
          action: "Create task",
          errorText: "Permission denied",
        }}
      />
    );

    expect(screen.getByLabelText("Permission denied")).toBeTruthy();
    expect(container.querySelector("svg.text-destructive")).not.toBeNull();
    expect(container.querySelector("[data-slot='tool-surface']")).toBeNull();
  });
});
