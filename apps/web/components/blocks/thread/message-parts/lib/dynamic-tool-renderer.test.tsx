/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DynamicToolUIPart } from "ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderDynamicToolPartElement } from "./dynamic-tool-renderer";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const PART: DynamicToolUIPart = {
  type: "dynamic-tool",
  toolName: "WebFetch",
  toolCallId: "call-1",
  state: "output-available",
  input: { url: "https://example.com" },
  output: { status: 200 },
};

describe("tool call debug action", () => {
  test("copies the raw call and confirms with a toast, without logging", async () => {
    window.localStorage.setItem("convoy.dev-setting.tool-call-debug", "1");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const context = { partIndex: 0, message: { id: "msg_1", role: "assistant" as const, parts: [PART] } };
    render(<>{renderDynamicToolPartElement(PART, context)}</>);
    fireEvent.click(screen.getByRole("button", { name: "Copy raw tool call JSON" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Tool call JSON copied"));
    expect(JSON.parse(writeText.mock.calls[0]?.[0] as string)).toMatchObject({
      toolName: "WebFetch",
      toolCallId: "call-1",
    });
    expect(log).not.toHaveBeenCalled();
  });
});
