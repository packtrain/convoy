/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import type { TaskNoticeGroupPart } from "@/lib/cli-stream-ui/types";
import { toast } from "sonner";
import { CodexAgentGroupPart } from "./codex-agent-group-part";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function group(status: string, operationState: "completed" | "failed" = "completed"): TaskNoticeGroupPart {
  const item = { type: "collabAgentToolCall", tool: "wait", receiverThreadIds: [] };
  return {
    type: "task-notice-group",
    groupKey: "codex-agents",
    notices: [],
    childTaskNoticeGroups: ["completed", status].map((state, index) => ({
      type: "task-notice-group",
      groupKey: `codex:${index}`,
      notices: [
        {
          code: "codex-subagent",
          title: `Agent ${index}`,
          message: state,
          detailsJson: JSON.stringify({
            subtype: "codex_subagent",
            payload: { task_id: `codex:${index}`, description: `Agent ${index}`, status: state },
          }),
        },
      ],
    })),
    childToolEvents: [
      { kind: "tool-input", toolCallId: "wait", toolName: "Agent wait", inputJson: JSON.stringify(item) },
      operationState === "failed"
        ? { kind: "tool-error", toolCallId: "wait", errorText: JSON.stringify({ ...item, status: "failed" }) }
        : {
            kind: "tool-output",
            toolCallId: "wait",
            outputJson: JSON.stringify({
              ...item,
              status: "completed",
              agentsStates: { a: { status: "completed", message: "2 + 2 equals 4" } },
            }),
          },
    ],
  };
}

test("a completed wait cannot mark an active child completed", () => {
  render(<CodexAgentGroupPart part={group("started")} />);
  fireEvent.click(screen.getByRole("button", { name: /2 agents \(running\)/ }));
  expect(screen.getByRole("button", { name: /2 agents \(running\)/ })).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Agent 1 events" })).getByText("started")).toBeTruthy();
  expect(screen.getByText("2 + 2 equals 4")).toBeTruthy();
  expect(screen.queryByText(/collabAgentToolCall/)).toBeNull();
});

test("wait failures remain visible inside the single accordion", () => {
  render(<CodexAgentGroupPart part={group("completed", "failed")} />);
  fireEvent.click(screen.getByRole("button", { name: /2 agents \(failed\)/ }));
  expect(screen.getByText("Wait for agents failed")).toBeTruthy();
  expect(screen.queryByText(/collabAgentToolCall/)).toBeNull();
});

test("ended parent runs do not leave unfinished child spinners", () => {
  render(<CodexAgentGroupPart part={{ ...group("started"), runStatus: "completed" }} />);
  fireEvent.click(screen.getByRole("button", { name: "2 agents (ended)" }));
  expect(screen.getByText("ended")).toBeTruthy();
});

test("expanding the agent call preserves its lifecycle event history", () => {
  const part = group("completed");
  const agent = part.childTaskNoticeGroups![0];
  const completed = agent.notices[0];
  agent.notices = [{ ...completed, message: "spawned" }, { ...completed, message: "interacted" }, completed];
  render(<CodexAgentGroupPart part={part} />);
  fireEvent.click(screen.getByRole("button", { name: "2 agents (completed)" }));
  const events = screen.getByRole("list", { name: "Agent 0 events" });
  expect(
    within(events)
      .getAllByRole("listitem")
      .map((item) => item.textContent)
  ).toEqual(["spawned", "interacted", "completed"]);
});

test("successful empty waits remain inside the agent call", () => {
  const part = group("completed");
  part.childToolEvents![1] = {
    kind: "tool-output",
    toolCallId: "wait",
    outputJson: JSON.stringify({ type: "collabAgentToolCall", tool: "wait", status: "completed", receiverThreadIds: [], agentsStates: {} }),
  };
  render(<CodexAgentGroupPart part={part} />);
  fireEvent.click(screen.getByRole("button", { name: "2 agents (completed)" }));
  expect(screen.getByText("Wait for agents completed")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Agent wait" })).toBeNull();
});

test("retained event payloads can be inspected without copying debug JSON", () => {
  render(<CodexAgentGroupPart part={group("completed")} />);
  fireEvent.click(screen.getByRole("button", { name: "2 agents (completed)" }));
  expect(screen.queryByText(/collabAgentToolCall/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show raw data" }));
  expect(screen.getByText(/collabAgentToolCall/).textContent).toContain("codex_subagent");
});

test("duplicate lifecycle signals collapse without losing later transitions or raw events", () => {
  const part = group("completed");
  const agent = part.childTaskNoticeGroups![0];
  const notice = agent.notices[0];
  agent.notices = ["started", "started", "started", "started", "completed", "completed", "completed", "started", "completed"].map(
    (message) => ({ ...notice, message })
  );
  render(<CodexAgentGroupPart part={part} />);
  fireEvent.click(screen.getByRole("button", { name: "2 agents (completed)" }));
  expect(
    within(screen.getByRole("list", { name: "Agent 0 events" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent)
  ).toEqual(["started", "completed", "started", "completed"]);
  expect(within(screen.getByRole("list", { name: "Agent 1 events" })).getAllByRole("listitem")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Show raw data" }));
  const raw = JSON.parse(screen.getByText(/collabAgentToolCall/).textContent!);
  expect(raw.childTaskNoticeGroups[0].notices).toHaveLength(9);
});

test("retained interrupted waits are not displayed as completed", () => {
  const part = group("completed");
  part.childTaskNoticeGroups = [];
  part.childToolEvents![1] = {
    kind: "tool-output",
    toolCallId: "wait",
    outputJson: JSON.stringify({ type: "collabAgentToolCall", tool: "wait", status: "interrupted" }),
  };
  render(<CodexAgentGroupPart part={part} />);
  fireEvent.click(screen.getByRole("button", { name: /Agent calls \(failed\)/ }));
  expect(screen.getByText("Wait for agents interrupted")).toBeTruthy();
});

test("debug copy reports its outcome and handles clipboard failure", async () => {
  window.localStorage.setItem("convoy.dev-setting.tool-call-debug", "1");
  const success = vi.spyOn(toast, "success").mockImplementation(() => "toast");
  const error = vi.spyOn(toast, "error").mockImplementation(() => "toast");
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<CodexAgentGroupPart part={group("completed")} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy raw tool call JSON" }));
  await waitFor(() => expect(success).toHaveBeenCalledWith("Agent data copied"));
  writeText.mockRejectedValueOnce(new Error("denied"));
  fireEvent.click(screen.getByRole("button", { name: "Copy raw tool call JSON" }));
  await waitFor(() => expect(error).toHaveBeenCalledWith("Could not copy agent data"));
});
