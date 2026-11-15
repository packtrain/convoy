/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"
import { mockScrollable } from "@/test-utils/scroll"
import { DateTimePicker } from "./datetime-picker"

vi.mock("./datetime-picker-popover", () => ({
  DateTimePickerPopover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("DateTimePicker", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test("renders an icon-only trigger when icon-or-date is unset", () => {
    render(
      <DateTimePicker
        dateTime={undefined}
        setDateTime={vi.fn()}
        variant="icon-or-date"
        mode="date"
      />
    )

    expect(screen.getByRole("button", { name: "Set date" })).toBeTruthy()
    expect(screen.queryByText("25 Jan")).toBeNull()
  })

  test("renders a compact date label when icon-or-date has a value", () => {
    render(
      <DateTimePicker
        dateTime={new Date("2026-01-25T12:00:00Z")}
        setDateTime={vi.fn()}
        variant="icon-or-date"
        mode="date"
        locale="en-GB"
      />
    )

    expect(screen.getByText("25 Jan")).toBeTruthy()
    expect(screen.getByRole("button", { name: "25 Jan" })).toBeTruthy()
  })

  test("renders compact dates as read-only labels", () => {
    render(
      <DateTimePicker
        dateTime={new Date("2026-01-25T12:00:00Z")}
        setDateTime={vi.fn()}
        variant="compact"
        isEditable={false}
        mode="date"
        locale="en-GB"
      />
    )

    expect(screen.getByText("25 Jan")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  test("highlights overdue compact read-only labels", () => {
    render(
      <DateTimePicker
        dateTime={new Date("2026-01-09T12:00:00Z")}
        setDateTime={vi.fn()}
        variant="compact"
        isEditable={false}
        mode="date"
        locale="en-GB"
      />
    )

    expect(screen.getByText("9 Jan").className).toContain("text-amber-900")
  })

  test("highlights overdue compact value triggers", () => {
    render(
      <DateTimePicker
        dateTime={new Date("2026-01-09T12:00:00Z")}
        setDateTime={vi.fn()}
        variant="compact"
        mode="date"
        locale="en-GB"
      />
    )

    expect(screen.getByRole("button", { name: "9 Jan" }).className).toContain(
      "text-amber-900"
    )
  })

  test("highlights overdue ghost input values but not today's date", () => {
    const { rerender } = render(
      <DateTimePicker
        dateTime={new Date("2026-01-09T12:00:00Z")}
        setDateTime={vi.fn()}
        variant="ghost"
        iconPosition="left"
        mode="date"
        locale="en-GB"
      />
    )

    const input = screen.getByRole("textbox")

    expect(input.className).toContain("text-amber-900")
    expect(
      screen.getByRole("button", { name: "Open date time picker" }).className
    ).toContain("text-amber-600")

    rerender(
      <DateTimePicker
        dateTime={new Date("2026-01-10T12:00:00Z")}
        setDateTime={vi.fn()}
        variant="ghost"
        iconPosition="left"
        mode="date"
        locale="en-GB"
      />
    )

    expect(input.className).not.toContain("text-amber-900")
    expect(
      screen.getByRole("button", { name: "Open date time picker" }).className
    ).not.toContain("text-amber-600")
  })

  test("open text suggestions close and stop submitting once disabled", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 24))
    const setDateTime = vi.fn()
    const picker = (disabled: boolean) => (
      <DateTimePicker dateTime={undefined} setDateTime={setDateTime} variant="ghost" mode="date" disabled={disabled} />
    )
    const view = render(picker(false))

    fireEvent.focus(screen.getByRole("textbox"))
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0)
    view.rerender(picker(true))
    const option = screen.queryAllByRole("option")[0]
    if (option) fireEvent.click(option)

    expect(setDateTime).not.toHaveBeenCalled()
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  // OS-2198: the suggestions portal outside the task drawer, whose scroll lock swallowed their scroll.
  test("text suggestions inside a drawer stay scrollable", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 24))
    render(
      <Drawer open direction="right">
        <DrawerContent>
          <DrawerTitle>Task</DrawerTitle>
          <DrawerDescription>Details</DrawerDescription>
          <DateTimePicker dateTime={undefined} setDateTime={vi.fn()} variant="ghost" mode="date" />
        </DrawerContent>
      </Drawer>
    )

    fireEvent.focus(screen.getByRole("textbox"))
    const list = mockScrollable(screen.getByRole("listbox"))
    expect(fireEvent.wheel(list, { deltaY: 50 })).toBe(true)
  })

  test("keeps ghost left-icon inputs from reserving excess right padding", () => {
    const { rerender } = render(
      <DateTimePicker
        dateTime={new Date("2026-01-25T12:00:00Z")}
        setDateTime={vi.fn()}
        variant="ghost"
        iconPosition="left"
        mode="date"
        locale="en-GB"
      />
    )

    const input = screen.getByRole("textbox")

    expect(input.className).toContain("pl-7")
    expect(input.className).toContain("pr-1.5")
    expect(input.className).not.toContain("pr-9")

    rerender(
      <DateTimePicker
        dateTime={undefined}
        setDateTime={vi.fn()}
        variant="ghost"
        iconPosition="left"
        mode="date"
        locale="en-GB"
      />
    )

    expect((input as HTMLInputElement).value).toBe("")
  })
})
