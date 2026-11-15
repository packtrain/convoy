/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ThreadCliOfflineBanner } from "./thread-cli-offline-banner";

afterEach(cleanup);

describe("ThreadCliOfflineBanner", () => {
  test("shows only for a loaded profile that is offline", () => {
    const { rerender } = render(<ThreadCliOfflineBanner isOnline={undefined} />);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<ThreadCliOfflineBanner isOnline />);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<ThreadCliOfflineBanner isOnline={false} />);
    expect(screen.getByRole("status").textContent).toBe(
      "CLI offline. Messages will queue until it reconnects."
    );
  });
});
