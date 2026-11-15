import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_FILE, DEFAULT_FOLDER, DEFAULT_FOLDER_OPENED } from "vscode-icons-js";
import { FileExtensions1ToIcon } from "vscode-icons-js/dist/generated/FileExtensions1ToIcon";
import { FileExtensions2ToIcon } from "vscode-icons-js/dist/generated/FileExtensions2ToIcon";
import { FileNamesToIcon } from "vscode-icons-js/dist/generated/FileNamesToIcon";
import { FolderNamesToIcon } from "vscode-icons-js/dist/generated/FolderNamesToIcon";
import { LanguagesToIcon } from "vscode-icons-js/dist/generated/LanguagesToIcon";

export const FILE_ICONS_DIR = join(__dirname, "../public/file-icons");

/** Every SVG name vscode-icons-js can return (OS-2039). */
export function referencedIcons(): Set<string> {
  const names = new Set([DEFAULT_FILE, DEFAULT_FOLDER, DEFAULT_FOLDER_OPENED]);
  for (const map of [FileExtensions1ToIcon, FileExtensions2ToIcon, FileNamesToIcon, FolderNamesToIcon, LanguagesToIcon]) {
    for (const icon of Object.values(map)) names.add(icon);
  }
  // getIconForOpenFolder derives "<closed>_opened.svg"; no map lists those names.
  for (const icon of Object.values(FolderNamesToIcon)) names.add(icon.replace(/\.svg$/, "_opened.svg"));
  return names;
}

/** Copies the referenced SVGs from a github.com/vscode-icons/vscode-icons checkout into public/file-icons. */
function main() {
  const [source] = process.argv.slice(2);
  if (!source) throw new Error("Usage: pnpm exec tsx apps/web/scripts/syncFileIcons.ts <path-to-vscode-icons-checkout>");
  rmSync(FILE_ICONS_DIR, { recursive: true, force: true });
  mkdirSync(FILE_ICONS_DIR, { recursive: true });
  const missing: string[] = [];
  for (const name of referencedIcons()) {
    // Upstream renamed a few icons after the mapping was generated; serve the default rather than a broken image.
    const file = join(source, "icons", name);
    if (!existsSync(file)) missing.push(name);
    copyFileSync(existsSync(file) ? file : join(source, "icons", DEFAULT_FILE), join(FILE_ICONS_DIR, name));
  }
  copyFileSync(join(source, "LICENSE"), join(FILE_ICONS_DIR, "LICENSE"));
  console.log(`Copied ${referencedIcons().size} icons; missing upstream, replaced by the default: ${missing.join(", ") || "none"}`);
}

if (require.main === module) main();
