/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

import { Calendar } from "./calendar"

describe("Calendar", () => {
  afterEach(() => {
    cleanup()
  })

  test("keeps a selected single day visibly selected while hovered", () => {
    const { container } = render(
      <Calendar
        mode="single"
        month={new Date("2026-01-01T12:00:00Z")}
        selected={new Date("2026-01-15T12:00:00Z")}
        onSelect={vi.fn()}
      />
    )

    const selectedDay = container.querySelector(
      "[data-selected-single='true']"
    )

    expect(selectedDay?.className).toContain(
      "data-[selected-single=true]:hover:bg-primary"
    )
    expect(selectedDay?.className).toContain(
      "data-[selected-single=true]:hover:text-primary-foreground"
    )
  })
})
