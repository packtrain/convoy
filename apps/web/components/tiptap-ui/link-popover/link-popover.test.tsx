/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react"
import * as React from "react"
import { LinkPopover } from "./link-popover"

const useLinkPopoverMock = vi.fn()

vi.mock("@/hooks/editor/use-tiptap-editor", () => ({
  useTiptapEditor: () => ({ editor: {} }),
}))

vi.mock("@/components/tiptap-ui/link-popover", () => ({
  useLinkPopover: (...args: unknown[]) => useLinkPopoverMock(...args),
}))

vi.mock("@/components/tiptap-ui-primitive/button", () => ({
  Button: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    function MockButton(props, ref) {
      return <button ref={ref} {...props} />
    }
  ),
  ButtonGroup: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}))

vi.mock("@/components/tiptap-ui-primitive/popover", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react")
  const PopoverContext = ReactModule.createContext(false)

  return {
    Popover({
      open,
      children,
    }: {
      open?: boolean
      onOpenChange?: (open: boolean) => void
      children: React.ReactNode
    }) {
      return (
        <PopoverContext.Provider value={Boolean(open)}>
          {children}
        </PopoverContext.Provider>
      )
    },
    PopoverTrigger({ children }: { asChild?: boolean; children: React.ReactNode }) {
      return <>{children}</>
    },
    PopoverContent({ children }: { children: React.ReactNode; portal?: boolean }) {
      const open = ReactModule.useContext(PopoverContext)
      return open ? <div>{children}</div> : null
    },
  }
})

describe("LinkPopover", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    useLinkPopoverMock.mockReturnValue({
      isVisible: true,
      canSet: true,
      isActive: false,
      url: "",
      setUrl: vi.fn(),
      setLink: vi.fn(),
      removeLink: vi.fn(),
      openLink: vi.fn(),
      label: "Link",
      Icon: () => <span>icon</span>,
    })
  })

  afterEach(() => {
    cleanup()
    useLinkPopoverMock.mockReset()
  })

  test("prevents pointerdown so the editor keeps focus while opening", () => {
    render(<LinkPopover />)

    const button = screen.getByRole("button", { name: "Link" })
    const event = createEvent.pointerDown(button)

    fireEvent(button, event)

    expect(event.defaultPrevented).toBe(true)
  })

  test("still opens the link popover on click", () => {
    render(<LinkPopover />)

    fireEvent.click(screen.getByRole("button", { name: "Link" }))

    expect(screen.getByPlaceholderText("Paste a link...")).toBeTruthy()
  })

  test("does not auto-open on initial render when a link is active", async () => {
    useLinkPopoverMock.mockReturnValue({
      isVisible: true,
      canSet: true,
      isActive: true,
      url: "https://example.com",
      setUrl: vi.fn(),
      setLink: vi.fn(),
      removeLink: vi.fn(),
      openLink: vi.fn(),
      label: "Link",
      Icon: () => <span>icon</span>,
    })

    render(<LinkPopover />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByPlaceholderText("Paste a link...")).toBeNull()
  })
})
