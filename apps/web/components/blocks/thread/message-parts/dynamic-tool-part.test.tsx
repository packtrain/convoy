/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DynamicToolUIPart } from "ai";
import { afterEach, describe, expect, test } from "vitest";
import { DynamicToolPart } from "./dynamic-tool-part";
import { TOOL_OUTPUT_LINE_LIMIT } from "./lib/expandable-lines";

afterEach(cleanup);

function renderPart(part: DynamicToolUIPart) {
  render(<DynamicToolPart part={part} />);
  fireEvent.click(screen.getByRole("button", { name: /WebFetch/ }));
}

describe("DynamicToolPart", () => {
  test("shows input and output sections without call bookkeeping", () => {
    renderPart({
      type: "dynamic-tool",
      toolName: "WebFetch",
      toolCallId: "call-123",
      state: "output-available",
      input: { url: "https://example.com" },
      output: { status: 200 },
    });

    expect(screen.getByText("Input")).toBeTruthy();
    expect(screen.getByText("Output")).toBeTruthy();
    expect(screen.getByText(/"url": "https:\/\/example.com"/)).toBeTruthy();
    expect(screen.queryByText(/call-123/)).toBeNull();
    expect(screen.queryByText(/output-available/)).toBeNull();
  });

  test("caps a long payload with a show-all control", () => {
    const output = Array.from({ length: TOOL_OUTPUT_LINE_LIMIT + 20 }, (_, index) => `line ${index + 1}`).join("\n");
    renderPart({
      type: "dynamic-tool",
      toolName: "WebFetch",
      toolCallId: "call-123",
      state: "output-available",
      input: {},
      output,
    });

    expect(screen.queryByText(/line 60/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Show all ${TOOL_OUTPUT_LINE_LIMIT + 20} lines` }));
    expect(screen.getByText(/line 60/)).toBeTruthy();
  });
});
