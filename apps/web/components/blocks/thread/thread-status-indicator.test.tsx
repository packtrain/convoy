/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ThreadStatusIndicator } from "./thread-status-indicator";

describe("ThreadStatusIndicator", () => {
  afterEach(cleanup);

  test.each(["pending", "streaming"] as const)(
    "%s shows a busy spinner even when unread or marked done",
    (status) => {
      const { getByRole, container } = render(
        <ThreadStatusIndicator status={status} isUnread isDone showDoneCheck />
      );

      expect(getByRole("status", { name: "Loading" })).toBeTruthy();
      expect(container.firstElementChild?.getAttribute("title")).toBe(
        status === "pending" ? "Pending" : "Streaming response"
      );
    }
  );

  test("titles every live status the same way on every surface", () => {
    const titleFor = (status: Parameters<typeof ThreadStatusIndicator>[0]["status"]) =>
      render(<ThreadStatusIndicator status={status} />).container.firstElementChild?.getAttribute(
        "title"
      );

    expect(titleFor("streaming")).toBe("Streaming response");
    expect(titleFor("pending")).toBe("Pending");
    expect(titleFor("waiting_input")).toBe("Awaiting input");
    expect(titleFor("failed")).toBe("Error");
  });

  test("resting mode decides what a read, finished thread leaves behind", () => {
    // The full row keeps a transparent dot so its column doesn't reflow as
    // threads settle.
    const placeholder = render(<ThreadStatusIndicator status="completed" />).container
      .firstElementChild;
    expect(placeholder?.getAttribute("title")).toBe("Read");
    expect(placeholder?.querySelector("svg")).toBeTruthy();

    cleanup();

    // Tabs and the compact row size their own slot and want nothing in it.
    const blank = render(<ThreadStatusIndicator status="completed" resting="blank" />).container
      .firstElementChild;
    expect(blank?.getAttribute("title")).toBeNull();
    expect(blank?.querySelector("svg")).toBeNull();
  });

  test("unread outranks resting but not an explicit done", () => {
    const { container } = render(<ThreadStatusIndicator status="completed" isUnread resting="blank" />);
    expect(container.firstElementChild?.getAttribute("title")).toBe("Unread");

    cleanup();

    // A thread the user finished with is finished even if its last activity
    // was never opened.
    const done = render(
      <ThreadStatusIndicator status="completed" isUnread isDone showDoneCheck />
    ).container.firstElementChild;
    expect(done?.getAttribute("title")).toBe("Done");
  });

  test("done renders no checkmark without showDoneCheck — the tab strip's case (OS-1594)", () => {
    const { container } = render(
      <ThreadStatusIndicator status="completed" isDone resting="blank" />
    );

    expect(container.firstElementChild?.getAttribute("title")).toBeNull();
    expect(container.firstElementChild?.querySelector("svg")).toBeNull();
  });

  test("a live status outranks done, so a resumed thread stops reading as finished", () => {
    const { container } = render(
      <ThreadStatusIndicator status="streaming" isDone showDoneCheck />
    );

    expect(container.firstElementChild?.getAttribute("title")).toBe("Streaming response");
  });
});
