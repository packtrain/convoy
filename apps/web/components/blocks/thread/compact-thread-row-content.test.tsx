/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CompactThreadRowContent } from "./compact-thread-row-content";

const NOW = new Date("2026-07-17T12:00:00Z");

describe("CompactThreadRowContent", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("adds other-user attribution before the relative date and CLI icon", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { container } = render(
      <CompactThreadRowContent
        title="Allow no auth for demo purposes on local deployment"
        status="completed"
        cliType="codex"
        lastActivityAt={NOW.getTime() - 5 * 24 * 60 * 60 * 1_000}
        forceStatusIndicator
        userName="Robin Hale"
      />
    );

    expect(screen.getByText("Robin Hale")).toBeTruthy();
    expect(screen.getByText("5d")).toBeTruthy();
    expect(screen.queryByText("Done")).toBeNull();

    const row = container.firstElementChild;
    const user = screen.getByText("Robin Hale");
    const metadata = user.parentElement;

    expect(row?.lastElementChild?.contains(metadata)).toBe(true);
    expect(metadata?.textContent).toBe("Robin Hale5d");
    expect(metadata?.querySelector("svg")).toBeTruthy();
    expect(row?.querySelectorAll("svg")).toHaveLength(1);
  });

  test("orders the trailing metadata as time, agent, CLI icon", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    render(
      <CompactThreadRowContent
        title="My thread"
        status="completed"
        cliType="codex"
        lastActivityAt={NOW.getTime()}
        agent={{ name: "Reviewer", color: "blue", isDeleted: false }}
      />
    );

    const metadata = screen.getByText("now").parentElement;
    const tags = Array.from(metadata?.children ?? []).map((child) =>
      child.textContent === "now" ? "time" : child.tagName.toLowerCase() === "svg" ? "cli" : "agent"
    );
    expect(tags).toEqual(["time", "agent", "cli"]);
  });

  test("keeps hover actions laid out while an action menu is open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    render(
      <CompactThreadRowContent
        title="My thread"
        status="completed"
        cliType="codex"
        lastActivityAt={NOW.getTime()}
        forceStatusIndicator
        actions={<button type="button">Actions</button>}
      />
    );

    const actionRow = screen.getByText("Actions").parentElement;
    const metadata = screen.getByText("now").parentElement;

    // An open menu anchors to the trigger, so the trigger must keep a layout
    // box after the pointer leaves the row — `display: none` would collapse it
    // to 0,0 and teleport the menu to the viewport corner (OS-1596).
    expect(actionRow?.className).toContain("group-has-[[data-state=open]]:flex");
    expect(metadata?.className).toContain("group-has-[[data-state=open]]:hidden");
  });

  test("words the status before the time when asked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    render(
      <CompactThreadRowContent
        title="My thread"
        status="streaming"
        cliType="codex"
        lastActivityAt={NOW.getTime()}
        forceStatusIndicator
        showStatusLabel
      />
    );

    const label = screen.getByText("Working");
    expect(label.className).toContain("text-info");
    // Same metadata cluster as the time, so hover actions swap both together.
    expect(label.parentElement?.textContent).toBe("Workingnow");
  });

  test("labels a completed thread Done, whose glyph is only a spacer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    render(
      <CompactThreadRowContent
        title="My thread"
        status="completed"
        cliType="codex"
        lastActivityAt={NOW.getTime()}
        forceStatusIndicator
        showStatusLabel
      />
    );

    expect(screen.getByText("Done")).toBeTruthy();
  });

  test("omits user attribution when it is not supplied", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    render(
      <CompactThreadRowContent
        title="My thread"
        status="completed"
        cliType="codex"
        lastActivityAt={NOW.getTime()}
        forceStatusIndicator
      />
    );

    expect(screen.queryByText("Robin Hale")).toBeNull();
    expect(screen.getByText("now")).toBeTruthy();
  });
});
