import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import { parseRunPatchFiles, splitRunPatch } from "@/lib/threads/run-diff-patch";

export interface Commit {
  hash: string;
  subject: string;
  body?: string;
  author: string;
  committedAt: number;
  /** Full hashes, first parent first. */
  parents: string[];
  /** Refs pointing at the commit, as `git log --decorate` lists them. */
  refs?: string[];
  files: CliRunDiffFile[];
  sections: Map<string, string>;
}

type FileKind = CliRunDiffFile["kind"];

/** One file's unified diff: a single hunk of context, then removed, then added lines. */
function filePatch(path: string, { kind = "modified", context = [], removed = [], added = [] }: { kind?: FileKind; context?: string[]; removed?: string[]; added?: string[] }) {
  const header = {
    added: `new file mode 100644\n--- /dev/null\n+++ b/${path}`,
    deleted: `deleted file mode 100644\n--- a/${path}\n+++ /dev/null`,
    modified: `--- a/${path}\n+++ b/${path}`,
  }[kind];
  const oldStart = kind === "added" ? 0 : 1;
  const newStart = kind === "deleted" ? 0 : 1;
  const hunk = `@@ -${oldStart},${context.length + removed.length} +${newStart},${context.length + added.length} @@`;
  const body = [...context.map((line) => ` ${line}`), ...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`)];
  return [`diff --git a/${path} b/${path}`, header, hunk, ...body].join("\n") + "\n";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const now = Date.now();

interface RawCommit extends Omit<Commit, "hash" | "parents" | "files" | "sections"> {
  id: string;
  parents: string[];
  patches: string[];
}

/**
 * `git log --topo-order HEAD origin/main`, newest first: this branch merged
 * main back in, main moved one commit ahead, and main itself merged a PR.
 */
const RAW: RawCommit[] = [
  {
    id: "a1b2c3d",
    subject: "feat(worktrees): list commits of a checkout (OS-2534)",
    body: "Adds the gitLog and commitPatch op kinds. The CLI answers with the\nfirst 50 commits on HEAD and a cursor for the next page.",
    author: "Claude",
    committedAt: now - 12 * MINUTE,
    parents: ["e5f6a7b"],
    refs: ["HEAD -> os-2508-git-history"],
    patches: [
      filePatch("apps/cli/src/lib/git/history.ts", {
        kind: "added",
        added: [
          'import { git } from "./run";',
          "",
          "/** First `limit` commits on HEAD after `cursor`, newest first. */",
          "export async function listCommits(cwd: string, cursor: string | undefined, limit = 50) {",
          '  const format = "%H%x00%P%x00%an%x00%ae%x00%ct%x00%D%x00%s";',
          '  const range = cursor ? [`${cursor}^`] : ["HEAD"];',
          '  const out = await git(cwd, ["log", "--topo-order", `--format=${format}`, `-n${limit + 1}`, ...range]);',
          '  const rows = out.split("\\n").filter(Boolean).map(parseRow);',
          "  return { commits: rows.slice(0, limit), hasMore: rows.length > limit };",
          "}",
        ],
      }),
      filePatch("apps/web/convex/lib/contracts/validators.ts", {
        context: ['  v.literal("worktreeChanges"),'],
        added: ['  v.literal("gitLog"),', '  v.literal("commitPatch"),'],
      }),
    ],
  },
  {
    id: "e5f6a7b",
    subject: "fix(cli): pin diff format for commit patches",
    author: "Pavlo Tkhir",
    committedAt: now - 2 * HOUR,
    parents: ["c9d0e1f"],
    refs: ["origin/os-2508-git-history"],
    patches: [
      filePatch("apps/cli/src/lib/git/checkpoint.ts", {
        context: ["export const DIFF_ARGS = ["],
        removed: ['  "--no-color",'],
        added: ['  "--no-color",', '  "--no-ext-diff",', '  "--no-renames",'],
      }),
    ],
  },
  {
    id: "0aa1b2c",
    subject: "fix(threads): keep the composer focused after sending (OS-2533)",
    author: "gecko0",
    committedAt: now - 3 * HOUR,
    parents: ["37c8e8d"],
    refs: ["origin/main", "main"],
    patches: [
      filePatch("apps/web/components/blocks/thread/composer.tsx", {
        context: ["  await send(message);"],
        added: ["  editor.commands.focus();"],
      }),
    ],
  },
  {
    id: "c9d0e1f",
    subject: "Merge branch 'main' into os-2508-git-history",
    author: "Pavlo Tkhir",
    committedAt: now - 5 * HOUR,
    parents: ["d2e3f4a", "37c8e8d"],
    patches: [],
  },
  {
    id: "d2e3f4a",
    subject: "refactor(worktrees): share the patch body between Changes and History",
    body: "No behavior change.",
    author: "Claude",
    committedAt: now - 26 * HOUR,
    parents: ["9496fe7"],
    patches: [
      filePatch("apps/web/components/blocks/worktrees/worktree-changes-body.tsx", {
        context: ['import { PatchFileSection } from "@/components/custom/diff/patch-file-sections";'],
        removed: ["function FileSection({ file, patch }: FileSectionProps) {"],
        added: ["export function FileSection({ file, patch }: FileSectionProps) {"],
      }),
      filePatch("apps/web/components/blocks/worktrees/legacy-changes-list.tsx", {
        kind: "deleted",
        removed: ['"use client";', "", "export function LegacyChangesList() {", "  return null;", "}"],
      }),
    ],
  },
  {
    id: "37c8e8d",
    subject: "feat(landing): call Convoy an open-source workspace for AI coding agents (OS-2531)",
    author: "gecko0",
    committedAt: now - 30 * HOUR,
    parents: ["b820d42"],
    patches: [
      filePatch("apps/landing/app/page.tsx", {
        context: ["<h1>"],
        removed: ["  The workspace for AI coding agents"],
        added: ["  The open-source workspace for AI coding agents"],
      }),
    ],
  },
  {
    id: "b820d42",
    subject: "fix(cli): ask the backend for its HTTP actions URL (OS-2530)",
    author: "gecko0",
    committedAt: now - 32 * HOUR,
    parents: ["5e1a9c0"],
    patches: [
      filePatch("apps/cli/src/lib/convex/site-url.ts", {
        context: ["export async function siteUrl(client: ConvexClient) {"],
        removed: ['  return process.env.CONVEX_URL!.replace(".cloud", ".site");'],
        added: ["  return client.query(api.system.siteUrl, {});"],
      }),
    ],
  },
  {
    id: "5e1a9c0",
    subject: "Merge pull request #512 from gecko0/feat/os-2492-sign-up",
    author: "gecko0",
    committedAt: now - 34 * HOUR,
    parents: ["004de37", "3194977"],
    patches: [],
  },
  {
    id: "004de37",
    subject: "chore: relicense Convoy under Apache 2.0 (OS-2529)",
    author: "gecko0",
    committedAt: now - 36 * HOUR,
    parents: ["9496fe7"],
    patches: [filePatch("LICENSE", { removed: ["Elastic License 2.0 (ELv2)"], added: ["Apache License", "Version 2.0, January 2004"] })],
  },
  {
    id: "3194977",
    subject: "feat(auth): email and password sign-up and sign-in on Convex Auth (OS-2492)",
    author: "gecko0",
    committedAt: now - 38 * HOUR,
    parents: ["d41d54a"],
    patches: [
      filePatch("apps/web/convex/auth.ts", {
        context: ["export const { auth, signIn, signOut } = convexAuth({"],
        removed: ["  providers: [],"],
        added: ["  providers: [Password],"],
      }),
    ],
  },
  {
    id: "d41d54a",
    subject: "refactor(auth): declare AUTH_MODE in typed env (OS-2492)",
    author: "gecko0",
    committedAt: now - 40 * HOUR,
    parents: ["9496fe7"],
    patches: [filePatch("apps/web/lib/env.ts", { context: ["export const env = createEnv({"], added: ['  AUTH_MODE: z.enum(["clerk", "convex"]),'] })],
  },
  {
    id: "9496fe7",
    subject: "feat(auth): agent browser login in Convex Auth mode (OS-2499)",
    author: "gecko0",
    committedAt: now - 2 * 24 * HOUR,
    parents: ["cd91737"],
    patches: [filePatch("apps/web/app/api/agent/browser-login/route.ts", { context: ["export async function GET(request: Request) {"], added: ["  if (env.AUTH_MODE === \"convex\") return convexLogin(request);"] })],
  },
  {
    id: "cd91737",
    subject: "feat(auth): cookie session and server-side route gate for Convex Auth (OS-2497)",
    author: "gecko0",
    committedAt: now - 2 * 24 * HOUR - 2 * HOUR,
    parents: ["1d4137f"],
    patches: [filePatch("apps/web/middleware.ts", { removed: ["export default clerkMiddleware();"], added: ["export default authMiddleware();"] })],
  },
  {
    id: "1d4137f",
    subject: "feat(auth): forgot password for Convex Auth, with styled reset emails (OS-2496)",
    author: "gecko0",
    committedAt: now - 2 * 24 * HOUR - 4 * HOUR,
    // Parent is past the end of the fixture: its lane runs off the bottom.
    parents: ["fcb2fb6"],
    patches: [filePatch("apps/web/lib/emails/catalog.ts", { context: ["export const EMAILS = {"], added: ["  passwordReset,"] })],
  },
];

/** Fixture ids are 7 chars; pad them into stable 40-char hashes. */
const fullHash = (id: string) => (id + id.split("").reverse().join("")).repeat(3).slice(0, 40);

export const COMMITS: Commit[] = RAW.map(({ id, parents, patches, ...commit }) => {
  const sections = splitRunPatch(patches.join(""));
  return { ...commit, hash: fullHash(id), parents: parents.map(fullHash), sections, files: parseRunPatchFiles(sections) };
});

export const WORKTREE = {
  branch: "os-2508-git-history",
  path: "/Users/pavlo/code/convoy/.worktrees/os-2508-git-history",
  uncommittedFiles: 3,
};
