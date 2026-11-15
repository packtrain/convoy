/**
 * @vitest-environment jsdom
 */
import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { handleSearchablePickerKeyDown } from "./searchable-picker-keyboard";

function SearchablePickerHarness() {
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const matchingItemRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      ref={pickerRef}
      onKeyDownCapture={(event) =>
        handleSearchablePickerKeyDown(event, pickerRef.current)
      }
      onKeyDown={(event) => {
        if (event.key.toLocaleLowerCase() === "a") {
          matchingItemRef.current?.focus();
        }
      }}
    >
      <input
        aria-label="Picker search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <button
        ref={matchingItemRef}
        type="button"
        data-searchable-picker-item=""
      >
        Ada
      </button>
      <button type="button" data-searchable-picker-item="">
        Grace
      </button>
    </div>
  );
}

afterEach(cleanup);

describe("handleSearchablePickerKeyDown", () => {
  test("keeps printable search input keys away from parent menu typeahead", () => {
    render(<SearchablePickerHarness />);

    const search = screen.getByRole("textbox", { name: "Picker search" });
    search.focus();

    fireEvent.keyDown(search, { key: "A" });
    fireEvent.change(search, { target: { value: "A" } });
    fireEvent.keyDown(search, { key: "d" });
    fireEvent.change(search, { target: { value: "Ad" } });

    expect(document.activeElement).toBe(search);
    expect((search as HTMLInputElement).value).toBe("Ad");
  });

  test("cycles focus through search input and items with arrow keys", () => {
    render(<SearchablePickerHarness />);

    const search = screen.getByRole("textbox", { name: "Picker search" });
    const ada = screen.getByRole("button", { name: "Ada" });
    const grace = screen.getByRole("button", { name: "Grace" });
    search.focus();

    // input → first item → last item
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(ada);
    fireEvent.keyDown(ada, { key: "ArrowDown" });
    expect(document.activeElement).toBe(grace);

    // last item → input (wrap includes the search input)
    fireEvent.keyDown(grace, { key: "ArrowDown" });
    expect(document.activeElement).toBe(search);

    // input → last item going up, and first item → input going up
    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(document.activeElement).toBe(grace);
    fireEvent.keyDown(grace, { key: "ArrowUp" });
    expect(document.activeElement).toBe(ada);
    fireEvent.keyDown(ada, { key: "ArrowUp" });
    expect(document.activeElement).toBe(search);
  });
});
