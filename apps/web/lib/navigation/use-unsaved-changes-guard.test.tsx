/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("./core", () => ({
  useNavigation: () => ({ push: pushMock }),
}));

function Harness({ enabled }: { enabled: boolean }) {
  const guard = useUnsavedChangesGuard(enabled);
  return (
    <div>
      <a href="/guarded/next-page">Back to workflows</a>
      <a href="https://example.com/docs">Docs</a>
      <span>{guard.blockedHref ?? "not blocked"}</span>
      <button type="button" onClick={guard.stay}>
        Stay
      </button>
      <button type="button" onClick={guard.leave}>
        Leave
      </button>
    </div>
  );
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useUnsavedChangesGuard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("blocks reload only while enabled", () => {
    const { rerender } = render(<Harness enabled={false} />);
    expect(dispatchBeforeUnload()).toBe(false);

    rerender(<Harness enabled />);
    expect(dispatchBeforeUnload()).toBe(true);

    rerender(<Harness enabled={false} />);
    expect(dispatchBeforeUnload()).toBe(false);
  });

  test("swallows an in-app link click and navigates only once the user leaves", () => {
    render(<Harness enabled />);

    const click = fireEvent.click(screen.getByText("Back to workflows"));

    expect(click).toBe(false); // preventDefault kept the browser from navigating
    expect(screen.getByText("/guarded/next-page")).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByText("not blocked")).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Back to workflows"));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByText("not blocked")).toBeTruthy();
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/guarded/next-page" })
    );
  });

  test("leaves clicks alone when disabled, and external links always", () => {
    const { rerender } = render(<Harness enabled={false} />);
    expect(fireEvent.click(screen.getByText("Back to workflows"))).toBe(true);
    expect(screen.getByText("not blocked")).toBeTruthy();

    rerender(<Harness enabled />);
    expect(fireEvent.click(screen.getByText("Docs"))).toBe(true);
    expect(screen.getByText("not blocked")).toBeTruthy();
  });
});
