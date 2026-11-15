/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { THREAD_STATUS_META } from "@/lib/threads/status-meta";
import { STATUS_META, StatusIndicator } from "./thread-status";

afterEach(cleanup);

describe("Watch Tower status wording", () => {
  test.each([
    ["running", THREAD_STATUS_META.streaming.label],
    ["waiting_input", THREAD_STATUS_META.waiting_input.label],
    ["failed", THREAD_STATUS_META.failed.label],
    ["done", THREAD_STATUS_META.completed.label],
  ] as const)("the %s row word comes from THREAD_STATUS_META", (status, label) => {
    expect(STATUS_META[status].label).toBe(label);
    render(<StatusIndicator status={status} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  test("keeps its own word for the review bucket, which has no thread status", () => {
    expect(STATUS_META.needs_review.label).toBe("Needs review");
  });
});
