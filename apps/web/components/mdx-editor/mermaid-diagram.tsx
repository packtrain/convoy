"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Download, Maximize2, Pencil, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { TooltipExt } from "@/components/custom/tooltip-ext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/tasks/files";

const ZOOM_STEP = 1.25;
const RESET_VIEW = { scale: 1, x: 0, y: 0 };
// ponytail: fixed 2x raster; huge diagrams scale down to stay under browser canvas limits.
const PNG_SCALE = 2;
const MAX_CANVAS_SIDE = 16384;
const MERMAID_THEME = { light: "neutral", dark: "dark" } as const;
// Matches --background in app/globals.css.
const EXPORT_BACKGROUND = { light: "#ffffff", dark: "#131313" } as const;
let exportCount = 0;

type ExportTheme = keyof typeof MERMAID_THEME;
type ExportFormat = "png" | "svg";

/** Renders a mermaid fence; keeps the last good SVG while the source is mid-edit. */
export function MermaidDiagram({ code, onEdit }: { code: string; onEdit: () => void }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const renderCount = useRef(0);
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${reactId}-${++renderCount.current}`;

    void (async () => {
      try {
        // Lazy so documents without diagrams never download mermaid.
        const { mermaid } = await import("@streamdown/mermaid");
        const renderer = mermaid.getMermaid({
          theme: MERMAID_THEME[resolvedTheme === "light" ? "light" : "dark"],
        });
        const result = await renderer.render(id, code);
        if (cancelled) return;
        setSvg(result.svg);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, "Invalid diagram"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, reactId, resolvedTheme]);

  const editButton = (
    <ControlButton label="Edit diagram source" className="mdx-editor-kit__mermaid-edit" onClick={onEdit}>
      <Pencil />
    </ControlButton>
  );

  if (!svg) {
    return (
      <div className="mdx-editor-kit__mermaid mdx-editor-kit__mermaid-placeholder">
        <div className="mdx-editor-kit__mermaid-controls">{editButton}</div>
        {error ? (
          <span className="mdx-editor-kit__mermaid-error">
            <span>Diagram could not be rendered: {error}</span>
            <code className="mdx-editor-kit__mermaid-source">{code}</code>
          </span>
        ) : (
          <span className="mdx-editor-kit__mermaid-loading">Rendering diagram…</span>
        )}
      </div>
    );
  }

  const downloads = <DownloadPopover code={code} />;

  return (
    <div className="mdx-editor-kit__mermaid">
      <DiagramViewer
        svg={svg}
        controls={
          <>
            {editButton}
            {downloads}
            <ControlButton label="Open fullscreen" onClick={() => setFullscreen(true)}>
              <Maximize2 />
            </ControlButton>
          </>
        }
      />
      {error && <span className="mdx-editor-kit__mermaid-error">Diagram could not be rendered: {error}</span>}

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent
          className="mdx-editor-kit__mermaid-fullscreen flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-2rem)]"
          closeButtonClassName="z-10"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">Diagram</DialogTitle>
          <DiagramViewer svg={svg} controls={downloads} wheelZooms />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Pan by dragging, zoom with the buttons or ctrl/⌘+wheel (any wheel when `wheelZooms`). */
function DiagramViewer({
  svg,
  controls,
  wheelZooms = false,
}: {
  svg: string;
  controls: ReactNode;
  wheelZooms?: boolean;
}) {
  const [view, setView] = useState(RESET_VIEW);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const zoom = (factor: number) =>
    setView((current) => ({ ...current, scale: clampScale(current.scale * factor) }));

  // React's onWheel is passive, so preventDefault needs a native listener.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!wheelZooms && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setView((current) => ({ ...current, scale: clampScale(current.scale * factor) }));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [wheelZooms]);

  return (
    <div className="mdx-editor-kit__mermaid-viewer">
      <div className="mdx-editor-kit__mermaid-controls">
        {controls}
        <ControlButton label="Zoom out" onClick={() => zoom(1 / ZOOM_STEP)}>
          <ZoomOut />
        </ControlButton>
        <ControlButton label="Zoom in" onClick={() => zoom(ZOOM_STEP)}>
          <ZoomIn />
        </ControlButton>
        <ControlButton label="Reset view" onClick={() => setView(RESET_VIEW)}>
          <RotateCcw />
        </ControlButton>
      </div>
      <div
        ref={viewportRef}
        className="mdx-editor-kit__mermaid-viewport"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragRef.current = { x: event.clientX - view.x, y: event.clientY - view.y };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          setView((current) => ({ ...current, x: event.clientX - drag.x, y: event.clientY - drag.y }));
        }}
        onPointerUp={() => (dragRef.current = null)}
        onPointerCancel={() => (dragRef.current = null)}
      >
        <div
          className="mdx-editor-kit__mermaid-svg"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          // securityLevel "strict" (the @streamdown/mermaid default) sanitizes the SVG.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}

function DownloadPopover({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [theme, setTheme] = useState<ExportTheme>("light");
  const [transparent, setTransparent] = useState(false);
  const switchId = `${useId()}-transparent`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipExt content="Download">
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm">
            <Download />
          </Button>
        </PopoverTrigger>
      </TooltipExt>
      <PopoverContent align="end" className="w-60 gap-3" aria-label="Download diagram">
        <SegmentedField
          label="Format"
          value={format}
          options={[
            ["png", "PNG"],
            ["svg", "SVG"],
          ]}
          onChange={setFormat}
        />
        <SegmentedField
          label="Theme"
          value={theme}
          options={[
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
          onChange={setTheme}
        />
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={switchId} className="text-xs font-normal text-muted-foreground">
            Transparent background
          </Label>
          <Switch id={switchId} size="sm" checked={transparent} onCheckedChange={setTransparent} />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setOpen(false);
            exportDiagram(code, format, theme, transparent).catch((err: unknown) =>
              toast.error(`Diagram export failed: ${getErrorMessage(err, "unknown error")}`)
            );
          }}
        >
          Download
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SegmentedField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div role="group" aria-label={label} className="grid w-32 grid-cols-2 gap-0.5 rounded-lg border bg-card p-0.5">
        {options.map(([option, optionLabel]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1 text-xs text-muted-foreground",
              value === option && "bg-accent text-foreground"
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Re-renders in the export theme; a trailing init directive scopes it to this render, not mermaid's global config. */
async function exportDiagram(code: string, format: ExportFormat, theme: ExportTheme, transparent: boolean) {
  const { mermaid } = await import("@streamdown/mermaid");
  const { svg } = await mermaid
    .getMermaid()
    .render(`mermaid-export-${++exportCount}`, `${code}\n%%{init: {"theme": "${MERMAID_THEME[theme]}"}}%%`);
  const background = transparent ? undefined : EXPORT_BACKGROUND[theme];
  const url =
    format === "svg" ? svgDataUrl(sizeSvgForExport(svg, background).markup) : await svgToPngDataUrl(svg, background);
  await downloadFile(url, `diagram-${theme}.${format}`);
}

function ControlButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <TooltipExt content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={className}
        onClick={(event) => {
          event.preventDefault();
          onClick(event);
        }}
      >
        {children}
      </Button>
    </TooltipExt>
  );
}

/** Mermaid emits `width="100%"` and HTML-serialized markup; an `<img>` needs pixel size and XML. */
export function sizeSvgForExport(svg: string, background?: string) {
  const root = new DOMParser().parseFromString(svg, "text/html").querySelector("svg");
  if (!root) throw new Error("Rendered diagram has no <svg> root");
  const [, , width = 0, height = 0] = (root.getAttribute("viewBox") ?? "")
    .split(/[\s,]+/)
    .map(Number);
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  if (background) root.style.backgroundColor = background;
  return { markup: new XMLSerializer().serializeToString(root), width, height };
}

const svgDataUrl = (markup: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

async function svgToPngDataUrl(svg: string, background?: string) {
  const { markup, width, height } = sizeSvgForExport(svg);
  const scale = Math.min(PNG_SCALE, MAX_CANVAS_SIDE / Math.max(width, height, 1));
  const image = new Image();
  image.src = svgDataUrl(markup);
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function clampScale(scale: number) {
  return Math.min(8, Math.max(0.25, scale));
}
