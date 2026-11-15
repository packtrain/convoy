/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { toContextWindowUsage } from "@/lib/cli-stream-ui";
import { ContextWindowMeter } from "./context-window-meter";

const USAGE = toContextWindowUsage({ usedTokens: 440_000, maxTokens: 1_000_000 });

test("the popover's Compact button compacts and closes the popover (OS-2339)", () => {
  const onCompact = vi.fn();
  render(<ContextWindowMeter usage={USAGE} onCompact={onCompact} />);
  fireEvent.click(screen.getByRole("button", { name: "Context window 44% used" }));
  const compact = screen.getByRole("button", { name: "Compact context" });
  fireEvent.click(compact);
  expect(onCompact).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Context window")).toBeNull();
});

test("no Compact button without a compact handler", () => {
  render(<ContextWindowMeter usage={USAGE} />);
  fireEvent.click(screen.getByRole("button", { name: "Context window 44% used" }));
  expect(screen.getByText("Context window")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Compact context" })).toBeNull();
});
