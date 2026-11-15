"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import { splitPath } from "@/components/custom/diff/patch-file-sections";
import { parseFileOpResult, parseRunPatchFiles, splitRunPatch } from "@/lib/threads/run-diff-patch";
import { downloadFile } from "@/lib/tasks/files";
import {
  supportsWorktreeChanges,
  supportsWorktreeDownload,
  supportsWorktreeOpenFile,
  supportsWorktreeRevertAll,
} from "@/lib/worktrees/cli-version";
import { useWorktreeOp } from "@/lib/worktrees/hooks/use-worktree-op";
import { getErrorMessage } from "@/lib/errors";

/** The one-at-a-time ops the view runs itself (OS-2043, OS-2050, OS-2234). */
type FileOpKind = "revertWorkingFile" | "revertWorkingTree" | "downloadFile";
interface FileOpOutcome {
  opId: Id<"cliWorktreeOps">;
  kind: FileOpKind;
  path: string;
  error: string | null;
  downloadUrl?: string;
}

/**
 * State and actions of one checkout's uncommitted changes, shared by the
 * full-page view and the thread sidebar panel (docs/specs/cli-worktrees.md).
 */
export function useWorktreeChanges(profileId: Id<"cliProfiles">, pathId: string) {
  const profile = useQuery(api.cli.profiles.get, { profileId });
  const entry = profile?.paths.find((path) => path.id === pathId);
  const isOnline = profile?.isOnline ?? false;
  const cliSupported = supportsWorktreeChanges(profile?.appVersion);
  const changes = useWorktreeOp({
    profileId,
    pathId,
    kind: "worktreeChanges",
    enabled: isOnline && cliSupported && entry !== undefined,
  });
  // `null` is the Changes tab; file tabs hold their path.
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const fileRead = useWorktreeOp({
    profileId,
    pathId,
    kind: "readFile",
    filePath: activeTab ?? undefined,
    enabled: isOnline && activeTab !== null && entry !== undefined,
  });
  const [revertTarget, setRevertTarget] = useState<CliRunDiffFile | null>(null);
  const [revertAllOpen, setRevertAllOpen] = useState(false);
  const [pendingOp, setPendingOp] = useState<{ opId: Id<"cliWorktreeOps">; kind: FileOpKind; path: string } | null>(null);
  // Set at click time, before the enqueue round trip, so a second click cannot start a second op.
  const [enqueuing, setEnqueuing] = useState(false);
  const [opOutcome, setOpOutcome] = useState<FileOpOutcome | null>(null);
  const enqueueOp = useMutation(api.cli.worktreeOps.enqueue);
  const discardOp = useMutation(api.cli.worktreeOps.discard);
  const pendingRow = useQuery(api.cli.worktreeOps.get, pendingOp ? { opId: pendingOp.opId } : "skip");

  const parsed = useMemo(() => parseFileOpResult(changes.resultJson, "patch"), [changes.resultJson]);
  const sections = useMemo(() => (parsed ? splitRunPatch(parsed.text) : null), [parsed]);
  const files = useMemo(() => (sections ? parseRunPatchFiles(sections) : []), [sections]);

  const refreshFile = fileRead.refresh;
  const refreshChanges = changes.refresh;
  const refresh = useCallback(() => {
    refreshChanges();
    refreshFile();
  }, [refreshChanges, refreshFile]);
  // Disk is mutable: every activation re-reads the file.
  const selectTab = useCallback(
    (tab: string | null) => {
      setActiveTab(tab);
      if (tab !== null) {
        refreshFile();
      }
    },
    [refreshFile]
  );
  const openFile = useCallback(
    (path: string) => {
      setOpenPaths((paths) => (paths.includes(path) ? paths : [...paths, path]));
      selectTab(path);
    },
    [selectTab]
  );
  const closeFileTab = useCallback((path: string) => {
    setOpenPaths((paths) => paths.filter((openPath) => openPath !== path));
    setActiveTab((current) => (current === path ? null : current));
  }, []);

  // Settle during render like useWorktreeOp; a null row means the op was
  // pruned before the CLI answered. The effect only reports and acts.
  if (pendingOp && pendingRow !== undefined && pendingRow?.status !== "pending") {
    setPendingOp(null);
    setOpOutcome({
      opId: pendingOp.opId,
      kind: pendingOp.kind,
      path: pendingOp.path,
      error:
        pendingRow === null
          ? "The CLI did not answer before the request expired."
          : pendingRow.status === "failed"
            ? (pendingRow.error ?? "The CLI could not complete the request")
            : pendingOp.kind === "downloadFile" && !pendingRow.downloadUrl
              ? "Download failed"
              : null,
      downloadUrl: pendingRow?.downloadUrl,
    });
  }
  useEffect(() => {
    if (!opOutcome) {
      return;
    }
    if (opOutcome.error) {
      toast.error(opOutcome.error);
    }
    if (opOutcome.kind === "revertWorkingFile" || opOutcome.kind === "revertWorkingTree") {
      if (!opOutcome.error) {
        toast.success(opOutcome.kind === "revertWorkingTree" ? "Changes reverted" : "File reverted");
      }
      // A partial revert-all still changed files, so refresh either way.
      refresh();
    } else if (opOutcome.downloadUrl) {
      // Saved or not, the blob is done; the TTL prune is only the fallback.
      void downloadFile(opOutcome.downloadUrl, splitPath(opOutcome.path).base)
        .then((ok) => {
          if (!ok) {
            toast.error("Download failed");
          }
        })
        .finally(() => discardOp({ opId: opOutcome.opId }).catch(() => {}));
    }
  }, [opOutcome, refresh, discardOp]);

  const busy = pendingOp !== null || enqueuing;
  const runFileOp = (kind: FileOpKind, path: string, filePaths?: string[]) => {
    if (busy) {
      return;
    }
    setEnqueuing(true);
    enqueueOp({ profileId, kind, pathId, ...(filePaths ? { filePaths } : { filePath: path }) })
      .then((opId) => setPendingOp({ opId, kind, path }))
      .catch((error) => toast.error(getErrorMessage(error, "Failed to reach the CLI")))
      .finally(() => setEnqueuing(false));
  };
  const confirmRevert = () => {
    const target = revertTarget;
    setRevertTarget(null);
    if (!target) {
      return;
    }
    // Reverting an added file deletes it, so its tab has nothing to show.
    if (target.kind === "added") {
      closeFileTab(target.path);
    }
    runFileOp("revertWorkingFile", target.path);
  };
  const confirmRevertAll = () => {
    setRevertAllOpen(false);
    if (files.length === 0) {
      return;
    }
    setOpenPaths([]);
    setActiveTab(null);
    runFileOp(
      "revertWorkingTree",
      "",
      files.map((file) => file.path)
    );
  };
  const requestDownload = (path: string) => runFileOp("downloadFile", path);

  const canRevertAll = supportsWorktreeRevertAll(profile?.appVersion);
  return {
    profile,
    entry,
    isOnline,
    cliSupported,
    changes,
    parsed,
    sections,
    files,
    fileRead,
    refresh,
    activeTab,
    openPaths,
    selectTab,
    openFile,
    closeFileTab,
    canOpenFile: supportsWorktreeOpenFile(profile?.appVersion),
    canDownload: supportsWorktreeDownload(profile?.appVersion),
    canRevertAll,
    // The on-screen list is incomplete when the patch was cut (OS-2234).
    revertAllDisabled: busy || files.length === 0 || parsed?.truncated === true,
    busy,
    revertTarget,
    setRevertTarget,
    confirmRevert,
    revertAllOpen,
    setRevertAllOpen,
    confirmRevertAll,
    requestDownload,
  };
}

export type WorktreeChanges = ReturnType<typeof useWorktreeChanges>;
