/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Toolbar } from "./toolbar"

describe("Toolbar", () => {
  afterEach(() => {
    cleanup()
  })

  test("does not hijack arrow-key navigation from focused inputs", () => {
    render(
      <Toolbar>
        <button type="button">Bold</button>
        <input aria-label="Link URL" defaultValue="https://example.com" />
        <button type="button">Alignment</button>
      </Toolbar>
    )

    const input = screen.getByRole("textbox", { name: "Link URL" })

    input.focus()
    fireEvent.keyDown(input, { key: "ArrowRight" })

    expect(document.activeElement).toBe(input)
  })
})
