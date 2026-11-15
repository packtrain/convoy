/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { SleepRow } from "./sleep-part";

afterEach(cleanup);

describe("SleepRow", () => {
  test("is a shared tool row that discloses its timing details", () => {
    const { container } = render(<SleepRow state="completed" requested={30} elapsed={31} />);

    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("[data-slot='tool-chevron']")).not.toBeNull();
    expect(screen.queryByText("Requested")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Slept for 31s/ }));
    expect(screen.getByText("Requested")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  test("calls an interruption a run interruption", () => {
    render(<SleepRow state="interrupted" requested={30} />);
    fireEvent.click(screen.getByRole("button", { name: /Sleep interrupted/ }));
    expect(screen.getByText("Run interrupted")).toBeTruthy();
  });
});
