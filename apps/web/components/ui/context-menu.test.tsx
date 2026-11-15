/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu";

afterEach(() => cleanup());

// A submenu row's keycaps sit right before its chevron, with no gap between them.
test("sub trigger chevron hugs a trailing keycap group", () => {
  render(
    <ContextMenu>
      <ContextMenuTrigger>area</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Priority</ContextMenuSubTrigger>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
  fireEvent.contextMenu(screen.getByText("area"));
  const trigger = screen.getByText("Priority").closest("[data-slot=context-menu-sub-trigger]")!;
  expect(trigger.querySelector("svg")!.getAttribute("class")).toContain("[[data-slot=kbd-group]+&]:ml-0");
});
