"use client";

import { ExternalLink } from "lucide-react";

import type { SkillSource } from "@/convex/lib/contracts/skills";

/**
 * Where to send someone who wants to see the copied version, or `null` when the
 * stored URL is not linkable (docs/specs/skills.md#git-sources). Only `http(s)`
 * passes, so a stored string can never become a `javascript:` href.
 *
 * Ceiling: only github.com's tree layout is known, so every other host opens at
 * the repository root rather than the commit. Add a host when someone needs it.
 */
export function skillSourceHref(source: SkillSource): string | null {
  if (!source.repoUrl) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(source.repoUrl);
  } catch {
    // An SSH remote (`git@host:owner/repo.git`) is not a URL and has nothing to open.
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  // The commit is the version; a ref is the next best thing; with neither, the
  // repository root is all there is to point at.
  const tree = source.commitSha ?? source.ref;
  if (url.hostname !== "github.com" || !tree) {
    return url.toString();
  }

  const repoPath = url.pathname.replace(/\.git$/, "").replace(/\/$/, "");

  return `${url.origin}${repoPath}/tree/${tree}${source.subpath ? `/${source.subpath}` : ""}`;
}

/** Inline icon link beside a Skill's name; renders nothing when there is nothing to open. */
export function SkillSourceLink({ source }: { source: SkillSource }) {
  const href = skillSourceHref(source);
  if (!href) {
    return null;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Open source repository"
      title={source.commitSha ? `Open ${source.repoUrl} at ${source.commitSha.slice(0, 7)}` : `Open ${source.repoUrl}`}
      className="flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground"
      onClick={(event) => event.stopPropagation()}
    >
      <ExternalLink className="size-3.5" />
    </a>
  );
}

/** The Metadata section's four inputs, as typed. */
export interface SkillSourceFields {
  repoUrl?: string;
  commitSha?: string;
  ref?: string;
  subpath?: string;
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

/**
 * Splits the URL GitHub's own UI hands you — `.../tree/{ref}/{subpath}` — into the
 * parts a fetch needs, so a paste fills the section instead of being hand-split.
 * `null` for anything else, including another host: only GitHub's layout is known,
 * and a wrong split is worse than none (docs/specs/skills.md#git-sources).
 */
export function parseSkillSourceUrl(input: string): SkillSourceFields | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname.replace(/^www\./, "") !== "github.com") {
    return null;
  }

  const [owner, repo, kind, ref, ...rest] = url.pathname.replace(/^\//, "").split("/");
  if (!owner || !repo) {
    return null;
  }

  const repoUrl = `${url.origin}/${owner}/${repo.replace(/\.git$/, "")}`;
  if (!ref || (kind !== "tree" && kind !== "blob")) {
    return { repoUrl };
  }

  // A skill is a directory, so a link to its entry point still means the directory.
  const subpath = rest.join("/").replace(/\/?SKILL\.md$/, "");

  return {
    repoUrl,
    // A browse URL carries whichever the author linked; only one of them is a version.
    ...(COMMIT_SHA_PATTERN.test(ref) ? { commitSha: ref } : { ref }),
    ...(subpath && { subpath }),
  };
}

/**
 * The `source` a save writes, or `null` to clear it. Every field stands alone —
 * partial provenance beats none — so only an entirely empty section clears
 * (docs/specs/skills.md#git-sources).
 */
export function skillSourceFromFields(fields: SkillSourceFields | undefined): SkillSource | null {
  const source: SkillSource = {};
  for (const key of ["repoUrl", "commitSha", "ref", "subpath"] as const) {
    const value = fields?.[key]?.trim();
    if (value) {
      source[key] = value;
    }
  }

  return Object.keys(source).length > 0 ? source : null;
}
