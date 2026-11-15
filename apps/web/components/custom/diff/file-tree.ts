import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";

export interface FileTreeFile {
  kind: "file";
  name: string;
  file: CliRunDiffFile;
}

export interface FileTreeDir {
  kind: "dir";
  name: string;
  path: string;
  additions: number;
  deletions: number;
  children: FileTreeNode[];
}

export type FileTreeNode = FileTreeDir | FileTreeFile;

/**
 * Nests a flat changed-file list by directory (OS-2037). Folders come first in
 * first-seen order (git already sorts paths); single-child folder chains are
 * joined into one node so deep paths don't stack five empty levels.
 */
export function buildFileTree(files: CliRunDiffFile[]): FileTreeNode[] {
  const root: FileTreeDir = { kind: "dir", name: "", path: "", additions: 0, deletions: 0, children: [] };
  for (const file of files) {
    const segments = file.path.split("/");
    let dir = root;
    for (const segment of segments.slice(0, -1)) {
      let next = dir.children.find((child): child is FileTreeDir => child.kind === "dir" && child.name === segment);
      if (!next) {
        next = {
          kind: "dir",
          name: segment,
          path: dir.path ? `${dir.path}/${segment}` : segment,
          additions: 0,
          deletions: 0,
          children: [],
        };
        dir.children.push(next);
      }
      next.additions += file.additions;
      next.deletions += file.deletions;
      dir = next;
    }
    dir.children.push({ kind: "file", name: segments[segments.length - 1], file });
  }
  return finish(root).children;
}

function finish(dir: FileTreeDir): FileTreeDir {
  const children = dir.children.map((child) => (child.kind === "dir" ? compact(child) : child));
  children.sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir"));
  return { ...dir, children };
}

function compact(dir: FileTreeDir): FileTreeDir {
  const only = dir.children.length === 1 ? dir.children[0] : undefined;
  if (only?.kind === "dir") {
    return compact({ ...only, name: `${dir.name}/${only.name}` });
  }
  return finish(dir);
}
