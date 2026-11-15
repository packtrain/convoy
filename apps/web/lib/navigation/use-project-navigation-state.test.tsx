/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useProjectNavigationState } from "./use-project-navigation-state";
import { href } from "./target";
import { BACKLOG_LIST_REF } from "@/lib/task-lists/system-lists";

const navigationMocks = vi.hoisted(() => ({
  pathname: "/o/acme/WEB",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
  useRouter: () => ({
    push: navigationMocks.push,
    replace: navigationMocks.replace,
  }),
}));

describe("useProjectNavigationState", () => {
  beforeEach(() => {
    navigationMocks.pathname = "/o/acme/WEB";
    navigationMocks.push.mockReset();
    navigationMocks.replace.mockReset();
    window.history.replaceState({}, "", "/o/acme/WEB");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("opens tasks on the same pathname with native history", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useProjectNavigationState());

    act(() => {
      result.current.openTask("WEB-1");
    });

    expect(pushStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB?task=WEB-1"
    );
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });

  test("keeps Backlog on the board route when selected from Board", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    navigationMocks.pathname = "/o/acme/WEB/kanban";
    window.history.replaceState({}, "", "/o/acme/WEB/kanban");
    const { result } = renderHook(() => useProjectNavigationState());

    act(() => {
      result.current.setSelectedListRef(BACKLOG_LIST_REF);
    });

    expect(pushStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/kanban?list=BACKLOG"
    );
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });

  test("selecting Backlog preserves status filters in the same navigation", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    window.history.replaceState({}, "", "/o/acme/WEB?filter=done");
    const { result } = renderHook(() => useProjectNavigationState());

    act(() => {
      result.current.setSelectedListRef(BACKLOG_LIST_REF);
    });

    expect(pushStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB?filter=done&list=BACKLOG",
    );
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });

  test("a List with a Board default view switches the view on selection", () => {
    window.history.replaceState({}, "", "/o/acme/WEB");
    const { result } = renderHook(() => useProjectNavigationState());

    act(() => {
      result.current.setSelectedListRef("SPRINT-1", {
        viewMode: "board",
        boardGroupBy: "priority",
        listGroupBy: "none",
        boardRowGroupBy: "none",
      fromList: true,
      });
    });

    expect(navigationMocks.push).toHaveBeenCalledWith(
      "/o/acme/WEB/kanban?list=SPRINT-1&groupBy=priority",
      { scroll: false }
    );
  });

  test("a List with a List default view leaves Board and clears the grouping", () => {
    navigationMocks.pathname = "/o/acme/WEB/kanban";
    window.history.replaceState({}, "", "/o/acme/WEB/kanban?groupBy=priority");
    const { result } = renderHook(() => useProjectNavigationState());

    act(() => {
      result.current.setSelectedListRef("SPRINT-1", {
        viewMode: "list",
        boardGroupBy: "status",
        listGroupBy: "none",
        boardRowGroupBy: "none",
      fromList: true,
      });
    });

    expect(navigationMocks.push).toHaveBeenCalledWith(
      "/o/acme/WEB?list=SPRINT-1",
      { scroll: false }
    );
  });

  test("selecting a List with no resolved default view keeps the on-screen view", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    navigationMocks.pathname = "/o/acme/WEB/kanban";
    window.history.replaceState({}, "", "/o/acme/WEB/kanban?groupBy=priority");
    const { result } = renderHook(() => useProjectNavigationState());

    act(() => {
      result.current.setSelectedListRef("SPRINT-1");
    });

    expect(pushStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/kanban?list=SPRINT-1&groupBy=priority"
    );
  });

  test("selecting Archived from Board redirects to the table route and clears Board-only state", () => {
    navigationMocks.pathname = "/o/acme/WEB/kanban";
    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB/kanban?filter=done&assignee=me&list=SPRINT-1&groupBy=priority"
    );
    const { result } = renderHook(() => useProjectNavigationState());

    act(() => {
      result.current.setArchiveFilter("archived");
    });

    expect(navigationMocks.push).toHaveBeenCalledTimes(1);
    expect(navigationMocks.push).toHaveBeenCalledWith(
      "/o/acme/WEB?archived=true",
      { scroll: false }
    );
  });

  test("task search links from Board target the owning List and preserve the Board return preference", () => {
    navigationMocks.pathname = "/o/acme/WEB/kanban";
    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB/kanban?filter=done&assignee=me&list=SPRINT-1&groupBy=priority"
    );
    const { result } = renderHook(() => useProjectNavigationState());

    expect(result.current.taskInBoardHref("WEB-1", "archived")).toBe(
      "/o/acme/WEB?task=WEB-1&archived=true"
    );
    expect(result.current.taskInBoardHref("WEB-1", "active", "SPRINT-2")).toBe(
      "/o/acme/WEB?task=WEB-1&filter=done&assignee=me&list=SPRINT-2&view=board&groupBy=priority"
    );
  });

  test("normalized table targets clear Board-only URL state", () => {
    navigationMocks.pathname = "/o/acme/WEB/kanban";
    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB/kanban?task=WEB-1&filter=done&list=SPRINT-1&groupBy=priority&view=board"
    );
    const { result } = renderHook(() => useProjectNavigationState());

    expect(href(result.current.normalizedListTarget())).toBe(
      "/o/acme/WEB?task=WEB-1&filter=done&list=SPRINT-1"
    );
  });

  test("view switch targets preserve filter and List state while clearing task state", () => {
    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB?task=WEB-1&filter=done&assignee=me&list=SPRINT-1&groupBy=priority"
    );
    const { result } = renderHook(() => useProjectNavigationState());

    expect(result.current.boardPath).toBe("/o/acme/WEB/kanban");
    expect(href(result.current.boardViewTarget())).toBe(
      "/o/acme/WEB/kanban?filter=done&assignee=me&list=SPRINT-1&groupBy=priority"
    );
    expect(href(result.current.listViewTarget())).toBe(
      "/o/acme/WEB?filter=done&assignee=me&list=SPRINT-1&groupBy=priority"
    );
  });

  test("view switches fill a missing grouping from the default and keep URL grouping", () => {
    const defaultView = {
      viewMode: "list" as const, listGroupBy: "status" as const,
      boardGroupBy: "assignee" as const, boardRowGroupBy: "priority" as const, fromList: false,
    };
    window.history.replaceState({}, "", "/o/acme/WEB?listGroupBy=owner");
    const list = renderHook(() => useProjectNavigationState());
    expect(href(list.result.current.boardViewTarget(defaultView))).toBe(
      "/o/acme/WEB/kanban?listGroupBy=owner&groupBy=assignee&rowGroupBy=priority"
    );
    list.unmount();

    navigationMocks.pathname = "/o/acme/WEB/kanban";
    window.history.replaceState({}, "", "/o/acme/WEB/kanban?groupBy=label&rowGroupBy=none");
    const board = renderHook(() => useProjectNavigationState());
    expect(href(board.result.current.listViewTarget(defaultView))).toBe(
      "/o/acme/WEB?listGroupBy=status&groupBy=label&rowGroupBy=none"
    );
    // The board's explicit No rows survives the round trip.
    expect(href(board.result.current.boardViewTarget(defaultView))).toBe(
      "/o/acme/WEB/kanban?groupBy=label&rowGroupBy=none"
    );
    board.unmount();

    window.history.replaceState({}, "", "/o/acme/WEB/kanban?listGroupBy=none");
    const ungrouped = renderHook(() => useProjectNavigationState());
    expect(href(ungrouped.result.current.listViewTarget(defaultView))).toBe("/o/acme/WEB?listGroupBy=none");
  });

  test("defaults missing Board grouping to status", () => {
    const { result } = renderHook(() => useProjectNavigationState());

    expect(result.current.boardGroupBy).toBe("status");
  });

  test("changes Board grouping without clearing Board URL state", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    navigationMocks.pathname = "/o/acme/WEB/kanban";
    window.history.replaceState(
      {},
      "",
      "/o/acme/WEB/kanban?task=WEB-1&artifact=artifact-1&filter=done&assignee=me&list=SPRINT-1"
    );
    const { result } = renderHook(() => useProjectNavigationState());

    act(() => {
      result.current.setBoardGroupBy("type");
    });

    expect(pushStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/o/acme/WEB/kanban?task=WEB-1&artifact=artifact-1&filter=done&assignee=me&list=SPRINT-1&groupBy=type"
    );
    expect(result.current.boardGroupByHref("status")).toBe(
      "/o/acme/WEB/kanban?task=WEB-1&artifact=artifact-1&filter=done&assignee=me&list=SPRINT-1&groupBy=status"
    );
    expect(navigationMocks.push).not.toHaveBeenCalled();
  });
  test("list grouping changes preserve task/filter state and None clears the URL", () => {
    window.history.replaceState({}, "", "/o/acme/WEB?task=WEB-1&filter=active");
    const { result } = renderHook(() => useProjectNavigationState());
    act(() => { result.current.setListGroupBy("owner"); });
    expect(new URLSearchParams(window.location.search).get("listGroupBy")).toBe("owner");
    expect(new URLSearchParams(window.location.search).get("task")).toBe("WEB-1");
    expect(result.current.listGroupBy).toBe("owner");
    act(() => { result.current.setListGroupBy("none"); });
    expect(new URLSearchParams(window.location.search).get("listGroupBy")).toBe("none");
    expect(result.current.listGroupBy).toBe("none");
  });

  test("board rows: picking the other axis's dimension swaps axes; List view keeps rows", () => {
    navigationMocks.pathname = "/o/acme/WEB/kanban";
    window.history.replaceState({}, "", "/o/acme/WEB/kanban?task=WEB-1");
    const { result } = renderHook(() => useProjectNavigationState());
    const search = () => new URLSearchParams(window.location.search);
    act(() => { result.current.setBoardRowGroupBy("section"); });
    expect(search().get("rowGroupBy")).toBe("section");
    expect(search().get("task")).toBe("WEB-1");
    expect(result.current.boardRowGroupBy).toBe("section");
    act(() => { result.current.setBoardGroupBy("section"); });
    expect([search().get("groupBy"), search().get("rowGroupBy")]).toEqual(["section", "status"]);
    act(() => { result.current.setBoardRowGroupBy("section"); });
    expect([search().get("groupBy"), search().get("rowGroupBy")]).toEqual(["status", "section"]);
    expect(href(result.current.listViewTarget())).toContain("rowGroupBy=section");
    act(() => { result.current.setBoardRowGroupBy("none"); });
    expect(search().get("rowGroupBy")).toBe("none");
    expect(result.current.boardRowGroupBy).toBe("none");
    act(() => {
      result.current.setSelectedListRef("SPRINT-1", {
        viewMode: "board", boardGroupBy: "label", boardRowGroupBy: "owner", listGroupBy: "none", fromList: true,
      });
    });
    expect([search().get("groupBy"), search().get("rowGroupBy")]).toEqual(["label", "owner"]);
  });

  test("selecting a grouped List default applies its dimension", () => {
    const { result } = renderHook(() => useProjectNavigationState());
    act(() => { result.current.setSelectedListRef("SPRINT-1", { viewMode: "list", boardGroupBy: "status", listGroupBy: "owner", boardRowGroupBy: "none", fromList: true }); });
    expect(new URLSearchParams(window.location.search).get("listGroupBy")).toBe("owner");
    expect(new URLSearchParams(window.location.search).get("list")).toBe("SPRINT-1");
  });

});
