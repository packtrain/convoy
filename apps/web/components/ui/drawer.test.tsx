/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "./drawer";

class FakeVisualViewport extends EventTarget {
  height = window.innerHeight;
}

let viewport: FakeVisualViewport;

function renderDrawer(direction: "right" | "bottom") {
  render(
    <Drawer open direction={direction}>
      <DrawerContent data-testid="drawer-content">
        <DrawerTitle>Title</DrawerTitle>
        <DrawerDescription>Description</DrawerDescription>
        <textarea aria-label="Composer" />
      </DrawerContent>
    </Drawer>
  );
}

function openKeyboard() {
  act(() => {
    screen.getByLabelText("Composer").focus();
    viewport.height = window.innerHeight - 300;
    viewport.dispatchEvent(new Event("resize"));
  });
}

describe("Drawer keyboard repositioning", () => {
  beforeEach(() => {
    viewport = new FakeVisualViewport();
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "visualViewport");
  });

  test("leaves a side drawer's size alone when the keyboard opens", () => {
    renderDrawer("right");
    openKeyboard();

    const content = screen.getByTestId("drawer-content");
    expect(content.style.height).toBe("");
    expect(content.style.bottom).toBe("");
  });

  test("still lifts a bottom drawer above the keyboard", () => {
    renderDrawer("bottom");
    openKeyboard();

    expect(screen.getByTestId("drawer-content").style.bottom).toBe("300px");
  });
});
