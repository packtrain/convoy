/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { downloadArtifact, type ArtifactContentType } from "./download-artifact";

const createObjectUrlMock = vi.fn((blob: Blob) => {
  void blob;
  return "blob:artifact";
});
const revokeObjectUrlMock = vi.fn();

describe("downloadArtifact", () => {
  beforeEach(() => {
    createObjectUrlMock.mockClear();
    revokeObjectUrlMock.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrlMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each<{
    contentType: ArtifactContentType;
    fileName: string;
    mimeType: string;
  }>([
    {
      contentType: "markdown",
      fileName: "plan.md",
      mimeType: "text/markdown;charset=utf-8",
    },
    {
      contentType: "html",
      fileName: "report.html",
      mimeType: "text/html;charset=utf-8",
    },
  ])("downloads $contentType source as $fileName", ({ contentType, fileName, mimeType }) => {
    const content = "Artifact source";
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe(fileName);
        expect(this.href).toBe("blob:artifact");
      });

    expect(downloadArtifact(content, fileName, contentType)).toBe(true);

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(createObjectUrlMock).toHaveBeenCalledOnce();
    const blob = createObjectUrlMock.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe(mimeType);
    expect(blob?.size).toBe(new TextEncoder().encode(content).byteLength);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:artifact");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  test("fails soft when the browser cannot create a download URL", () => {
    createObjectUrlMock.mockImplementationOnce(() => {
      throw new Error("Unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(downloadArtifact("content", "plan.md", "markdown")).toBe(false);
    expect(revokeObjectUrlMock).not.toHaveBeenCalled();
  });
});
