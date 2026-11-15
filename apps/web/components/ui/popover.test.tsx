/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "./drawer";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { mockScrollable } from "@/test-utils/scroll";

afterEach(() => cleanup());

// OS-2198: a modal drawer's scroll lock swallowed touch/wheel scrolls in portaled popovers.
test("a popover inside a drawer stays scrollable", () => {
  render(
    <Drawer open direction="right">
      <DrawerContent>
        <DrawerTitle>Task</DrawerTitle>
        <DrawerDescription>Details</DrawerDescription>
        <Popover open>
          <PopoverTrigger>open</PopoverTrigger>
          <PopoverContent>
            <div data-testid="list">
              item
            </div>
          </PopoverContent>
        </Popover>
      </DrawerContent>
    </Drawer>
  );
  const list = mockScrollable(screen.getByTestId("list"));
  expect(fireEvent.wheel(list, { deltaY: 50 })).toBe(true);
});
