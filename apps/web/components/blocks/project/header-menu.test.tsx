/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { HeaderMenu } from "./header-menu";

function renderOpenMenu() {
  render(
    <>
      <HeaderMenu trigger={({ toggle }) => <button onClick={toggle}>Open</button>}>
        {() => createPortal(<div data-slot="select-content">Option</div>, document.body)}
      </HeaderMenu>
      <div>Outside</div>
    </>
  );
  fireEvent.click(screen.getByText("Open"));
  expect(screen.getByRole("menu")).toBeDefined();
}

describe("HeaderMenu outside dismissal", () => {
  afterEach(cleanup);

  test("stays open when pressing a portaled select option", () => {
    renderOpenMenu();
    fireEvent.pointerDown(screen.getByText("Option"));
    expect(screen.queryByRole("menu")).not.toBeNull();
  });

  test("closes when pressing outside", () => {
    renderOpenMenu();
    fireEvent.pointerDown(screen.getByText("Outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
