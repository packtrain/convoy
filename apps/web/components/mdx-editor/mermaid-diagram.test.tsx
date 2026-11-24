/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { MermaidDiagram, sizeSvgForExport } from "./mermaid-diagram";

const { renderDiagram, downloadFile } = vi.hoisted(() => ({
  renderDiagram: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@streamdown/mermaid", () => ({
  mermaid: { getMermaid: () => ({ render: renderDiagram }) },
}));
vi.mock("@/lib/tasks/files", () => ({ downloadFile }));

const SVG = '<svg data-testid="diagram" viewBox="0 0 120 40" style="max-width: 120px;"></svg>';

const renderViewer = async (onEdit = vi.fn()) => {
  render(<MermaidDiagram code="graph TD; A-->B" onEdit={onEdit} />);
  await screen.findByTestId("diagram");
  return onEdit;
};

const canvasTransform = () =>
  (screen.getByTestId("diagram").parentElement as HTMLElement).style.transform;

// Radix tooltips measure their trigger; jsdom has no ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

beforeEach(() => {
  renderDiagram.mockReset().mockResolvedValue({ svg: SVG });
  downloadFile.mockReset();
});

describe("MermaidDiagram viewer", () => {
  test("zoom buttons scale the diagram and reset restores it", async () => {
    await renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(canvasTransform()).toContain("scale(1.25)");

    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(canvasTransform()).toContain("scale(1)");
  });

  test("ctrl+wheel zooms inline; a plain wheel leaves page scrolling alone", async () => {
    await renderViewer();
    const viewport = screen.getByTestId("diagram").parentElement!.parentElement!;

    fireEvent.wheel(viewport, { deltaY: -100 });
    expect(canvasTransform()).toContain("scale(1)");

    fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true });
    expect(canvasTransform()).toContain("scale(1.25)");
  });

  test("fullscreen opens the diagram in a dialog", async () => {
    await renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "Open fullscreen" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("diagram")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Zoom in" })).toBeTruthy();
  });

  test("uses the app's compact icon buttons, named by tooltip rather than title", async () => {
    await renderViewer();

    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    expect(zoomIn.className).toContain("size-7");
    expect(zoomIn.hasAttribute("title")).toBe(false);
  });

  const openDownloadPopover = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    return within(await screen.findByRole("dialog"));
  };
  const downloadedSvg = () => decodeURIComponent((downloadFile.mock.calls[0] as [string])[0]);

  test("the download popover defaults to an opaque light PNG", async () => {
    await renderViewer();
    const popover = await openDownloadPopover();

    expect(popover.getByRole("button", { name: "PNG" }).getAttribute("aria-pressed")).toBe("true");
    expect(popover.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("true");
    expect(popover.getByRole("switch", { name: "Transparent background" }).getAttribute("aria-checked")).toBe(
      "false"
    );
  });

  test("exports in the chosen theme, whatever the page theme", async () => {
    await renderViewer();
    const popover = await openDownloadPopover();

    fireEvent.click(popover.getByRole("button", { name: "SVG" }));
    fireEvent.click(popover.getByRole("button", { name: "Dark" }));
    fireEvent.click(popover.getByRole("button", { name: "Download" }));

    await vi.waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/svg\+xml/), "diagram-dark.svg")
    );
    expect(renderDiagram).toHaveBeenLastCalledWith(
      expect.any(String),
      'graph TD; A-->B\n%%{init: {"theme": "dark"}}%%'
    );
    expect(downloadedSvg()).toContain('viewBox="0 0 120 40"');
    expect(downloadedSvg()).toContain("background-color: rgb(19, 19, 19)");
  });

  test("the transparency toggle drops the export background", async () => {
    await renderViewer();
    const popover = await openDownloadPopover();

    fireEvent.click(popover.getByRole("button", { name: "SVG" }));
    fireEvent.click(popover.getByRole("switch", { name: "Transparent background" }));
    fireEvent.click(popover.getByRole("button", { name: "Download" }));

    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalledWith(expect.any(String), "diagram-light.svg"));
    expect(renderDiagram).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.stringContaining('%%{init: {"theme": "neutral"}}%%')
    );
    expect(downloadedSvg()).not.toContain("background-color");
  });

  test("the edit button hands off to the source editor", async () => {
    const onEdit = await renderViewer();

    fireEvent.click(screen.getByRole("button", { name: "Edit diagram source" }));

    expect(onEdit).toHaveBeenCalled();
  });
});

describe("sizeSvgForExport", () => {
  test("gives the SVG explicit pixel dimensions from its viewBox", () => {
    const sized = sizeSvgForExport(
      '<svg viewBox="0 0 621.5 127" width="100%"><foreignObject><div>one<br>two</div></foreignObject></svg>'
    );

    expect(sized.width).toBe(621.5);
    expect(sized.height).toBe(127);
    expect(sized.markup).toContain('width="621.5"');
    expect(sized.markup).toContain('height="127"');
    // HTML-serialized void tags become well-formed XML, or the <img> load fails.
    expect(sized.markup).toMatch(/<br ?\/>/);
  });
});
