/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAttachmentPreview } from "./use-attachment-preview";
import { MAX_TEXT_PREVIEW_BYTES } from "@/lib/tasks/files";

const image = { fileName: "shot.png", fileSize: 10, contentType: "image/png", url: "https://example.com/shot.png" };
const markdown = { fileName: "notes.md", fileSize: 10, contentType: "text/markdown", url: "https://example.com/notes.md" };
const json = { fileName: "data.json", fileSize: 10, contentType: "application/json", url: "https://example.com/data.json" };
const pdf = { fileName: "doc.pdf", fileSize: 10, contentType: "application/pdf", url: "https://example.com/doc.pdf" };

describe("useAttachmentPreview text files", () => {
  test("opens a text file in the text preview, not the lightbox", () => {
    const { result } = renderHook(() => useAttachmentPreview({ attachments: [image, markdown], onDownload: vi.fn() }));

    let opened = false;
    act(() => {
      opened = result.current.tryOpenPreview(markdown);
    });

    expect(opened).toBe(true);
    expect(result.current.lightboxProps.open).toBe(false);
    expect(result.current.lightboxProps.slides.map((slide) => slide.fileName)).toEqual(["shot.png"]);
    expect(result.current.lightboxProps.textPreview).toMatchObject({
      fileName: "notes.md",
      url: "https://example.com/notes.md",
      contentType: "text/markdown",
    });
  });

  test("previews JSON as text", () => {
    const { result } = renderHook(() => useAttachmentPreview({ attachments: [json], onDownload: vi.fn() }));
    act(() => {
      expect(result.current.tryOpenPreview(json)).toBe(true);
    });
    expect(result.current.lightboxProps.textPreview?.fileName).toBe("data.json");
  });

  test("downloads from the text preview", () => {
    const onDownload = vi.fn();
    const { result } = renderHook(() => useAttachmentPreview({ attachments: [markdown], onDownload }));
    act(() => {
      result.current.tryOpenPreview(markdown);
    });

    act(() => result.current.lightboxProps.textPreview?.onDownload());

    expect(onDownload).toHaveBeenCalledWith(markdown);
  });

  test("leaves oversized text files and binaries to the caller's download", () => {
    const large = { ...markdown, fileSize: MAX_TEXT_PREVIEW_BYTES + 1 };
    const { result } = renderHook(() => useAttachmentPreview({ attachments: [large, pdf], onDownload: vi.fn() }));

    act(() => {
      expect(result.current.tryOpenPreview(large)).toBe(false);
      expect(result.current.tryOpenPreview(pdf)).toBe(false);
    });
    expect(result.current.lightboxProps.textPreview).toBeNull();
  });

  test("an image still opens the lightbox with no text preview", () => {
    const { result } = renderHook(() => useAttachmentPreview({ attachments: [image, markdown], onDownload: vi.fn() }));
    act(() => {
      result.current.tryOpenPreview(image);
    });
    expect(result.current.lightboxProps.open).toBe(true);
    expect(result.current.lightboxProps.textPreview).toBeNull();
  });
});
