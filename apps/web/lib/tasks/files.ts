import type { ImageDimensions } from "@/convex/lib/contracts/validators";
import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  File,
  type LucideIcon,
} from "lucide-react";

/**
 * Download a file from a URL with a specific filename.
 * Handles cross-origin URLs by fetching the file first.
 * @returns true if successful, false if failed
 */
export async function downloadFile(url: string, fileName: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Download failed");
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
    return true;
  } catch (error) {
    console.error("Download error:", error);
    return false;
  }
}

/**
 * Get the content type for a file, with fallback for unknown types.
 */
export function getContentType(file: File): string {
  return file.type || "application/octet-stream";
}

/** An image file's pixel size; undefined for other files or when the browser can't decode it. */
export async function readImageDimensions(file: Blob): Promise<ImageDimensions | undefined> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return undefined;
  }
}

export function isPreviewableImageAttachment(
  contentType: string,
  url: string | null
): boolean {
  return contentType.startsWith("image/") && url !== null;
}

export function isPreviewableVideoAttachment(
  contentType: string,
  url: string | null
): boolean {
  return contentType.startsWith("video/") && url !== null;
}

/** The text preview reads the whole file into the page, so bigger files download instead. */
export const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const TEXT_CONTENT_TYPE_PREFIXES = ["text/", "application/json", "application/xml"];

export function isPreviewableTextAttachment(
  contentType: string,
  url: string | null,
  fileSize: number
): boolean {
  return (
    url !== null &&
    fileSize <= MAX_TEXT_PREVIEW_BYTES &&
    TEXT_CONTENT_TYPE_PREFIXES.some((prefix) => contentType.startsWith(prefix))
  );
}

export function isMarkdownContentType(contentType: string): boolean {
  return /^text\/(x-)?markdown\b/.test(contentType);
}

export function getFileIcon(contentType: string): LucideIcon {
  if (contentType.startsWith("image/")) return FileImage;
  if (contentType.startsWith("video/")) return FileVideo;
  if (contentType.startsWith("audio/")) return FileAudio;
  if (contentType.includes("pdf")) return FileText;
  if (contentType.includes("spreadsheet") || contentType.includes("excel"))
    return FileSpreadsheet;
  if (
    contentType.includes("code") ||
    contentType.includes("javascript") ||
    contentType.includes("json")
  )
    return FileCode;
  return File;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
