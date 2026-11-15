/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SidebarInset, SidebarProvider } from "./sidebar";
import { setTestHotkeyPlatform } from "@/test-utils/hotkeys";

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: () => false,
}));

describe("SidebarProvider hotkeys", () => {
  afterEach(() => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0",
    });
    cleanup();
  });

  test("nested providers do not both react to Ctrl+B", () => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });

    const outerOnOpenChange = vi.fn();
    const innerOnOpenChange = vi.fn();

    render(
      <SidebarProvider open={true} onOpenChange={outerOnOpenChange}>
        <div>outer</div>
        <SidebarProvider open={true} onOpenChange={innerOnOpenChange}>
          <div>inner</div>
        </SidebarProvider>
      </SidebarProvider>
    );

    fireEvent.keyDown(document, {
      key: "b",
      code: "KeyB",
      ctrlKey: true,
    });

    expect(outerOnOpenChange).toHaveBeenCalledWith(false);
    expect(innerOnOpenChange).not.toHaveBeenCalled();
  });

  test("does not react to Ctrl+B from a contenteditable target", () => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });

    const onOpenChange = vi.fn();

    const { getByTestId } = render(
      <SidebarProvider open={true} onOpenChange={onOpenChange}>
        <div
          data-testid="editor"
          contentEditable={true}
          suppressContentEditableWarning={true}
        />
      </SidebarProvider>
    );

    const editor = getByTestId("editor");
    fireEvent.keyDown(editor, {
      key: "b",
      code: "KeyB",
      ctrlKey: true,
    });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("does not react to Ctrl+B from an input target", () => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });

    const onOpenChange = vi.fn();

    const { getByLabelText } = render(
      <SidebarProvider open={true} onOpenChange={onOpenChange}>
        <input aria-label="Task title" />
      </SidebarProvider>
    );

    const input = getByLabelText("Task title");
    fireEvent.keyDown(input, {
      key: "b",
      code: "KeyB",
      ctrlKey: true,
    });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("sidebar inset can shrink to the available content width", () => {
    const { getByRole } = render(<SidebarInset>content</SidebarInset>);

    expect(getByRole("main").className).toContain("min-w-0");
    expect(getByRole("main").className).toContain("overflow-hidden");
  });
});
