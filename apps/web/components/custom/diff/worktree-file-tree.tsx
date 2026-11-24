"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileText, RotateCcw } from "lucide-react";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { fileIconSrc, folderIconSrc } from "@/lib/file-icons";
import { buildFileTree, type FileTreeNode } from "./file-tree";
import { cn } from "@/lib/utils";

interface WorktreeFileTreeProps {
  files: CliRunDiffFile[];
  selectedPath?: string;
  onSelectFile: (path: string) => void;
  /** Right-click "Open file" (OS-2041); absent when the CLI cannot read from disk. */
  onOpenFile?: (path: string) => void;
  /** Right-click "Revert" (OS-2043); disabled while `reverting`. */
  onRevertFile?: (file: CliRunDiffFile) => void;
  reverting?: boolean;
  /** Right-click "Download" (OS-2050); absent when the CLI cannot upload. */
  onDownloadFile?: (path: string) => void;
}

/** Changed files nested by folder (OS-2037); the sidebar of the changes view. */
export function WorktreeFileTree({
  files,
  selectedPath,
  onSelectFile,
  onOpenFile,
  onRevertFile,
  reverting = false,
  onDownloadFile,
}: WorktreeFileTreeProps) {
  const nodes = useMemo(() => buildFileTree(files), [files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleDir = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  return (
    <ul className="py-1 text-sm">
      {nodes.map((node) => (
        <TreeRow
          key={node.kind === "dir" ? node.path : node.file.path}
          node={node}
          depth={0}
          collapsed={collapsed}
          selectedPath={selectedPath}
          onToggleDir={toggleDir}
          onSelectFile={onSelectFile}
          onOpenFile={onOpenFile}
          onRevertFile={onRevertFile}
          reverting={reverting}
          onDownloadFile={onDownloadFile}
        />
      ))}
    </ul>
  );
}

function Icon({ src }: { src: string }) {
  // Static SVGs from public/; next/image would add nothing.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="size-4 shrink-0" />;
}

function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
      <span className="text-success">+{additions}</span>
      <span className="text-destructive">-{deletions}</span>
    </span>
  );
}

function TreeRow({
  node,
  depth,
  collapsed,
  selectedPath,
  onToggleDir,
  onSelectFile,
  onOpenFile,
  onRevertFile,
  reverting,
  onDownloadFile,
}: {
  node: FileTreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  selectedPath: string | undefined;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onRevertFile?: (file: CliRunDiffFile) => void;
  reverting: boolean;
  onDownloadFile?: (path: string) => void;
}) {
  const rowClass = "flex w-full min-w-0 cursor-pointer items-center gap-1.5 py-1 pr-3 text-left hover:bg-muted/50";
  const indent = { paddingLeft: `${12 + depth * 16}px` };
  if (node.kind === "file") {
    const { file } = node;
    const selected = file.path === selectedPath;
    const row = (
      <button
        type="button"
        className={cn(rowClass, selected && "bg-primary/10 hover:bg-primary/10")}
        style={indent}
        onClick={() => onSelectFile(file.path)}
        aria-current={selected ? "true" : undefined}
        title={file.path}
      >
        <Icon src={fileIconSrc(node.name)} />
        <span className={cn("truncate", file.kind === "deleted" && "text-muted-foreground line-through")}>{node.name}</span>
        {file.binary ? (
          <span className="ml-auto text-xs text-muted-foreground">binary</span>
        ) : (
          <Counts additions={file.additions} deletions={file.deletions} />
        )}
      </button>
    );
    // The menu is on every row; the item is disabled where there is nothing
    // on disk to open (deleted, binary) or the CLI cannot read from disk.
    // A tree with no actions at all (a commit's files) has no menu.
    if (!onOpenFile && !onRevertFile && !onDownloadFile) {
      return <li>{row}</li>;
    }
    const canOpen = onOpenFile !== undefined && file.kind !== "deleted" && !file.binary;
    return (
      <li>
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={!canOpen} onSelect={() => onOpenFile?.(file.path)}>
              <FileText />
              Open file
            </ContextMenuItem>
            <ContextMenuItem disabled={!onDownloadFile || file.kind === "deleted"} onSelect={() => onDownloadFile?.(file.path)}>
              <Download />
              Download
            </ContextMenuItem>
            <ContextMenuItem disabled={!onRevertFile || reverting} onSelect={() => onRevertFile?.(file)}>
              <RotateCcw />
              Revert
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </li>
    );
  }
  const open = !collapsed.has(node.path);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <button
        type="button"
        className={rowClass}
        style={indent}
        onClick={() => onToggleDir(node.path)}
        aria-expanded={open}
        title={node.path}
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <Icon src={folderIconSrc(node.name, open)} />
        <span className="truncate">{node.name}</span>
        <Counts additions={node.additions} deletions={node.deletions} />
      </button>
      {open && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.kind === "dir" ? child.path : child.file.path}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              selectedPath={selectedPath}
              onToggleDir={onToggleDir}
              onSelectFile={onSelectFile}
              onOpenFile={onOpenFile}
              onRevertFile={onRevertFile}
              reverting={reverting}
              onDownloadFile={onDownloadFile}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
