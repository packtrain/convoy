/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadMiniPreview } from "./thread-mini-preview";

const thread = {
  _id: "thread_1" as Id<"cliThreads">,
  projectId: "project_1",
  cliType: "claude-code",
};

vi.mock("convex/react", () => ({
  useQuery: () => ({ organizationId: "org_1" }),
}));

vi.mock("@/lib/threads/hooks/use-cli-thread", () => ({
  useCliThread: () => ({ thread, isLoading: false }),
}));

vi.mock("@/lib/threads/hooks/use-cli-messages", () => ({
  useCliMessages: () => ({ isLoading: false, messages: [] }),
}));

vi.mock("@/components/blocks/thread/thread-view/thread-view", () => ({
  ThreadView: () => <div data-testid="thread-view" />,
}));

vi.mock("@/components/blocks/thread/thread-draft-provider", () => ({
  ThreadDraftProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

afterEach(cleanup);

describe("ThreadMiniPreview", () => {
  test("lets the embedded thread shrink on both axes", () => {
    const { container } = render(
      <ThreadMiniPreview
        threadId={thread._id}
        organizationSlug="acme"
        projectAlias="ABC"
      />
    );

    // The host is a fixed-width `overflow-hidden` popover. A grid track left at
    // `auto` sizes to its content's min-content width, which clips the trailing
    // edge — tab strip, answered count, composer stop button (OS-1602).
    const wrapper = screen.getByTestId("thread-view").parentElement;
    expect(wrapper).toBe(container.firstElementChild);
    expect(wrapper?.className).toContain("min-w-0");
    expect(wrapper?.className).toContain("grid-cols-[minmax(0,1fr)]");
    // Height already had to be bounded for the scroll areas inside to work.
    expect(wrapper?.className).toContain("min-h-0");
    expect(wrapper?.className).toContain("grid-rows-[minmax(0,1fr)]");
  });
});
