/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { useImageUpload } from "./use-image-upload";
import { setTestHotkeyPlatform } from "@/test-utils/hotkeys";

vi.mock("@/hooks/editor/use-tiptap-editor", () => ({
  useTiptapEditor: (providedEditor?: Editor | null) => ({
    editor: providedEditor ?? null,
  }),
}));

vi.mock("@/hooks/ui/use-is-breakpoint", () => ({
  useIsBreakpoint: () => false,
}));

vi.mock("@/lib/editor/tiptap-utils", () => ({
  isExtensionAvailable: () => true,
}));

function createEditor(target: HTMLDivElement): Editor {
  const chainApi = {
    focus: vi.fn(() => chainApi),
    insertContent: vi.fn(() => chainApi),
    run: vi.fn(() => true),
  };

  return {
    isEditable: true,
    view: { dom: target },
    can: () => ({
      insertContent: () => true,
    }),
    isActive: () => false,
    chain: () => chainApi,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor;
}

describe("useImageUpload hotkeys", () => {
  afterEach(() => {
    setTestHotkeyPlatform({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0",
    });
    cleanup();
  });

  test("rebinds the shortcut when the editor DOM target changes", () => {
    setTestHotkeyPlatform({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    const firstTarget = document.createElement("div");
    const secondTarget = document.createElement("div");
    document.body.append(firstTarget, secondTarget);

    const onInserted = vi.fn();
    const firstEditor = createEditor(firstTarget);
    const secondEditor = createEditor(secondTarget);

    const { rerender } = renderHook(
      ({ editor }) => useImageUpload({ editor, onInserted }),
      { initialProps: { editor: firstEditor } }
    );

    fireEvent.keyDown(firstTarget, {
      key: "I",
      code: "KeyI",
      metaKey: true,
      shiftKey: true,
    });

    expect(onInserted).toHaveBeenCalledTimes(1);

    onInserted.mockClear();
    rerender({ editor: secondEditor });

    fireEvent.keyDown(secondTarget, {
      key: "I",
      code: "KeyI",
      metaKey: true,
      shiftKey: true,
    });

    expect(onInserted).toHaveBeenCalledTimes(1);
  });
});
