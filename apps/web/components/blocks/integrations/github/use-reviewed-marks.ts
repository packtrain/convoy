"use client";

import { useCallback, useState } from "react";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";
import type { PullRequestDiffFile } from "./github-patch";

type Marks = Record<string, string>;

/** The file's contents at this revision; a new revision that changes the file changes it. */
function contentKey(file: PullRequestDiffFile): string {
  return file.sha ?? `${file.status}:${file.additions}:${file.deletions}:${file.patch?.length ?? 0}`;
}

function read(key: string): Marks {
  try {
    const parsed: unknown = JSON.parse(readLocalString(key) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Marks) : {};
  } catch {
    return {};
  }
}

/**
 * Reviewed marks in this browser's local storage, keyed by PR, file, and the
 * file's contents. Not GitHub's Viewed flag (docs/specs/github-integration.md → PR reader).
 */
export function useReviewedMarks(repositoryId: string, number: number) {
  const storageKey = `convoy:github:reviewed:${repositoryId}:${number}`;
  const [marks, setMarks] = useState<Marks>(() => read(storageKey));
  const isReviewed = useCallback((file: PullRequestDiffFile) => marks[file.path] === contentKey(file), [marks]);
  const setReviewed = useCallback(
    (file: PullRequestDiffFile, reviewed: boolean) => {
      // Re-read so another tab's marks on other files survive.
      const next = { ...read(storageKey) };
      if (reviewed) next[file.path] = contentKey(file);
      else delete next[file.path];
      writeLocalString(storageKey, JSON.stringify(next));
      setMarks(next);
    },
    [storageKey]
  );
  return { isReviewed, setReviewed };
}
