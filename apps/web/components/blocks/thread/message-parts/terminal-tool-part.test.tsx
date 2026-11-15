/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { TerminalToolPart } from "./terminal-tool-part";
import { TOOL_OUTPUT_LINE_LIMIT } from "./lib/expandable-lines";

afterEach(cleanup);

const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n");

function open(stdout: string, stderr?: string) {
  render(
    <TerminalToolPart
      payload={{
        toolName: "Bash",
        toolCallId: "call-1",
        command: "pnpm test",
        state: "output-available",
        stdout,
        stderr,
      }}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /pnpm test/ }));
}

describe("TerminalToolPart", () => {
  test("caps long output and reveals the rest on request", () => {
    open(lines(TOOL_OUTPUT_LINE_LIMIT + 10, "out"), lines(5, "err"));

    expect(screen.getByText(new RegExp(`\\bout ${TOOL_OUTPUT_LINE_LIMIT}\\b`))).toBeTruthy();
    expect(screen.queryByText(new RegExp(`\\bout ${TOOL_OUTPUT_LINE_LIMIT + 1}\\b`))).toBeNull();
    expect(screen.queryByText(/\berr 1\b/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: `Show all ${TOOL_OUTPUT_LINE_LIMIT + 15} lines` }));

    expect(screen.getByText(new RegExp(`\\bout ${TOOL_OUTPUT_LINE_LIMIT + 10}\\b`))).toBeTruthy();
    expect(screen.getByText(/\berr 5\b/)).toBeTruthy();
  });

  test("keeps short output whole, with stderr after stdout", () => {
    open("ok", "warn");

    expect(screen.getByText("ok")).toBeTruthy();
    expect(screen.getByText("warn").className).toContain("text-destructive");
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  test("uses theme tokens instead of a fixed dark surface", () => {
    open("ok");

    const pre = screen.getByText("ok").closest("pre");
    expect(pre?.className).not.toMatch(/zinc/);
    expect(pre?.className).toContain("text-foreground");
  });
});
