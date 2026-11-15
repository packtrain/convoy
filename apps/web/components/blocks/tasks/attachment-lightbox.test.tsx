/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { AttachmentLightbox } from "./attachment-lightbox";

const lightboxSpy = vi.fn();
const { zoomPlugin, videoPlugin, downloadPlugin } = vi.hoisted(() => ({
  zoomPlugin: { name: "zoom-plugin" },
  videoPlugin: { name: "video-plugin" },
  downloadPlugin: { name: "download-plugin" },
}));

vi.mock("yet-another-react-lightbox", () => ({
  isImageSlide: (slide: unknown): slide is { src: string; alt?: string } =>
    typeof slide === "object" &&
    slide !== null &&
    "src" in slide &&
    typeof slide.src === "string",
  default: (props: {
    slides: Array<{ src?: string }>;
    render?: {
      slideHeader?: (props: { slide: { src?: string } }) => ReactNode;
    };
  }) => {
    lightboxSpy(props);
    const slide = props.slides[0];

    return (
      <div data-testid="yarl-lightbox">
        {slide ? props.render?.slideHeader?.({ slide }) : null}
      </div>
    );
  },
}));

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("yet-another-react-lightbox/plugins/zoom", () => ({
  default: zoomPlugin,
}));

vi.mock("yet-another-react-lightbox/plugins/video", () => ({
  default: videoPlugin,
}));

vi.mock("yet-another-react-lightbox/plugins/download", () => ({
  default: downloadPlugin,
}));

describe("AttachmentLightbox", () => {
  afterEach(() => {
    cleanup();
  });

  test("passes slides, faster finite carousel, opaque backdrop, and zoom/video/download plugins to the lightbox", () => {
    render(
      <AttachmentLightbox
        open
        initialIndex={0}
        slides={[
          {
            src: "https://example.com/image.png",
            fileName: "image.png",
            alt: "image.png",
            download: {
              url: "https://example.com/image.png",
              filename: "image.png",
            },
          },
        ]}
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />
    );

    expect(screen.getByTestId("yarl-lightbox")).toBeDefined();
    expect(lightboxSpy).toHaveBeenCalled();
    const props = lightboxSpy.mock.calls.at(-1)?.[0] as {
      plugins: unknown[];
      slides: Array<{ src: string }>;
      carousel: { finite: boolean; imageFit: string };
      animation: { swipe: number; navigation: number };
      toolbar: { buttons: string[] };
      styles: { container: { backgroundColor: string } };
      video: { controls: boolean; autoPlay: boolean; playsInline: boolean };
      render: {
        iconClose?: () => ReactNode;
        iconDownload?: () => ReactNode;
        iconZoomIn?: () => ReactNode;
        iconZoomOut?: () => ReactNode;
      };
    };
    expect(props.plugins).toContain(zoomPlugin);
    expect(props.plugins).toContain(videoPlugin);
    expect(props.plugins).toContain(downloadPlugin);
    expect(props.slides).toEqual([
      expect.objectContaining({ src: "https://example.com/image.png" }),
    ]);
    expect(props.carousel).toEqual(
      expect.objectContaining({ finite: true, imageFit: "contain" })
    );
    expect(props.animation).toEqual(
      expect.objectContaining({ swipe: 220, navigation: 180 })
    );
    expect(props.toolbar.buttons).toEqual(["download", "close"]);
    expect(props.styles.container.backgroundColor).toBe("#000");
    expect(props.video).toEqual(
      expect.objectContaining({
        controls: true,
        autoPlay: true,
        playsInline: true,
      })
    );
    expect(props.render.iconClose).toBeTypeOf("function");
    expect(props.render.iconDownload).toBeTypeOf("function");
    expect(props.render.iconZoomIn).toBeTypeOf("function");
    expect(props.render.iconZoomOut).toBeTypeOf("function");
  });

  test("renders the file name header and wires download / close actions", () => {
    const onClose = vi.fn();
    const onDownload = vi.fn();

    render(
      <AttachmentLightbox
        open
        initialIndex={0}
        slides={[
          {
            src: "https://example.com/image.png",
            fileName: "image.png",
            alt: "image.png",
            download: {
              url: "https://example.com/image.png",
              filename: "image.png",
            },
          },
        ]}
        onClose={onClose}
        onDownload={onDownload}
      />
    );

    expect(screen.getByText("image.png")).toBeDefined();

    const props = lightboxSpy.mock.calls.at(-1)?.[0] as {
      close: () => void;
      download: {
        download: (args: { slide: { src: string; alt: string } }) => void;
      };
    };

    props.download.download({
      slide: {
        src: "https://example.com/image.png",
        alt: "image.png",
      },
    });
    expect(onDownload).toHaveBeenCalledWith(0);

    props.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("shows the slide position and total before the file name", () => {
    const slide = (name: string) => ({
      src: `https://example.com/${name}`,
      fileName: name,
      alt: name,
      download: { url: `https://example.com/${name}`, filename: name },
    });
    render(
      <AttachmentLightbox
        open
        initialIndex={0}
        slides={[slide("a.png"), slide("b.png"), slide("c.png")]}
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />
    );

    expect(screen.getByText("1/3")).toBeDefined();
    expect(screen.getByText("a.png")).toBeDefined();
    // The slide reserves a top band, so the header pill never covers the picture.
    const props = lightboxSpy.mock.calls.at(-1)?.[0] as { styles: { slide?: { paddingTop?: number } } };
    expect(props.styles.slide?.paddingTop).toBeGreaterThan(48);
  });

  test("renders the file name header for video slides and maps video download to the right index", () => {
    const onDownload = vi.fn();
    const videoSlide = {
      type: "video" as const,
      sources: [
        { src: "https://example.com/clip.mp4", type: "video/mp4" },
      ],
      fileName: "clip.mp4",
      download: {
        url: "https://example.com/clip.mp4",
        filename: "clip.mp4",
      },
    };

    render(
      <AttachmentLightbox
        open
        initialIndex={0}
        slides={[
          videoSlide,
          {
            src: "https://example.com/image.png",
            fileName: "image.png",
            alt: "image.png",
            download: {
              url: "https://example.com/image.png",
              filename: "image.png",
            },
          },
        ]}
        onClose={vi.fn()}
        onDownload={onDownload}
      />
    );

    expect(screen.getByText("clip.mp4")).toBeDefined();

    const props = lightboxSpy.mock.calls.at(-1)?.[0] as {
      download: { download: (args: { slide: unknown }) => void };
    };

    props.download.download({ slide: videoSlide });
    expect(onDownload).toHaveBeenCalledWith(0);

    props.download.download({
      slide: { src: "https://example.com/image.png", alt: "image.png" },
    });
    expect(onDownload).toHaveBeenCalledWith(1);
  });
});

describe("AttachmentLightbox text preview", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderText = (contentType: string, onDownload = vi.fn(), onClose = vi.fn()) =>
    render(
      <AttachmentLightbox
        open={false}
        initialIndex={0}
        slides={[]}
        onClose={onClose}
        onDownload={vi.fn()}
        textPreview={{ fileName: "notes.txt", url: "https://example.com/notes.txt", contentType, onDownload }}
      />
    );

  test("shows a plain text file as preformatted text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("line one\nline two")));
    renderText("text/plain");

    expect(screen.getByRole("dialog", { name: "notes.txt" })).toBeDefined();
    const pre = await screen.findByText(/line one/);
    expect(pre.tagName).toBe("PRE");
    expect(fetch).toHaveBeenCalledWith("https://example.com/notes.txt");
  });

  test("renders markdown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("# Title")));
    renderText("text/markdown");

    expect((await screen.findByTestId("markdown")).textContent).toBe("# Title");
  });

  test("renders markdown by default and toggles to its source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("# Title")));
    renderText("text/markdown");

    expect((await screen.findByTestId("markdown")).textContent).toBe("# Title");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText("# Title").tagName).toBe("PRE");
    expect(screen.queryByTestId("markdown")).toBeNull();
  });

  test("footer has Close and Download", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x")));
    const onDownload = vi.fn();
    const onClose = vi.fn();
    renderText("text/plain", onDownload, onClose);

    const footer = screen.getByRole("button", { name: "Download" }).closest("[data-slot=dialog-footer]");
    expect(footer).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(onDownload).toHaveBeenCalledTimes(1);

    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closeButtons.find((button) => footer?.contains(button))!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("previews html by default and toggles to its source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><p>chart</p>")));
    renderText("text/html");

    const frame = await screen.findByTitle("notes.txt");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("<p>chart</p>");
    const footer = screen.getByRole("button", { name: "Download" }).closest("[data-slot=dialog-footer]");
    expect(footer?.contains(screen.getByRole("tab", { name: "Preview" }))).toBe(true);
    expect(screen.getByRole("tab", { name: "Preview" }).textContent).toBe("");
    expect(screen.getByRole("tab", { name: "Source" }).textContent).toBe("");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText("<!doctype html><p>chart</p>").tagName).toBe("PRE");
    expect(screen.queryByTitle("notes.txt")).toBeNull();
  });

  test("plain text has no preview toggle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x")));
    renderText("text/plain");

    await screen.findByText("x");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  test("says so when the file can't be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gone", { status: 404 })));
    renderText("text/plain");

    expect(await screen.findByText("Couldn't load the preview. Download the file instead.")).toBeDefined();
  });
});
