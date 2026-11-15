/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import * as React from "react"
import { Editor, type JSONContent } from "@tiptap/core"
import { StarterKit } from "@tiptap/starter-kit"
import { HeadingDropdownMenu } from "./heading-dropdown-menu"

vi.mock("@/components/tiptap-ui-primitive/button", () => ({
  Button: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      showTooltip?: boolean
      tooltip?: React.ReactNode
    }
  >(function MockButton({ children, showTooltip, tooltip, ...props }, ref) {
    void showTooltip
    void tooltip

    return (
      <button ref={ref} type="button" {...props}>
        {children}
      </button>
    )
  }),
  ButtonGroup: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}))

vi.mock("@/components/tiptap-ui-primitive/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/tiptap-ui-primitive/dropdown-menu", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react")
  const DropdownMenuContext = ReactModule.createContext(false)

  return {
    DropdownMenu({
      open,
      children,
    }: {
      open?: boolean
      onOpenChange?: (open: boolean) => void
      children: React.ReactNode
    }) {
      return (
        <DropdownMenuContext.Provider value={Boolean(open)}>
          {children}
        </DropdownMenuContext.Provider>
      )
    },
    DropdownMenuTrigger({ children }: { asChild?: boolean; children: React.ReactNode }) {
      return <>{children}</>
    },
    DropdownMenuContent({ children }: { children: React.ReactNode; portal?: boolean }) {
      const open = ReactModule.useContext(DropdownMenuContext)
      return open ? <div>{children}</div> : null
    },
    DropdownMenuItem({ children }: { children: React.ReactNode; asChild?: boolean }) {
      return <>{children}</>
    },
  }
})

const editors: Editor[] = []

function createEditor(content: JSONContent) {
  const editor = new Editor({
    extensions: [StarterKit],
    content,
  })

  editors.push(editor)

  act(() => {
    editor.commands.setTextSelection(2)
  })

  return editor
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Format text as heading" }))
}

afterEach(() => {
  cleanup()
  while (editors.length > 0) {
    editors.pop()?.destroy()
  }
})

describe("HeadingDropdownMenu", () => {
  test("renders Normal text before Heading 1", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
      ],
    })

    render(<HeadingDropdownMenu editor={editor} levels={[1, 2, 3, 4]} />)
    openMenu()

    const normalText = screen.getByRole("button", { name: "Normal text" })
    const headingOne = screen.getByRole("button", { name: "Heading 1" })

    expect(
      normalText.compareDocumentPosition(headingOne) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  test("converts an active heading to paragraph when Normal text is selected", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
      ],
    })

    render(<HeadingDropdownMenu editor={editor} levels={[1, 2, 3, 4]} />)
    openMenu()

    fireEvent.click(screen.getByRole("button", { name: "Normal text" }))

    expect(editor.getJSON().content?.[0]?.type).toBe("paragraph")
  })

  test("still converts the active heading back to paragraph when the same heading is selected", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
      ],
    })

    render(<HeadingDropdownMenu editor={editor} levels={[1, 2, 3, 4]} />)
    openMenu()

    fireEvent.click(screen.getByRole("button", { name: "Heading 1" }))

    expect(editor.getJSON().content?.[0]?.type).toBe("paragraph")
  })
})
