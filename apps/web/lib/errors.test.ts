/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import { PERMISSION_DENIED_MESSAGE, showConvexErrorToast, toastMutationRejection } from "./errors";

const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe("showConvexErrorToast", () => {
  afterEach(() => {
    toastErrorMock.mockReset();
  });

  test("shows convex string data when available", () => {
    const message = showConvexErrorToast(
      new ConvexError("Task not found"),
      "Fallback message"
    );

    expect(message).toBe("Task not found");
    expect(toastErrorMock).toHaveBeenCalledWith("Task not found");
  });

  test("falls back when convex error data is not a string", () => {
    const message = showConvexErrorToast(
      new ConvexError({ code: "permission_denied" }),
      "Fallback message"
    );

    expect(message).toBe("Fallback message");
    expect(toastErrorMock).toHaveBeenCalledWith("Fallback message");
  });

  test("swaps a server permission denial for friendly copy", () => {
    const message = showConvexErrorToast(
      new ConvexError("Permission denied: task:update"),
      "Fallback message"
    );

    expect(message).toBe(PERMISSION_DENIED_MESSAGE);
    expect(toastErrorMock).toHaveBeenCalledWith(PERMISSION_DENIED_MESSAGE);
  });

  test("shows generic error messages", () => {
    const message = showConvexErrorToast(
      new Error("Unexpected failure"),
      "Fallback message"
    );

    expect(message).toBe("Unexpected failure");
    expect(toastErrorMock).toHaveBeenCalledWith("Unexpected failure");
  });
});

describe("toastMutationRejection", () => {
  afterEach(() => {
    toastErrorMock.mockReset();
  });

  test("shows one friendly toast however many rows a bulk write rejects", () => {
    toastMutationRejection(new ConvexError("Permission denied: task:update"));
    toastMutationRejection(new ConvexError("Permission denied: task:update"));

    expect(toastErrorMock).toHaveBeenCalledTimes(2);
    const [first, second] = toastErrorMock.mock.calls;
    expect(first[0]).toBe(PERMISSION_DENIED_MESSAGE);
    expect(second).toEqual(first);
    expect(first[1]).toEqual({ id: expect.any(String) });
  });

  test("never shows a raw server error message", () => {
    toastMutationRejection(new Error("[CONVEX M(tasks/core:update)] Server Error"));

    expect(toastErrorMock).toHaveBeenCalledWith("Couldn't save your change", { id: expect.any(String) });
  });
});
