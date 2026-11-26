import { getGitRemoteUrl } from "../../lib/git/repo.js";
import { isRepoKey, toRepoKey } from "./normalize.js";

/** The `[repo]` argument (a key or a remote URL), or the key of the current directory's `origin` remote. */
export async function resolveRepoKey(repo: string | undefined, cwd = process.cwd()): Promise<string> {
  if (repo !== undefined) {
    const repoKey = toRepoKey(repo) ?? repo.trim().toLowerCase();
    if (!isRepoKey(repoKey)) throw new Error(`${repo} is not owner/repo. Pass [repo] as owner/repo.`);
    return repoKey;
  }
  const remote = await getGitRemoteUrl(cwd);
  if (!remote) throw new Error(`${cwd} has no origin remote. Pass [repo] as owner/repo.`);
  const repoKey = toRepoKey(remote);
  if (!repoKey) throw new Error(`The origin remote ${remote} has no owner/repo. Pass [repo] as owner/repo.`);
  return repoKey;
}
