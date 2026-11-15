/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { NewKeyDisplay } from "./new-key-display";

afterEach(cleanup);

test("the copy and dismiss buttons are named", () => {
  const onDismiss = vi.fn();
  render(<NewKeyDisplay apiKey="sk_user_123" onDismiss={onDismiss} />);

  expect(screen.getByRole("button", { name: "Copy API key" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
