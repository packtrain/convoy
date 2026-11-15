/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Status } from "@/lib/tasks/types";
import { StatusCell } from "./status-cell";

afterEach(cleanup);

describe("StatusCell", () => {
  // not-sr-only resets white-space and overflow, so it must not share an element with truncate.
  test.each([
    ["editable", true],
    ["read-only", false],
  ])("keeps the wide label on one line when %s", (_, isEditable) => {
    render(<StatusCell status={Status.PLAN_REVIEW} isEditable={isEditable} onStatusChange={() => {}} />);

    const label = screen.getByText(Status.PLAN_REVIEW);
    expect(label.className).toContain("truncate");
    expect(label.className).not.toContain("not-sr-only");
  });
});
