/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { DateTimePickerPopover } from "./datetime-picker-popover"

function stubViewport(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

function renderPicker(
  setDateTime: () => void,
  disabled: boolean,
  dateTime: Date | null = new Date(2026, 9, 14),
) {
  return (
    <DateTimePickerPopover
      onOpen={vi.fn()}
      dateTime={dateTime ?? undefined}
      setDateTime={setDateTime}
      setInputValue={vi.fn()}
      mode="date"
      disabled={disabled}
    >
      <button type="button">Open date picker</button>
    </DateTimePickerPopover>
  )
}

describe("DateTimePickerPopover", () => {
  // Pin today so month assertions don't depend on the real clock.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 9, 14))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test("picks a day while enabled", () => {
    stubViewport(true)
    const setDateTime = vi.fn()
    render(renderPicker(setDateTime, false))

    fireEvent.click(screen.getByRole("button", { name: "Open date picker" }))
    fireEvent.click(screen.getByRole("button", { name: /October 20th/ }))

    expect(setDateTime).toHaveBeenCalledTimes(1)
  })

  test.each([
    ["desktop popover", true],
    ["mobile drawer", false],
  ])("the %s opens on the selected date's month", (_, desktop) => {
    stubViewport(desktop)
    vi.setSystemTime(new Date(2026, 10, 4))
    render(renderPicker(vi.fn(), false))

    fireEvent.click(screen.getByRole("button", { name: "Open date picker" }))

    expect(screen.getByRole("grid").getAttribute("aria-label")).toBe("October 2026")
  })

  test("opens on the current month without a selected date", () => {
    stubViewport(true)
    vi.setSystemTime(new Date(2026, 10, 4))
    render(renderPicker(vi.fn(), false, null))

    fireEvent.click(screen.getByRole("button", { name: "Open date picker" }))

    expect(screen.getByRole("grid").getAttribute("aria-label")).toBe("November 2026")
  })

  test.each([
    ["desktop popover", true],
    ["mobile drawer", false],
  ])("an open %s closes and stops submitting once disabled", (_, desktop) => {
    stubViewport(desktop)
    const setDateTime = vi.fn()
    const view = render(renderPicker(setDateTime, false))

    fireEvent.click(screen.getByRole("button", { name: "Open date picker" }))
    expect(screen.getByRole("grid")).toBeTruthy()
    view.rerender(renderPicker(setDateTime, true))
    const day = screen.queryByRole("button", { name: /October 20th/ })
    if (day) fireEvent.click(day)

    expect(setDateTime).not.toHaveBeenCalled()
    // The drawer stays mounted while it animates closed, so check its state.
    const grid = screen.queryByRole("grid", { hidden: true })
    expect(grid === null || grid.closest("[data-state]")?.getAttribute("data-state") === "closed").toBe(true)
  })
})
