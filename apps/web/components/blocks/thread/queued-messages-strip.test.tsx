/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { QueuedMessagesStrip } from "./queued-messages-strip";

describe("QueuedMessagesStrip", () => {
  test("editing a queued message does not submit a containing form", () => {
    const onEdit = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    render(
      <form onSubmit={onSubmit}>
        <QueuedMessagesStrip
          messages={[
            {
              _id: "queued-message" as Id<"cliMessages">,
              text: "Queued follow-up",
              steerRequested: false,
            },
          ]}
          canSteer={false}
          onSteer={vi.fn()}
          onEdit={onEdit}
          onDelete={vi.fn()}
        />
      </form>
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit queued message" }));

    expect(onEdit).toHaveBeenCalledWith("queued-message");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("held queue: the first row's Steer slot is Send now (OS-2171)", () => {
    const onSendNow = vi.fn();

    render(
      <QueuedMessagesStrip
        messages={[
          { _id: "held-1" as Id<"cliMessages">, text: "held 1", steerRequested: false },
          { _id: "held-2" as Id<"cliMessages">, text: "held 2", steerRequested: false },
        ]}
        canSteer={false}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSendNow={onSendNow}
      />
    );

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByRole("button", { name: "Send now" })).toBeDefined();
    expect(within(rows[1]).queryByRole("button", { name: "Send now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Steer" })).toBeNull();
    expect(within(rows[1]).getByRole("button", { name: "Edit queued message" })).toBeDefined();
    expect(within(rows[1]).getByRole("button", { name: "Delete queued message" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    expect(onSendNow).toHaveBeenCalled();
  });

  test("a queue-first command leads the strip (OS-2339)", () => {
    render(
      <QueuedMessagesStrip
        messages={[
          { _id: "queued-1" as Id<"cliMessages">, text: "queued 1", steerRequested: false },
          { _id: "compact" as Id<"cliMessages">, text: "/compact", steerRequested: false, runtimeCommand: true, queueFirst: true },
        ]}
        canSteer={false}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual(["/compact", "queued 1"]);
  });

  test("renders nothing with no rows, even for a held queue", () => {
    const { container } = render(
      <QueuedMessagesStrip
        messages={[]}
        canSteer={false}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onSendNow={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders slash command refs as command text, not raw markdown (OS-1465)", () => {
    render(
      <QueuedMessagesStrip
        messages={[
          {
            _id: "queued-message" as Id<"cliMessages">,
            text: "[/cc](convoy://command/org:cc) now",
            steerRequested: false,
          },
        ]}
        canSteer={false}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("/cc")).toBeDefined();
    expect(screen.queryByText(/convoy:\/\/command/)).toBeNull();
  });

  test("files-only message shows the file name instead of an empty row (OS-1877)", () => {
    render(
      <QueuedMessagesStrip
        messages={[
          {
            _id: "queued-message" as Id<"cliMessages">,
            text: "",
            steerRequested: false,
            attachmentFileNames: ["CleanShot 2026-09-01 at 19.40.34.png"],
          },
        ]}
        canSteer={false}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(
      screen.getByText("CleanShot 2026-09-01 at 19.40.34.png")
    ).toBeDefined();
  });

  test("files-only message with several files shows a count (OS-1877)", () => {
    render(
      <QueuedMessagesStrip
        messages={[
          {
            _id: "queued-message" as Id<"cliMessages">,
            text: "",
            steerRequested: false,
            attachmentFileNames: ["a.png", "b.png", "c.pdf"],
          },
        ]}
        canSteer={false}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("3 attachments")).toBeDefined();
  });

  test("text plus files shows the text and a paperclip count (OS-1877)", () => {
    render(
      <QueuedMessagesStrip
        messages={[
          {
            _id: "queued-message" as Id<"cliMessages">,
            text: "fix this",
            steerRequested: false,
            attachmentFileNames: ["a.png", "b.png"],
          },
        ]}
        canSteer={false}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const text = screen.getByText("fix this");
    const badge = screen.getByTitle("a.png, b.png");
    expect(badge.textContent).toContain("2");
    // Leads the row (next to the queue icon) so it doesn't read as an action button.
    expect(
      badge.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("allows long follow-up messages to shrink within narrow thread embeds", () => {
    const text =
      "why did you have to create formatCompactRelativeTime when the existing formatter already handles this very long follow-up message";

    render(
      <QueuedMessagesStrip
        messages={[
          {
            _id: "queued-message" as Id<"cliMessages">,
            text,
            steerRequested: false,
          },
        ]}
        canSteer={false}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        className="w-full"
      />
    );

    const messageRow = screen.getByText(text).parentElement;
    const strip = messageRow?.parentElement?.parentElement;

    expect(strip?.classList.contains("min-w-0")).toBe(true);
    expect(strip?.classList.contains("max-w-full")).toBe(true);
    expect(messageRow?.classList.contains("min-w-0")).toBe(true);
  });

  test("joins consecutive queued messages into one bordered list (OS-2153)", () => {
    render(
      <QueuedMessagesStrip
        messages={[
          { _id: "first" as Id<"cliMessages">, text: "First", steerRequested: false },
          { _id: "second" as Id<"cliMessages">, text: "Second", steerRequested: false },
        ]}
        canSteer={false}
        onSteer={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const list = screen.getByRole("list");
    expect(list.classList.contains("divide-y")).toBe(true);
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  test("hovering a row's text previews the whole message (OS-2564)", () => {
    vi.useFakeTimers();
    try {
      const text = "First line of a long queued message\n\nSecond paragraph";
      render(
        <QueuedMessagesStrip
          messages={[{ _id: "long" as Id<"cliMessages">, text, steerRequested: false }]}
          canSteer={false}
          onSteer={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      );
      expect(screen.queryByLabelText("Queued message preview")).toBeNull();

      fireEvent.pointerEnter(screen.getByText(/First line/));
      act(() => vi.advanceTimersByTime(1000));

      const preview = screen.getByLabelText("Queued message preview");
      expect(preview.textContent).toBe(text);
    } finally {
      vi.useRealTimers();
    }
  });
});
