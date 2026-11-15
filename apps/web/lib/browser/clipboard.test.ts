import { describe, expect, test } from "vitest";
import { getClipboardFiles, getClipboardImageFiles } from "./clipboard";

function createClipboardDataWithItems(files: File[]) {
  return {
    items: files.map((file) => ({
      kind: "file",
      getAsFile: () => file,
    })),
    files: [],
  } as unknown as DataTransfer;
}

function createClipboardDataWithFileList(files: File[]) {
  return {
    items: [],
    files,
  } as unknown as DataTransfer;
}

describe("clipboard", () => {
  test("returns files from clipboard items first", () => {
    const image = new File(["image-data"], "image.png", { type: "image/png" });
    const textFile = new File(["text"], "notes.txt", { type: "text/plain" });
    const dataTransfer = createClipboardDataWithItems([image, textFile]);

    const result = getClipboardFiles(dataTransfer);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(image);
    expect(result[1]).toBe(textFile);
  });

  test("falls back to clipboard file list when items are unavailable", () => {
    const image = new File(["image-data"], "fallback.png", { type: "image/png" });
    const dataTransfer = createClipboardDataWithFileList([image]);

    const result = getClipboardFiles(dataTransfer);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(image);
  });

  test("returns only image files", () => {
    const image = new File(["image-data"], "image.png", { type: "image/png" });
    const textFile = new File(["text"], "notes.txt", { type: "text/plain" });
    const dataTransfer = createClipboardDataWithItems([image, textFile]);

    const result = getClipboardImageFiles(dataTransfer);

    expect(result).toEqual([image]);
  });

  test("returns empty for missing clipboard data", () => {
    expect(getClipboardFiles(undefined)).toEqual([]);
    expect(getClipboardImageFiles(null)).toEqual([]);
  });
});
