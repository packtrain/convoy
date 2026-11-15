/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ResponseAttachments } from "./index";

const queryMock = vi.fn();
const client = { query: (...args: unknown[]) => queryMock(...args) };
vi.mock("convex/react", () => ({ useConvex: () => client }));

const downloadFileMock = vi.fn();
vi.mock("@/lib/tasks/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/files")>()),
  downloadFile: (...args: unknown[]) => downloadFileMock(...args),
}));

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastErrorMock(...args) } }));

vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/blocks/tasks/attachment-lightbox", () => ({
  AttachmentLightbox: ({
    open,
    slides,
    initialIndex,
    textPreview,
  }: {
    open: boolean;
    slides: Array<{ fileName: string }>;
    initialIndex: number;
    textPreview?: { fileName: string } | null;
  }) =>
    textPreview ? (
      <div data-testid="text-preview">{textPreview.fileName}</div>
    ) : open ? (
      <div>
        <div data-testid="slide-count">{slides.length}</div>
        <div data-testid="selected-slide">{slides[initialIndex]?.fileName}</div>
      </div>
    ) : null,
}));

/** Intersection is driven by the test, so "resolve on entering the viewport" is observable. */
let intersect: (() => void) | null = null;
class IntersectionObserverStub {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe() {
    intersect = () => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
  }
  disconnect() {}
}

function file(storageId: string, fileName: string, contentType: string) {
  return { storageId, fileName, fileSize: 10, contentType, uploadedAt: 1 };
}
/** The inline html frame; `findByTitle` would also match a file card's title. */
function findFrame() {
  return waitFor(() => {
    const frame = document.querySelector("iframe");
    if (!frame) throw new Error("no frame yet");
    return frame;
  });
}
function urlsFor(attachments: Array<{ storageId: string; fileName: string }>, missing: string[] = []) {
  return attachments.map((attachment) => ({
    ...attachment,
    url: missing.includes(attachment.storageId) ? null : `https://files.test/${attachment.fileName}`,
  }));
}

describe("ResponseAttachments", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    intersect = null;
  });

  test("resolves an image reply's URLs once, on entering the viewport, and renders the image inline", async () => {
    const attachments = [file("s1", "shot.png", "image/png")];
    queryMock.mockResolvedValue(urlsFor(attachments));
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);

    expect(queryMock).not.toHaveBeenCalled();
    act(() => intersect?.());

    const image = await screen.findByRole("img", { name: "shot.png" });
    expect(image.getAttribute("src")).toBe("https://files.test/shot.png");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0]?.[1]).toEqual({ messageId: "msg_1" });
  });

  test("a single image with known dimensions holds its final box from the skeleton on", async () => {
    // 800x1600 caps at 320px high, so 160px wide.
    const attachments = [{ ...file("s1", "tall.png", "image/png"), dimensions: { width: 800, height: 1600 } }];
    queryMock.mockResolvedValue(urlsFor(attachments));
    const { container } = render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);

    const skeleton = container.querySelector<HTMLElement>('[data-attachment-name="tall.png"]');
    expect(skeleton?.style.width).toBe("160px");
    expect(skeleton?.style.aspectRatio).toBe("800 / 1600");
    act(() => intersect?.());
    const image = await screen.findByRole("img", { name: "tall.png" });
    expect(image.style.width).toBe("160px");
    expect(image.style.aspectRatio).toBe("800 / 1600");
  });

  test("keeps order: adjacent images form a gallery, a file splits groups, and a thumbnail opens its own image", async () => {
    const attachments = [
      file("s1", "a.png", "image/png"),
      file("s2", "b.png", "image/png"),
      file("s3", "c.png", "image/png"),
      file("s4", "notes.txt", "text/plain"),
      file("s5", "d.png", "image/png"),
    ];
    queryMock.mockResolvedValue(urlsFor(attachments));
    const { container } = render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);
    act(() => intersect?.());
    await screen.findByRole("img", { name: "d.png" });

    const order = Array.from(container.querySelectorAll("[data-attachment-name]")).map((node) => node.getAttribute("data-attachment-name"));
    expect(order).toEqual(["a.png", "b.png", "c.png", "notes.txt", "d.png"]);
    expect(container.querySelectorAll("[data-response-gallery]")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open b.png" }));
    expect(screen.getByTestId("selected-slide").textContent).toBe("b.png");
    expect(screen.getByTestId("slide-count").textContent).toBe("4");
  });

  test("shows at most four thumbnails with a remaining-count label", async () => {
    const attachments = Array.from({ length: 6 }, (_, index) => file(`s${index}`, `${index}.png`, "image/png"));
    queryMock.mockResolvedValue(urlsFor(attachments));
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);
    act(() => intersect?.());

    await screen.findByRole("img", { name: "0.png" });
    expect(screen.getAllByRole("img")).toHaveLength(4);
    const overflow = screen.getByText("+2");
    expect(overflow).toBeDefined();
    // A block wrapper would put the thumbnail on a line box and stretch the whole row by its descender gap.
    expect(overflow.parentElement?.classList.contains("flex")).toBe(true);
  });

  test("a file-only reply resolves on click and downloads", async () => {
    const attachments = [file("s1", "report.pdf", "application/pdf")];
    queryMock.mockResolvedValue(urlsFor(attachments));
    downloadFileMock.mockResolvedValue(true);
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);
    act(() => intersect?.());
    expect(queryMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));

    await waitFor(() => expect(downloadFileMock).toHaveBeenCalledWith("https://files.test/report.pdf", "report.pdf"));
  });

  test("an inline html file reads on entering the viewport and renders in a sandboxed, themed frame (OS-2220)", async () => {
    const attachments = [{ ...file("s1", "chart.html", "text/html"), display: "inline" as const }];
    queryMock.mockResolvedValue(urlsFor(attachments));
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "<!doctype html><p>chart</p>" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);

    act(() => intersect?.());

    const frame = await findFrame();
    expect(fetchMock).toHaveBeenCalledWith("https://files.test/chart.html");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-popups allow-popups-to-escape-sandbox");
    const srcDoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcDoc.startsWith("<!doctype html><style>")).toBe(true);
    expect(srcDoc).toContain(`url("${window.location.origin}/fonts/inter-latin-v20.woff2")`);
    expect(srcDoc.endsWith("<p>chart</p>")).toBe(true);
    expect(screen.queryByRole("button", { name: "Download chart.html" })).toBeNull();
  });

  test("inline pages render above the attachments and stay in the card row with the other files (OS-2220)", async () => {
    const attachments = [
      { ...file("s1", "chart.html", "text/html"), display: "inline" as const },
      file("s2", "export.html", "text/html"),
    ];
    queryMock.mockResolvedValue(urlsFor(attachments));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "<p>chart</p>" })));
    const { container } = render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);
    act(() => intersect?.());

    const frame = await findFrame();
    const cards = screen.getAllByRole("button", { name: /\.html/ });
    expect(cards.map((card) => card.textContent)).toEqual([expect.stringContaining("chart.html"), expect.stringContaining("export.html")]);
    expect(cards[0]?.parentElement).toBe(cards[1]?.parentElement);
    expect(frame.compareDocumentPosition(cards[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  test("an inline frame takes clamped heights from its own window only (OS-2220)", async () => {
    const attachments = [{ ...file("s1", "chart.html", "text/html"), display: "inline" as const }];
    queryMock.mockResolvedValue(urlsFor(attachments));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "<p>chart</p>" })));
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);
    act(() => intersect?.());
    const frame = await findFrame();
    const post = (height: unknown, source: MessageEventSource | null) =>
      act(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "convoy:inline-html:height", height }, source })));

    post(612.4, frame.contentWindow);
    expect(frame.style.height).toBe("613px");
    post(90, window);
    expect(frame.style.height).toBe("613px");
    post(99_999, frame.contentWindow);
    expect(frame.style.height).toBe("4000px");
    post(2, frame.contentWindow);
    expect(frame.style.height).toBe("80px");
  });

  test("an html file without display inline stays a file card (OS-2220)", () => {
    render(<ResponseAttachments messageId="msg_1" attachments={[file("s1", "export.html", "text/html")]} />);
    act(() => intersect?.());

    expect(screen.getByRole("button", { name: /export\.html/ })).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  test("a markdown file opens the text preview instead of downloading", async () => {
    const attachments = [file("s1", "plan.md", "text/markdown")];
    queryMock.mockResolvedValue(urlsFor(attachments));
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);

    fireEvent.click(screen.getByRole("button", { name: /plan\.md/ }));

    expect((await screen.findByTestId("text-preview")).textContent).toBe("plan.md");
    expect(downloadFileMock).not.toHaveBeenCalled();
  });

  test("a file renders as a card with its name and size and no remove button", () => {
    render(<ResponseAttachments messageId="msg_1" attachments={[{ ...file("s1", "report.pdf", "application/pdf"), fileSize: 131072 }]} />);

    const card = screen.getByRole("button", { name: /report\.pdf/ });
    expect(card.textContent).toContain("128 KB");
    expect(card.className).toContain("cursor-pointer");
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  test("a failed URL read is not cached: the next click reads again and downloads", async () => {
    const attachments = [file("s1", "report.pdf", "application/pdf")];
    queryMock.mockRejectedValueOnce(new Error("temporary read failure"));
    queryMock.mockResolvedValueOnce(urlsFor(attachments));
    downloadFileMock.mockResolvedValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);

    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /report\.pdf/ }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    await waitFor(() => expect(downloadFileMock).toHaveBeenCalledWith("https://files.test/report.pdf", "report.pdf"));
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  test("a failed read for an image reply does not retry on its own; clicking the image retries", async () => {
    const attachments = [file("s1", "shot.png", "image/png")];
    queryMock.mockRejectedValueOnce(new Error("temporary read failure"));
    queryMock.mockResolvedValueOnce(urlsFor(attachments));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);
    act(() => intersect?.());
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    act(() => intersect?.());
    expect(queryMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /shot\.png/ }));
    await waitFor(() => expect(queryMock).toHaveBeenCalledTimes(2));
  });

  test("a download pending when another file is attached still completes", async () => {
    const first = [file("s1", "report.pdf", "application/pdf")];
    const second = [...first, file("s2", "log.zip", "application/zip")];
    let resolveFirst!: (value: unknown) => void;
    queryMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    queryMock.mockResolvedValueOnce(urlsFor(second));
    downloadFileMock.mockResolvedValue(true);
    const { rerender } = render(<ResponseAttachments messageId="msg_1" attachments={first} />);

    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));
    rerender(<ResponseAttachments messageId="msg_1" attachments={second} />);
    await act(async () => resolveFirst(urlsFor(first)));

    await waitFor(() => expect(downloadFileMock).toHaveBeenCalledWith("https://files.test/report.pdf", "report.pdf"));
  });

  test("hidden gallery images stay reachable when every visible thumbnail fails to load", async () => {
    const attachments = Array.from({ length: 5 }, (_, index) => file(`s${index}`, `${index}.png`, "image/png"));
    queryMock.mockResolvedValue(urlsFor(attachments));
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);
    act(() => intersect?.());
    await screen.findByRole("img", { name: "0.png" });

    for (const image of screen.getAllByRole("img")) fireEvent.error(image);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));

    expect(screen.getByTestId("selected-slide").textContent).toBe("4.png");
  });

  test("names a missing image instead of rendering a broken one", async () => {
    const attachments = [file("s1", "gone.png", "image/png")];
    queryMock.mockResolvedValue(urlsFor(attachments, ["s1"]));
    render(<ResponseAttachments messageId="msg_1" attachments={attachments} />);
    act(() => intersect?.());

    expect(await screen.findByText("gone.png")).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("ignores a late result for an earlier attachment set and reads again for the new batch", async () => {
    const first = [file("s1", "one.png", "image/png")];
    const second = [...first, file("s2", "two.png", "image/png")];
    let resolveFirst!: (value: unknown) => void;
    queryMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    queryMock.mockResolvedValueOnce(urlsFor(second).map((row) => ({ ...row, url: `${row.url}?v2` })));

    const { rerender } = render(<ResponseAttachments messageId="msg_1" attachments={first} />);
    act(() => intersect?.());
    rerender(<ResponseAttachments messageId="msg_1" attachments={second} />);
    act(() => intersect?.());
    await act(async () => resolveFirst(urlsFor(first)));

    const image = await screen.findByRole("img", { name: "one.png" });
    expect(image.getAttribute("src")).toBe("https://files.test/one.png?v2");
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
