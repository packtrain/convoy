"use client";

import { useState, useCallback, type ReactNode, type DragEvent } from "react";
import { cn } from "@/lib/utils";

interface AttachmentDropZoneProps {
  children: ReactNode;
  onDrop: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}

export function AttachmentDropZone({
  children,
  onDrop,
  disabled = false,
  className,
}: AttachmentDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      setDragCounter((c) => c + 1);
      if (e.dataTransfer.types.includes("Files")) {
        setIsDragging(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setDragCounter((c) => {
      const newCount = c - 1;
      if (newCount === 0) {
        setIsDragging(false);
      }
      return newCount;
    });
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setIsDragging(false);
      setDragCounter(0);

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onDrop(files);
      }
    },
    [disabled, onDrop]
  );

  return (
    <div
      className={cn(
        "relative transition-shadow duration-200",
        isDragging && "shadow-[inset_0_0_20px_rgba(59,130,246,0.5)]",
        className
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-blue-500/10">
          <span className="rounded-lg bg-background/80 px-4 py-2 font-medium text-blue-500">
            Drop files to attach
          </span>
        </div>
      )}
    </div>
  );
}
