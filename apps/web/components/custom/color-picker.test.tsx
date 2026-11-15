/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ColorPicker } from "./color-picker";

describe("ColorPicker", () => {
  test("renders the empty color option in its own leading column", async () => {
    render(
      <ColorPicker
        value={null}
        onChange={vi.fn()}
        allowEmpty
        palette="extended"
        columns={8}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Select color" }));

    const emptyOption = await screen.findByRole("button", {
      name: "No color",
    });
    const pickerLayout = emptyOption.parentElement;
    const paletteGrid = emptyOption.nextElementSibling;

    expect(pickerLayout?.children).toHaveLength(2);
    expect(paletteGrid).toBeInstanceOf(HTMLDivElement);
    expect((paletteGrid as HTMLElement).style.gridTemplateColumns).toBe(
      "repeat(8, minmax(0, 1fr))"
    );
    expect(within(paletteGrid as HTMLElement).queryByRole("button", {
      name: "No color",
    })).toBeNull();
    expect(within(paletteGrid as HTMLElement).getAllByRole("button")).toHaveLength(
      24
    );
  });
});
