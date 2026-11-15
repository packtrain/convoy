import path from "node:path";

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const UNSAFE_CHARACTERS = /[\\/:"*?<>|\u0000-\u001f\u007f]/g;
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * Reduce a server-supplied file name to one safe path segment (OS-1902).
 * `win32.basename` splits on both separators and drops drive prefixes.
 */
export function toSafeFileName(fileName: string): string {
  const baseName = path.win32.basename(fileName.trim()).replace(UNSAFE_CHARACTERS, "_");
  if (!baseName || baseName === "." || baseName === "..") {
    return "attachment";
  }
  return WINDOWS_DEVICE_NAME.test(baseName) ? `_${baseName}` : baseName;
}
