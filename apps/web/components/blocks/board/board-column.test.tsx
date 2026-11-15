/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Circle } from "lucide-react";
import { BoardColumn } from "./board-column";

const items = [
  { id: "task-1", label: "First card" },
  { id: "task-2", label: "Second card" },
];

describe("BoardColumn", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders generic column title, metadata, count, cards, and add affordance", () => {
    render(
      <BoardColumn
        column={{
          id: "assignee-ada",
          title: "Ada Lovelace",
          metadata: (
            <>
              <Circle aria-hidden className="size-4" />
              <span>Engineer</span>
            </>
          ),
          showCount: true,
          items,
          onCreateTask: vi.fn(),
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(screen.getByText("Engineer")).toBeDefined();
    expect(screen.getByText("2").className).toContain("rounded");
    expect(screen.getByText("First card")).toBeDefined();
    expect(screen.getByText("Second card")).toBeDefined();
    expect(screen.getByLabelText("Task title for Ada Lovelace")).toBeDefined();
  });

  test("hides hover create affordances while a drag is active", () => {
    render(
      <BoardColumn
        column={{
          id: "assignee-ada",
          title: "Ada Lovelace",
          items,
          onCreateTask: vi.fn(),
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
        hideCreateAffordances
      />
    );

    expect(screen.queryByLabelText("Task title for Ada Lovelace")).toBeNull();
  });

  test("keeps the empty state visible on hover while a drag is active", () => {
    render(
      <BoardColumn
        column={{
          id: "empty-during-drag",
          title: "Empty group",
          items: [],
          emptyState: "No tasks",
          onCreateTask: vi.fn(),
        }}
        getItemKey={() => "unused"}
        renderItem={() => null}
        hideCreateAffordances
      />
    );

    expect(screen.getByText("No tasks").className).not.toContain("group-hover:hidden");
  });

  test("omits the count unless the consumer opts in", () => {
    render(
      <BoardColumn
        column={{
          id: "assignee-hidden-count",
          title: "Hidden count",
          items,
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    expect(screen.queryByText("2")).toBeNull();
  });

  test("renders an empty state for columns without cards", () => {
    render(
      <BoardColumn
        column={{
          id: "priority-none",
          title: "No priority",
          showCount: true,
          items: [],
          emptyState: "No tasks in this group",
        }}
        getItemKey={(item) => item.id}
        renderItem={(item: { id: string; label: string }) => (
          <article>{item.label}</article>
        )}
      />
    );

    expect(screen.getByText("No priority")).toBeDefined();
    expect(screen.getByText("0")).toBeDefined();
    expect(screen.getByText("No tasks in this group")).toBeDefined();
  });

  test("hides the empty state on hover when the bottom add input appears", () => {
    render(
      <BoardColumn
        column={{
          id: "empty-hover-add",
          title: "Empty hover add",
          items: [],
          emptyState: "No tasks in this group",
          onCreateTask: vi.fn(),
        }}
        getItemKey={(item) => item.id}
        renderItem={(item: { id: string; label: string }) => (
          <article>{item.label}</article>
        )}
      />
    );

    expect(screen.getByText("No tasks in this group").className).toContain(
      "group-hover:hidden"
    );
    expect(screen.getByText("No tasks in this group").className).toContain(
      "group-focus-within:hidden"
    );
  });

  test("hides the empty state while a top add input is open", () => {
    render(
      <BoardColumn
        column={{
          id: "empty-with-top-add",
          title: "Empty top add",
          items: [],
          emptyState: "No tasks in this group",
          onCreateTask: vi.fn(),
        }}
        getItemKey={(item) => item.id}
        renderItem={(item: { id: string; label: string }) => (
          <article>{item.label}</article>
        )}
      />
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Add task to Empty top add",
    }));

    expect(screen.queryByText("No tasks in this group")).toBeNull();
    expect(screen.getByLabelText("Task title for Empty top add")).toBeDefined();
  });

  test("hides the empty state while the bottom add input is active", () => {
    render(
      <BoardColumn
        column={{
          id: "empty-with-bottom-add",
          title: "Empty bottom add",
          items: [],
          emptyState: "No tasks in this group",
          onCreateTask: vi.fn(),
        }}
        getItemKey={(item) => item.id}
        renderItem={(item: { id: string; label: string }) => (
          <article>{item.label}</article>
        )}
      />
    );

    fireEvent.focus(screen.getByLabelText("Task title for Empty bottom add"));

    expect(screen.queryByText("No tasks in this group")).toBeNull();
    expect(screen.getByLabelText("Task title for Empty bottom add")).toBeDefined();
  });

  test("restores the empty state after an empty bottom add input loses focus", () => {
    render(
      <BoardColumn
        column={{
          id: "empty-bottom-blur",
          title: "Empty bottom blur",
          items: [],
          emptyState: "No tasks in this group",
          onCreateTask: vi.fn(),
        }}
        getItemKey={(item) => item.id}
        renderItem={(item: { id: string; label: string }) => (
          <article>{item.label}</article>
        )}
      />
    );

    const input = screen.getByLabelText("Task title for Empty bottom blur");
    fireEvent.focus(input);
    expect(screen.queryByText("No tasks in this group")).toBeNull();

    fireEvent.blur(input);

    expect(screen.getByText("No tasks in this group")).toBeDefined();
  });

  test("opens a top add input from the header plus and hides the bottom input", () => {
    const column = {
      id: "type-bug",
      title: "Bug",
      showCount: true,
      items,
      addLabel: "Add bug",
      onCreateTask: vi.fn(),
    };

    render(
      <BoardColumn
        column={column}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add bug" }));

    expect(screen.getAllByLabelText("Task title for Bug")).toHaveLength(1);
    const input = screen.getByLabelText("Task title for Bug");
    expect(input).toBe(document.activeElement);
    expect(
      input.compareDocumentPosition(screen.getByText("First card")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
  });

  test("commits top and bottom add inputs with their create position", () => {
    const onCreateTask = vi.fn();
    const column = {
      id: "status-todo",
      title: "To Do",
      items,
      onCreateTask,
    };

    render(
      <BoardColumn
        column={column}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    const bottomInput = screen.getByLabelText("Task title for To Do");
    fireEvent.change(bottomInput, { target: { value: "Bottom task" } });
    fireEvent.keyDown(bottomInput, { key: "Enter" });

    expect(onCreateTask).toHaveBeenCalledWith("Bottom task", "bottom");

    fireEvent.click(screen.getByRole("button", { name: "Add task to To Do" }));
    const topInput = screen.getByLabelText("Task title for To Do");
    fireEvent.change(topInput, { target: { value: "Top task" } });
    fireEvent.keyDown(topInput, { key: "Enter" });

    expect(onCreateTask).toHaveBeenCalledWith("Top task", "top");
    expect((topInput as HTMLInputElement).value).toBe("");
    expect(topInput).toBe(document.activeElement);
  });

  test("commits non-empty add input text on blur", () => {
    const onCreateTask = vi.fn();
    const column = {
      id: "status-blur",
      title: "Blur",
      items,
      onCreateTask,
    };

    render(
      <BoardColumn
        column={column}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    const input = screen.getByLabelText("Task title for Blur");
    fireEvent.change(input, { target: { value: "Blur task" } });
    fireEvent.blur(input);

    expect(onCreateTask).toHaveBeenCalledWith("Blur task", "bottom");
    expect((input as HTMLInputElement).value).toBe("");
  });

  test("cancels an add input with Escape without creating", () => {
    const onCreateTask = vi.fn();
    const column = {
      id: "status-cancel",
      title: "Cancel",
      items,
      onCreateTask,
    };

    render(
      <BoardColumn
        column={column}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add task to Cancel" }));
    const input = screen.getByLabelText("Task title for Cancel");
    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCreateTask).not.toHaveBeenCalled();
    expect(screen.getByText("First card")).toBeDefined();
    expect((screen.getByLabelText("Task title for Cancel") as HTMLInputElement).value).toBe("");
  });

  test("does not activate create controls when creation is disabled", () => {
    const onCreateTask = vi.fn();

    render(
      <BoardColumn
        column={{
          id: "disabled-create",
          title: "Disabled create",
          items,
          canCreate: false,
          createDisabledReason: "No enabled status",
          onCreateTask,
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    const button = screen.getByRole("button", {
      name: "Add task to Disabled create",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.queryByRole("textbox", { name: "Task title for Disabled create" })
    ).toBeNull();
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  test("renders cards without an extra item wrapper", () => {
    const { container } = render(
      <BoardColumn
        column={{
          id: "wrapper-check",
          title: "Wrapper check",
          items,
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    const firstCard = screen.getByText("First card").closest("article");
    const cardStack = container.querySelector(".flex.flex-col.gap-3");

    expect(firstCard?.parentElement).toBe(cardStack);
  });

  test("keeps the header sticky and does not create a per-column vertical scroller", () => {
    const { container } = render(
      <BoardColumn
        column={{
          id: "scroll-check",
          title: "Scroll check",
          items,
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    const header = container.querySelector("header");
    const body = container.querySelector("section > div");

    expect(header?.className).toContain("sticky");
    expect(header?.className).toContain("top-0");
    expect(body?.className).not.toContain("overflow-y-auto");
  });

  test("adds bottom breathing room after the final card", () => {
    const { container } = render(
      <BoardColumn
        column={{
          id: "bottom-padding",
          title: "Bottom padding",
          items,
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    const body = container.querySelector("section > div");

    expect(body?.className).toContain("pb-24");
  });

  test("swaps the count for an edit button on header hover", () => {
    const onEdit = vi.fn();
    const { container } = render(
      <BoardColumn
        column={{
          id: "editable",
          title: "Milestone 3",
          items,
          showCount: true,
          onEdit,
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    expect(container.querySelector("header")?.className).toContain("group/header");
    expect(screen.getByText("2").className).toContain("group-hover/header:hidden");

    const editButton = screen.getByLabelText("Edit Milestone 3");
    expect(editButton.className).toContain("group-hover/header:inline-flex");

    fireEvent.click(editButton);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test("reserves add affordance space to avoid hover layout shift", () => {
    const { container } = render(
      <BoardColumn
        column={{
          id: "add-layout-shift",
          title: "Add layout shift",
          items,
          onCreateTask: vi.fn(),
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    const addRow = screen.getByLabelText("Task title for Add layout shift").parentElement;

    expect(addRow?.className).toContain("flex");
    expect(addRow?.className).toContain("opacity-0");
    expect(addRow?.className).toContain("group-hover:opacity-100");
    expect(addRow?.className).not.toContain("hidden");
    expect(container).toBeDefined();
  });

  test("omits the add button entirely on a read-only column", () => {
    render(
      <BoardColumn
        column={{
          id: "read-only",
          title: "Read only",
          items,
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    expect(screen.queryByRole("button", { name: "Add task to Read only" })).toBeNull();
  });

  test("renders header actions in place of the title", () => {
    render(
      <BoardColumn
        column={{
          id: "with-actions",
          title: "With actions",
          showCount: true,
          items,
          headerActions: <button type="button">Mark as done</button>,
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    expect(screen.getByRole("button", { name: "Mark as done" })).toBeDefined();
    expect(screen.queryByText("With actions")).toBeNull();
    expect(screen.queryByText("2")).toBeNull();
  });

  test("pins the header height so taller controls can't misalign columns", () => {
    // Neighbouring columns share one border line across the board; a header
    // that grows to fit its content (e.g. a selection's action buttons) would
    // step that line out of alignment in one column only.
    const { container: resting } = render(
      <BoardColumn
        column={{ id: "resting", title: "Resting", items }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );
    const { container: withActions } = render(
      <BoardColumn
        column={{
          id: "tall-actions",
          title: "Tall actions",
          items,
          headerActions: (
            <button type="button" className="h-6">
              Delete
            </button>
          ),
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    const heightClass = /(^|\s)h-\d/;
    expect(resting.querySelector("header")?.className).toMatch(heightClass);
    expect(withActions.querySelector("header")?.className).toBe(
      resting.querySelector("header")?.className
    );
  });

  test("renders a column footer below the cards", () => {
    const { container } = render(
      <BoardColumn
        column={{
          id: "with-footer",
          title: "With footer",
          items,
          footer: <button type="button">Show more</button>,
        }}
        getItemKey={(item) => item.id}
        renderItem={(item) => <article>{item.label}</article>}
      />
    );

    const footer = screen.getByRole("button", { name: "Show more" });
    const cardStack = container.querySelector(".flex.flex-col.gap-3");
    const lastCard = screen.getByText("Second card").closest("article");

    expect(cardStack?.contains(footer)).toBe(false);
    expect(lastCard).toBeDefined();
    expect(
      (lastCard as HTMLElement).compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
