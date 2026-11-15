/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/errors";
import { useTaskUndoActions } from "./use-task-undo-actions";

const toastErrorMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

// A stale tab's archive or delete says why it failed (docs/specs/read-only-viewer-ux.md, Soft failures).
describe("useTaskUndoActions rejections", () => {
  test.each(["executeArchiveWithUndo", "executeDeleteWithUndo"] as const)(
    "%s toasts the permission copy for a denial",
    async (action) => {
      const { result } = renderHook(() => useTaskUndoActions({ restoreTask: vi.fn(), bulkUnarchive: vi.fn() }));

      result.current[action](() => Promise.reject(new ConvexError("Permission denied: task:update")), "Failed");

      await vi.waitFor(() => expect(toastErrorMock).toHaveBeenLastCalledWith(PERMISSION_DENIED_MESSAGE));
    }
  );

  test("keeps the caller's message for a plain server error", async () => {
    const { result } = renderHook(() => useTaskUndoActions({ restoreTask: vi.fn(), bulkUnarchive: vi.fn() }));

    result.current.executeArchiveWithUndo(() => Promise.reject(new Error("[CONVEX M(x)] Server Error")), "Failed to archive task");

    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenLastCalledWith("Failed to archive task"));
  });
});
