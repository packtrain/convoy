/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useTaskLinkActions } from "./task-action-menu-items";

vi.mock("@/lib/navigation/use-route-params", () => ({
  useRouteParams: () => ({ organizationSlug: "acme", threadId: "thread_1" }),
}));

// On a thread page the pathname is the thread, not the task (OS-2325).
describe("useTaskLinkActions", () => {
  test("links to the task page, not the current page", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    window.history.pushState({}, "", "/o/acme/threads/thread_1?tab=task");
    const taskUrl = `${window.location.origin}/o/acme/WEB?task=WEB-7`;

    const { result } = renderHook(() => useTaskLinkActions("WEB-7"));
    result.current.handleCopyLink();
    result.current.handleOpenInNewTab();

    expect(writeText).toHaveBeenCalledWith(taskUrl);
    expect(open).toHaveBeenCalledWith(taskUrl, "_blank");
  });
});
