/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { SlashCommandReadonlyDetail } from "./slash-command-readonly-detail";

const readonlyMarkdownMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/blocks/settings-catalog/settings-readonly-markdown", () => ({
  SettingsReadonlyMarkdown: ({ value }: { value: string }) => {
    readonlyMarkdownMock(value);
    return <div data-testid="readonly-markdown">{value}</div>;
  },
}));

describe("SlashCommandReadonlyDetail", () => {
  afterEach(() => {
    cleanup();
    readonlyMarkdownMock.mockClear();
  });

  test("renders metadata and sends markdown content to the shared renderer", () => {
    const content = ["# Instructions", "", "Review **risk**.", "", "```ts", "const ok = true;", "```", "", "- One", "- Two"].join("\n");

    render(
      <SlashCommandReadonlyDetail
        command={{
          _id: "cmd_1" as Id<"slashCommands">,
          key: "review",
          description: "Review contracts",
          category: "Legal",
          content,
          autoExpand: true,
          autoSubmit: true,
        }}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "/review" })).toBeDefined();
    expect(screen.getByText("Legal")).toBeDefined();
    expect(screen.getByText("Auto-expand")).toBeDefined();
    expect(screen.getByText("Autosubmit")).toBeDefined();
    expect(screen.getByTestId("readonly-markdown")).toBeDefined();
    expect(readonlyMarkdownMock).toHaveBeenCalledWith(content);
  });
});
