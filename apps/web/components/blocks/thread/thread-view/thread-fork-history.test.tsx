/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadForkDivider, ThreadForkHistory } from "./thread-fork-history";

const queryMock = vi.fn();
const convexClient = { query: (...args: unknown[]) => queryMock(...args) };
vi.mock("convex/react", () => ({ useConvex: () => convexClient }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/org/ABC/threads/thread_fork",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const useForkPrefixMock = vi.fn();
vi.mock("@/lib/threads/hooks/use-fork-prefix", () => ({
  useForkPrefix: (...args: unknown[]) => useForkPrefixMock(...args),
}));

const listPropsMock = vi.fn();
vi.mock("./thread-message-list", () => ({
  ThreadMessageList: (props: { visibleMessages: unknown[]; transcriptHeader?: React.ReactNode; transcriptDivider?: { node: React.ReactNode } }) => {
    listPropsMock(props);
    return (
      <div data-testid="prefix-list">
        {props.transcriptHeader}
        {props.visibleMessages.length} earlier
        {props.transcriptDivider?.node}
      </div>
    );
  },
}));

const forkedFrom = {
  threadId: "thread_parent" as Id<"cliThreads">,
  runStart: { messageId: "message_ask" as Id<"cliMessages">, createdAt: 3000 },
  reply: { messageId: "message_reply" as Id<"cliMessages">, createdAt: 3500 },
  runId: "run-copied",
  continuationId: "session-1",
};

function loadedPrefix(overrides: Record<string, unknown> = {}) {
  return {
    status: "loaded",
    segments: [],
    renderStateByMessageId: new Map(),
    userTextById: new Map(),
    userMessageResponseMap: new Map(),
    hasOlder: false,
    isLoadingOlder: false,
    loadOlder: vi.fn(),
    ...overrides,
  };
}

const common = { organizationSlug: "org", projectAlias: "ABC", taskLinkHref: () => "#" };

describe("ThreadForkDivider", () => {
  afterEach(() => {
    cleanup();
    queryMock.mockReset();
  });

  test("names the parent with a link, on a separator line", async () => {
    queryMock.mockResolvedValue({ title: "Fix the bug" });
    render(<ThreadForkDivider forkedFrom={forkedFrom} {...common} />);

    const link = await screen.findByRole("link", { name: "Fix the bug" });
    expect(link.getAttribute("href")).toBe("/o/org/ABC/threads/thread_parent");
    const divider = screen.getByText(/^Forked from/).closest("[data-slot='marker']");
    expect(divider?.getAttribute("data-variant")).toBe("separator");
  });

  test("names a deleted parent", async () => {
    queryMock.mockResolvedValue(null);
    render(<ThreadForkDivider forkedFrom={forkedFrom} {...common} />);
    await waitFor(() => expect(screen.getByText("Forked from a deleted thread")).toBeDefined());
  });
});

describe("ThreadForkHistory", () => {
  afterEach(() => {
    cleanup();
    queryMock.mockReset();
    useForkPrefixMock.mockReset();
    listPropsMock.mockReset();
  });

  test("loads the parent's earlier messages without a toggle", async () => {
    queryMock.mockResolvedValue({ title: "Fix the bug" });
    const userMessageResponseMap = new Map();
    useForkPrefixMock.mockReturnValue(
      loadedPrefix({ segments: [{ forkedFrom, messages: [{ _id: "m1" }, { _id: "m2" }] }], userMessageResponseMap, hasOlder: true })
    );

    render(<ThreadForkHistory forkedFrom={forkedFrom} {...common} />);

    expect(useForkPrefixMock).toHaveBeenLastCalledWith({ forkedFrom });
    expect(screen.getByTestId("prefix-list").textContent).toBe("2 earlier");
    expect(screen.queryByRole("button", { name: /earlier messages/ })).toBeNull();
    const listProps = listPropsMock.mock.calls.at(-1)?.[0];
    expect(listProps).toMatchObject({ embedded: true, userMessageResponseMap, showOlderMessagesCut: true, showOlderMessagesLabel: "Show more" });
    expect(listProps).not.toHaveProperty("onSubmitEditLast");
    expect(listProps.onBranchFromHere).toBeUndefined();
    expect(listProps.transcriptDivider).toBeUndefined();
  });

  test("forwards the row-level data and open handlers so history rows match live ones", () => {
    const askUserQuestionResponses = { toolu_1: {} };
    const getUserMessageAttachments = vi.fn();
    useForkPrefixMock.mockReturnValue(
      loadedPrefix({ segments: [{ forkedFrom, messages: [{ _id: "m1" }] }], askUserQuestionResponses, getUserMessageAttachments })
    );
    const handlers = { onOpenArtifact: vi.fn(), onOpenTaskRef: vi.fn(), onOpenTaskInSidebar: vi.fn(), onOpenDiffFile: vi.fn() };
    render(<ThreadForkHistory forkedFrom={forkedFrom} {...common} {...handlers} />);
    expect(listPropsMock.mock.calls.at(-1)?.[0]).toMatchObject({ askUserQuestionResponses, getUserMessageAttachments, ...handlers });
  });

  test("passes the branch handler through so history replies can be branched", () => {
    useForkPrefixMock.mockReturnValue(loadedPrefix({ segments: [{ forkedFrom, messages: [{ _id: "m1" }] }] }));
    const onBranchFromHere = vi.fn();
    render(<ThreadForkHistory forkedFrom={forkedFrom} {...common} onBranchFromHere={onBranchFromHere} />);
    expect(listPropsMock.mock.calls.at(-1)?.[0].onBranchFromHere).toBe(onBranchFromHere);
  });

  test("renders nothing for an empty history and a note for an unavailable one", async () => {
    useForkPrefixMock.mockReturnValue(loadedPrefix({ segments: [{ forkedFrom, messages: [] }] }));
    const { unmount } = render(<ThreadForkHistory forkedFrom={forkedFrom} {...common} />);
    expect(screen.queryByTestId("prefix-list")).toBeNull();
    unmount();

    useForkPrefixMock.mockReturnValue(loadedPrefix({ status: "unavailable" }));
    render(<ThreadForkHistory forkedFrom={forkedFrom} {...common} />);
    expect(screen.getByText("The original thread is no longer available.")).toBeDefined();
  });

  test("a fork of a fork renders one list per ancestor, oldest first, with the divider among the parent's rows", async () => {
    const grandparentFork = { ...forkedFrom, threadId: "thread_grandparent" as Id<"cliThreads">, runId: "run-grand" };
    queryMock.mockResolvedValue({ title: "read again" });
    useForkPrefixMock.mockReturnValue(
      loadedPrefix({
        segments: [
          { forkedFrom: grandparentFork, title: "The first attempt", messages: [{ _id: "g1", role: "user", runId: "run-g" }] },
          {
            forkedFrom,
            title: "Fix the bug",
            parentForkedFrom: grandparentFork,
            messages: [{ _id: "p1", role: "user", runId: "run-grand" }, { _id: "p2", role: "assistant", runId: "run-grand" }, { _id: "p3", role: "user", runId: "run-x" }],
          },
        ],
        hasOlder: true,
      })
    );

    render(<ThreadForkHistory forkedFrom={forkedFrom} {...common} />);

    const lists = screen.getAllByTestId("prefix-list");
    expect(lists.map((list) => list.textContent)).toEqual(["1 earlier", expect.stringContaining("3 earlier")]);
    const [grandparentList, parentList] = listPropsMock.mock.calls.slice(-2).map(([props]) => props);
    // Only the oldest list carries the "Show more" cut.
    expect(grandparentList).toMatchObject({ showOlderMessagesCut: true, transcriptDivider: undefined });
    expect(parentList).toMatchObject({ showOlderMessagesCut: false });
    expect(parentList.transcriptDivider.afterMessageId).toBe("p2");
    // The loaded hop already carries the grandparent's title; the divider does not read it again.
    const link = await screen.findByRole("link", { name: "The first attempt" });
    expect(link.getAttribute("href")).toBe("/o/org/ABC/threads/thread_grandparent");
    expect(queryMock).not.toHaveBeenCalled();
  });
});
