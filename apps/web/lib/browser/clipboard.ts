export function getClipboardFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) {
    return [];
  }

  const filesFromItems = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file instanceof File);

  if (filesFromItems.length > 0) {
    return filesFromItems;
  }

  return Array.from(dataTransfer.files ?? []);
}

export function getClipboardImageFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  return getClipboardFiles(dataTransfer).filter((file) => file.type.startsWith("image/"));
}
