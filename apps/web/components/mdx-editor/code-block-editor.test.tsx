/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";

import { createCodeBlockEditorDescriptor } from "./code-block-editor";

vi.mock("@mdxeditor/editor", () => ({
  CodeMirrorEditor: vi.fn(() => null),
  editorInFocus$: {},
  useCellValue: vi.fn(),
  useCodeBlockEditorContext: vi.fn(),
}));

describe("createCodeBlockEditorDescriptor", () => {
  test("accepts known aliases and unlabeled fences without metadata", () => {
    const descriptor = createCodeBlockEditorDescriptor();

    expect(descriptor.match("typescript", undefined)).toBe(true);
    expect(descriptor.match("bash", undefined)).toBe(true);
    expect(descriptor.match(undefined, undefined)).toBe(true);
  });

  test("accepts unknown no-meta languages as editable plain text fallback", () => {
    const descriptor = createCodeBlockEditorDescriptor();

    expect(descriptor.match("mermaid", undefined)).toBe(true);
  });

  test("leaves metadata-specific fences for other descriptors", () => {
    const descriptor = createCodeBlockEditorDescriptor();

    expect(descriptor.match("typescript", "live")).toBe(false);
  });
});
