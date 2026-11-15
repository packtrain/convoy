/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { TaskNoticeGroupPart as TaskNoticeGroupPartModel } from "@/lib/cli-stream-ui/types";
import type { CliUiPartRenderContext } from "./lib/part-renderer-registry";
import { TaskNoticeGroupPart } from "./task-notice-group-part";

afterEach(cleanup);

const context = { partIndex: 0, message: {} } as unknown as CliUiPartRenderContext;

function group(subtype: string): TaskNoticeGroupPartModel {
  return {
    type: "task-notice-group",
    groupKey: "claude::tool-1",
    notices: [
      {
        code: `claude-system-${subtype}`,
        title: "Run tests",
        message: subtype,
        detailsJson: JSON.stringify({ subtype, payload: { task_id: "t1", description: "Run tests" } }),
      },
    ],
  };
}

test("a started task shows the shared spinner", () => {
  render(<TaskNoticeGroupPart part={group("task_started")} context={context} />);
  expect(screen.getByText(/Run tests \(started\)/)).toBeTruthy();
  expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
});
