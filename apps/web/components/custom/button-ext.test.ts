/** @vitest-environment jsdom */
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import * as buttonExt from "./button-ext";
import { ActionButton } from "./action-button";

afterEach(cleanup);

describe("ActionButton", () => {
  test("renders through ui/button, so variants match every other button", () => {
    render(createElement(ActionButton, { variant: "outline" }, "Save"));
    const button = screen.getByRole("button", { name: "Save" });

    expect(button.getAttribute("data-slot")).toBe("button");
    // ui/button's outline hover; the old copy used `hover:bg-accent`.
    expect(button.classList.contains("hover:bg-muted")).toBe(true);
    expect(button.classList.contains("hover:bg-accent")).toBe(false);
  });

  test("button-ext no longer declares its own variant table", () => {
    expect("buttonVariants" in buttonExt).toBe(false);
  });
});
