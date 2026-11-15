/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SquarePen } from "lucide-react";
import { CollapsibleToolPart } from "./collapsible-tool-part";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("CollapsibleToolPart disclosure", () => {
  test("shows a chevron on expandable rows only", () => {
    const { container, rerender } = render(
      <CollapsibleToolPart icon={SquarePen} title="Read file.ts" state="output-available">
        <p>body</p>
      </CollapsibleToolPart>
    );
    expect(container.querySelector("[data-slot='tool-chevron']")).not.toBeNull();

    rerender(
      <CollapsibleToolPart icon={SquarePen} title="Read file.ts" state="output-available" hasBody={false} />
    );
    expect(container.querySelector("[data-slot='tool-chevron']")).toBeNull();
  });
});

describe("CollapsibleToolPart debug action", () => {
  test("stays hidden unless the tool-call debug developer setting is on", () => {
    const onDebug = vi.fn();
    const { rerender } = render(
      <CollapsibleToolPart icon={SquarePen} title="Read file.ts" onDebug={onDebug}>
        <p>body</p>
      </CollapsibleToolPart>
    );
    expect(screen.queryByRole("button", { name: "Copy raw tool call JSON" })).toBeNull();

    window.localStorage.setItem("convoy.dev-setting.tool-call-debug", "1");
    rerender(
      <CollapsibleToolPart icon={SquarePen} title="Read file.ts" onDebug={onDebug}>
        <p>body</p>
      </CollapsibleToolPart>
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy raw tool call JSON" }));
    expect(onDebug).toHaveBeenCalledTimes(1);
  });
});

describe("CollapsibleToolPart state icon", () => {
  test("shows the tool icon once output is available", () => {
    const { container } = render(
      <CollapsibleToolPart
        icon={SquarePen}
        title="Read file.ts"
        state="output-available"
      >
        <p>body</p>
      </CollapsibleToolPart>
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("svg.text-destructive")).toBeNull();
  });

  test("replaces the tool icon with a spinner while in progress", () => {
    render(
      <CollapsibleToolPart
        icon={SquarePen}
        title="Read file.ts"
        state="input-available"
      >
        <p>body</p>
      </CollapsibleToolPart>
    );

    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  });

  test("shows a red alert icon carrying the error message in a tooltip", () => {
    const { container } = render(
      <CollapsibleToolPart
        icon={SquarePen}
        title="Read file.ts"
        state="output-error"
        errorText="Permission denied"
      >
        <p>body</p>
      </CollapsibleToolPart>
    );

    expect(container.querySelector("svg.text-destructive")).not.toBeNull();
    // The tooltip content is only mounted on hover; the trigger carries the
    // message for assistive tech either way.
    expect(screen.getByLabelText("Permission denied")).toBeTruthy();
  });
});
