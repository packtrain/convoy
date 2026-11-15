/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "./drawer";
import { mockScrollable } from "@/test-utils/scroll";

const dispatchSpy = vi.spyOn(HTMLElement.prototype, "dispatchEvent");
const unmountDispatches = () =>
  dispatchSpy.mock.calls.filter(
    ([event]) => event.type === "focusScope.autoFocusOnUnmount"
  ).length;

afterEach(() => cleanup());

// OS-1925: Radix FocusScope defers its unmount dispatch to a setTimeout(0).
test("renders an open menu, unmounted by afterEach", () => {
  render(
    <DropdownMenu modal={false} open>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>item</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  expect(screen.getByText("item")).toBeDefined();
  expect(unmountDispatches()).toBe(0);
});

test("the unmount dispatch ran before the next test, not after teardown", () => {
  expect(unmountDispatches()).toBe(1);
});

// OS-2198: a modal drawer's scroll lock swallowed touch/wheel scrolls in portaled non-modal menus.
test("a non-modal menu inside a drawer stays scrollable", () => {
  render(
    <Drawer open direction="right">
      <DrawerContent>
        <DrawerTitle>Task</DrawerTitle>
        <DrawerDescription>Details</DrawerDescription>
        <DropdownMenu modal={false} open>
          <DropdownMenuTrigger>open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <div data-testid="list">
              <DropdownMenuItem>item</DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </DrawerContent>
    </Drawer>
  );
  const list = mockScrollable(screen.getByTestId("list"));
  expect(fireEvent.wheel(list, { deltaY: 50 })).toBe(true);
});

// A submenu row's keycaps sit right before its chevron, with no gap between them.
test("sub trigger chevron hugs a trailing keycap group", async () => {
  const { DropdownMenuSub, DropdownMenuSubTrigger } = await import("./dropdown-menu");
  render(
    <DropdownMenu modal={false} open>
      <DropdownMenuTrigger>open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Priority</DropdownMenuSubTrigger>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const trigger = screen.getByText("Priority").closest("[data-slot=dropdown-menu-sub-trigger]")!;
  expect(trigger.querySelector("svg")!.getAttribute("class")).toContain("[[data-slot=kbd-group]+&]:ml-0");
});
