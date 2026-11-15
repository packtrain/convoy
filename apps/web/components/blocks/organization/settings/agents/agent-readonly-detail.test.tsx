/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { Id } from "@/convex/_generated/dataModel";
import { AgentReadonlyDetail } from "./agent-readonly-detail";

const readonlyMarkdownMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/blocks/settings-catalog/settings-readonly-markdown", () => ({
  SettingsReadonlyMarkdown: ({ value }: { value: string }) => {
    readonlyMarkdownMock(value);
    return <div data-testid="readonly-markdown">{value}</div>;
  },
}));

describe("AgentReadonlyDetail", () => {
  afterEach(() => {
    cleanup();
    readonlyMarkdownMock.mockClear();
  });

  test("renders metadata and sends prompt markdown to the shared renderer", () => {
    const prompt = [
      "# Code Reviewer",
      "",
      "Check the diff.",
      "",
      "```ts",
      "const reviewed = true;",
      "```",
    ].join("\n");

    render(
      <AgentReadonlyDetail
        agent={{
          _id: "agent_1" as Id<"agents">,
          name: "Code Reviewer",
          description: "Reviews code",
          category: "Engineering",
          prompt,
          appearance: { color: "#3b82f6" },
        }}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Code Reviewer" })).toBeDefined();
    expect(screen.getByText("Reviews code")).toBeDefined();
    expect(screen.getByText("Engineering")).toBeDefined();
    expect(screen.getByTestId("readonly-markdown")).toBeDefined();
    expect(readonlyMarkdownMock).toHaveBeenCalledWith(prompt);
  });
});
