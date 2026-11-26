// Keep in sync with apps/web/convex/cli/lib/normalize.ts; its test runs both on the same cases.
const SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;
const URL_FORM = /^[a-z][a-z\d+.-]*:\/\/([^/]*)(.*)$/i;
// Git reads `host:path` as scp-like only with no slash before the colon; a one-letter host is a Windows drive.
const SCP_FORM = /^([^/:]{2,}):(.*)$/;
const AZURE_HOST = /(^|[@.])(dev\.azure\.com|visualstudio\.com)(:\d+)?$/i;

/** A git remote's `owner/repo`, lowercased, host ignored. Spec: cli-worktrees.md#repo-key. */
export function toRepoKey(gitRemoteUrl: string | undefined): string | null {
  const remote = gitRemoteUrl?.trim() ?? "";
  const url = URL_FORM.exec(remote);
  const path = url ? (url[1] ? url[2] : undefined) : SCP_FORM.exec(remote)?.[2];
  if (path === undefined) return null;
  const segments = path.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
  // Azure DevOps HTTPS puts `_git` between project and repo; its SSH form does not.
  if (url && AZURE_HOST.test(url[1]) && segments.at(-2) === "_git") segments.splice(-2, 1);
  const pair = segments.slice(-2);
  return pair.length === 2 && pair.every((segment) => SEGMENT.test(segment)) ? pair.join("/").toLowerCase() : null;
}

/** The stored form `toRepoKey` produces. */
export function isRepoKey(value: string): boolean {
  const pair = value.split("/");
  return pair.length === 2 && pair.every((segment) => SEGMENT.test(segment)) && value === value.toLowerCase();
}
