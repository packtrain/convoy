export function getFilenameFromPath(filePath: string): string {
  const normalizedPath = filePath.replace(/[\\/]+$/, "");
  const segments = normalizedPath.split(/[\\/]/);
  const filename = segments.at(-1);
  return filename && filename.length > 0 ? filename : filePath;
}

