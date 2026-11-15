import { DEFAULT_FILE, getIconForFile, getIconForFolder, getIconForOpenFolder } from "vscode-icons-js";

// vscode-icons SVGs served from public/file-icons, vendored by scripts/syncFileIcons.ts (OS-2039).
// Names are lowercased like VS Code does, so "Dockerfile" and "App.TSX" still match.

export function fileIconSrc(name: string) {
  return `/file-icons/${getIconForFile(name.toLowerCase()) ?? DEFAULT_FILE}`;
}

export function folderIconSrc(name: string, open: boolean) {
  const leaf = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  return `/file-icons/${open ? getIconForOpenFolder(leaf) : getIconForFolder(leaf)}`;
}
