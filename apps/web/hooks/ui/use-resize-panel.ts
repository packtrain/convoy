import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

export interface ResizeBounds {
  min: number;
  max: number;
  default: number;
  storageKey: string;
}

interface ResizePointerArgs {
  clientX: number;
  containerRect: DOMRect;
  resizeOffset: number;
}

interface UseResizePanelOptions {
  bounds: ResizeBounds;
  /**
   * When true, dragging does not change `width` live: the candidate width is
   * exposed via `previewWidth` (for a drag guide) and committed + persisted on
   * mouse up ("drop to apply"). Keyboard steps (`adjustWidthBy`) still apply
   * immediately.
   */
  deferCommit?: boolean;
  getResizeOffset?: (args: {
    containerRect: DOMRect;
  }) => number;
  getWidthFromPointer?: (args: ResizePointerArgs) => number;
}

function getStoredWidth(bounds: ResizeBounds): number {
  const stored = readLocalString(bounds.storageKey);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed >= bounds.min && parsed <= bounds.max) {
      return parsed;
    }
  }
  return bounds.default;
}

function clampWidth(width: number, bounds: ResizeBounds): number {
  return Math.min(Math.max(width, bounds.min), bounds.max);
}

function persistWidth(width: number, storageKey: string) {
  writeLocalString(storageKey, String(width));
}

function getRightAnchoredWidth({
  clientX,
  containerRect,
  resizeOffset,
}: ResizePointerArgs): number {
  return containerRect.right - clientX - resizeOffset;
}

/** For a panel on the left edge of its container: it grows as the pointer moves right. */
export function getLeftAnchoredWidth({ clientX, containerRect, resizeOffset }: ResizePointerArgs): number {
  return clientX - containerRect.left - resizeOffset;
}

export function useResizePanel(
  containerRef: RefObject<HTMLDivElement | null>,
  options: UseResizePanelOptions
) {
  const { min, max, storageKey } = options.bounds;
  const [width, setWidth] = useState<number>(() => getStoredWidth(options.bounds));
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(width);
  const previewWidthRef = useRef<number | null>(null);
  const isResizingRef = useRef(false);
  const deferCommitRef = useRef(options.deferCommit ?? false);
  const getResizeOffsetRef = useRef<
    (args: { containerRect: DOMRect }) => number
  >(() => 0);
  const getWidthFromPointerRef = useRef<(args: ResizePointerArgs) => number>(
    getRightAnchoredWidth
  );

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    deferCommitRef.current = options.deferCommit ?? false;
  }, [options.deferCommit]);

  useEffect(() => {
    getResizeOffsetRef.current = options.getResizeOffset ?? (() => 0);
  }, [options.getResizeOffset]);

  useEffect(() => {
    getWidthFromPointerRef.current =
      options.getWidthFromPointer ?? getRightAnchoredWidth;
  }, [options.getWidthFromPointer]);

  const setClampedWidth = useCallback(
    (nextWidth: number, opts?: { persist?: boolean }) => {
      const clampedWidth = clampWidth(nextWidth, {
        min,
        max,
        default: widthRef.current,
        storageKey,
      });
      widthRef.current = clampedWidth;
      setWidth(clampedWidth);
      if (opts?.persist) {
        persistWidth(clampedWidth, storageKey);
      }
    },
    [max, min, storageKey]
  );

  const adjustWidthBy = useCallback(
    (delta: number, opts?: { persist?: boolean }) => {
      setClampedWidth(widthRef.current + delta, opts);
    },
    [setClampedWidth]
  );

  const handleMouseDown = useCallback((event?: ReactMouseEvent) => {
    event?.preventDefault();
    isResizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const resizeOffset = Math.max(
        0,
        getResizeOffsetRef.current({
          containerRect,
        })
      );
      const newWidth = getWidthFromPointerRef.current({
        clientX: e.clientX,
        containerRect,
        resizeOffset,
      });
      if (deferCommitRef.current) {
        const clampedWidth = clampWidth(newWidth, { min, max, default: 0, storageKey });
        previewWidthRef.current = clampedWidth;
        setPreviewWidth(clampedWidth);
        return;
      }
      setClampedWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        if (deferCommitRef.current) {
          // A press with no movement leaves previewWidth null: treat it as a
          // click, not a resize — commit nothing.
          if (previewWidthRef.current !== null) {
            setClampedWidth(previewWidthRef.current, { persist: true });
          }
        } else {
          // Save to localStorage when resize ends.
          persistWidth(widthRef.current, storageKey);
        }
      }
      isResizingRef.current = false;
      setIsResizing(false);
      previewWidthRef.current = null;
      setPreviewWidth(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [containerRef, max, min, setClampedWidth, storageKey]);

  return {
    width,
    /** Candidate width during a deferred drag, or null when idle / live mode. */
    previewWidth,
    isResizing,
    handleMouseDown,
    setWidth: setClampedWidth,
    adjustWidthBy,
  };
}
