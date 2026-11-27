import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { runGit } from "./git/exec.js";
import {
  detectPullRequestProvider,
  lookupRepoPullRequests,
  normalizeAzureDevOpsPullRequest,
  normalizeGitHubPullRequest,
  normalizeGitLabMergeRequest,
  parsePullRequestList,
  selectPullRequestCandidate,
  type PullRequestCandidate,
} from "./pull-requests.js";

function candidate(overrides: Partial<PullRequestCandidate>): PullRequestCandidate {
  return {
    provider: "github",
    number: 1,
    title: "PR",
    url: "https://github.com/acme/repo/pull/1",
    state: "open",
    headBranch: "feat/x",
    baseBranch: "main",
    updatedAt: 0,
    ...overrides,
  };
}

describe("detectPullRequestProvider", () => {
  test.each([
    ["https://github.com/acme/repo.git", "github"],
    ["git@github.com:acme/repo.git", "github"],
    ["https://github.acme-corp.com/acme/repo.git", "github"],
    ["https://gitlab.com/acme/repo.git", "gitlab"],
    ["git@gitlab.internal.acme.io:acme/repo.git", "gitlab"],
    ["https://dev.azure.com/acme/project/_git/repo", "azure-devops"],
    ["https://acme.visualstudio.com/project/_git/repo", "azure-devops"],
  ])("%s -> %s", (remoteUrl, provider) => {
    expect(detectPullRequestProvider(remoteUrl)).toBe(provider);
  });

  test("returns null for bitbucket (capture deferred) and unrecognized hosts", () => {
    expect(detectPullRequestProvider("git@bitbucket.org:acme/repo.git")).toBeNull();
    expect(detectPullRequestProvider("https://git.sr.ht/~acme/repo")).toBeNull();
    expect(detectPullRequestProvider("")).toBeNull();
  });
});

describe("normalizeGitHubPullRequest", () => {
  const base = {
    number: 42,
    title: "Add badge",
    url: "https://github.com/acme/repo/pull/42",
    headRefName: "feat/badge",
    baseRefName: "main",
    updatedAt: "2026-07-01T10:00:00Z",
  };

  test("folds OPEN + isDraft into draft", () => {
    expect(normalizeGitHubPullRequest({ ...base, state: "OPEN", isDraft: true })?.state).toBe("draft");
    expect(normalizeGitHubPullRequest({ ...base, state: "OPEN", isDraft: false })?.state).toBe("open");
  });

  test("mergedAt implies merged even when state says CLOSED", () => {
    const record = normalizeGitHubPullRequest({ ...base, state: "CLOSED", mergedAt: "2026-07-02T10:00:00Z" });
    expect(record?.state).toBe("merged");
  });

  test("maps CLOSED without mergedAt to closed and rejects malformed rows", () => {
    expect(normalizeGitHubPullRequest({ ...base, state: "CLOSED" })?.state).toBe("closed");
    expect(normalizeGitHubPullRequest({ ...base, number: undefined })).toBeNull();
    expect(normalizeGitHubPullRequest("nope")).toBeNull();
  });
});

describe("normalizeGitLabMergeRequest", () => {
  const base = {
    iid: 7,
    title: "Add badge",
    web_url: "https://gitlab.com/acme/repo/-/merge_requests/7",
    source_branch: "feat/badge",
    target_branch: "main",
    updated_at: "2026-07-01T10:00:00Z",
  };

  test("maps opened/merged/closed and the draft flag", () => {
    expect(normalizeGitLabMergeRequest({ ...base, state: "opened" })?.state).toBe("open");
    expect(normalizeGitLabMergeRequest({ ...base, state: "opened", draft: true })?.state).toBe("draft");
    expect(normalizeGitLabMergeRequest({ ...base, state: "merged" })?.state).toBe("merged");
    expect(normalizeGitLabMergeRequest({ ...base, state: "closed" })?.state).toBe("closed");
  });

  test("uses the MR iid as the number", () => {
    expect(normalizeGitLabMergeRequest({ ...base, state: "opened" })?.number).toBe(7);
  });
});

describe("normalizeAzureDevOpsPullRequest", () => {
  const base = {
    pullRequestId: 9,
    title: "Add badge",
    sourceRefName: "refs/heads/feat/badge",
    targetRefName: "refs/heads/main",
    status: "active",
    repository: { webUrl: "https://dev.azure.com/acme/project/_git/repo/" },
    creationDate: "2026-07-01T10:00:00Z",
  };

  test("strips refs/heads/, builds the PR url, and maps statuses", () => {
    const record = normalizeAzureDevOpsPullRequest(base);
    expect(record).toMatchObject({
      headBranch: "feat/badge",
      baseBranch: "main",
      state: "open",
      url: "https://dev.azure.com/acme/project/_git/repo/pullrequest/9",
    });
    expect(normalizeAzureDevOpsPullRequest({ ...base, status: "completed" })?.state).toBe("merged");
    expect(normalizeAzureDevOpsPullRequest({ ...base, status: "abandoned" })?.state).toBe("closed");
    expect(normalizeAzureDevOpsPullRequest({ ...base, isDraft: true })?.state).toBe("draft");
  });
});

describe("selectPullRequestCandidate", () => {
  test("prefers open over more recently updated merged", () => {
    const merged = candidate({ number: 1, state: "merged", updatedAt: 200 });
    const open = candidate({ number: 2, state: "open", updatedAt: 100 });
    expect(selectPullRequestCandidate([merged, open], "feat/x", false)?.number).toBe(2);
  });

  test("falls back to the most recently updated match when nothing is open", () => {
    const older = candidate({ number: 1, state: "closed", updatedAt: 100 });
    const newer = candidate({ number: 2, state: "merged", updatedAt: 200 });
    expect(selectPullRequestCandidate([older, newer], "feat/x", false)?.number).toBe(2);
  });

  test("requires an exact head-branch match", () => {
    const other = candidate({ headBranch: "feat/x-2" });
    expect(selectPullRequestCandidate([other], "feat/x", false)).toBeNull();
  });

  test("on the default branch only open PRs are attributed", () => {
    const merged = candidate({ headBranch: "main", state: "merged", updatedAt: 200 });
    expect(selectPullRequestCandidate([merged], "main", true)).toBeNull();

    const open = candidate({ headBranch: "main", state: "open" });
    expect(selectPullRequestCandidate([merged, open], "main", true)?.number).toBe(open.number);
  });
});

describe("parsePullRequestList", () => {
  test("skips malformed rows instead of failing the lookup", () => {
    const raw = JSON.stringify([
      { iid: 1, title: "ok", web_url: "https://gitlab.com/a/r/-/merge_requests/1", source_branch: "b", target_branch: "main", state: "opened" },
      { garbage: true },
    ]);
    expect(parsePullRequestList(raw, normalizeGitLabMergeRequest)).toHaveLength(1);
  });

  test("empty output is an empty list", () => {
    expect(parsePullRequestList("", normalizeGitHubPullRequest)).toEqual([]);
  });
});

describe("lookupRepoPullRequests (real git, OS-2523)", () => {
  test("clears a repo on origin's default branch without a forge call and leaves out a failed lookup", async () => {
    const root = await mkdtemp(join(tmpdir(), "convoy-repo-prs-"));
    const repoAt = async (name: string, remote: string, branch: string) => {
      const dir = join(root, name);
      await mkdir(dir);
      await runGit(dir, ["init", `--initial-branch=${branch}`]);
      await runGit(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "init"]);
      await runGit(dir, ["remote", "add", "origin", remote]);
      await runGit(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
      return dir;
    };
    try {
      // A github remote: a forge call would fail here, so only the default-branch rule reports it.
      const onMain = await repoAt("old-app", "https://github.com/acme/old-app.git", "main");
      // An unknown forge host: the lookup can't run, so the repo is not reported and its PR survives.
      const unknownHost = await repoAt("new-app", "https://forge.example/acme/new-app.git", "feat/x");
      expect(await lookupRepoPullRequests(root, [unknownHost, onMain])).toEqual([{ repo: "old-app" }]);
      // A repo whose git read fails (moved after the scan) is left out alone (round 2 #2).
      expect(await lookupRepoPullRequests(root, [join(root, "gone"), onMain])).toEqual([{ repo: "old-app" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("lookupRepoPullRequests deadline (review #5)", () => {
  test("leaves out the repos a hanging forge CLI didn't answer for by the deadline", async () => {
    const root = await mkdtemp(join(tmpdir(), "convoy-repo-prs-slow-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "gh"), "#!/bin/sh\nsleep 5\n");
    await chmod(join(bin, "gh"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    try {
      const repo = join(root, "new-app");
      await mkdir(repo);
      await runGit(repo, ["init", "--initial-branch=feat/x"]);
      await runGit(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "init"]);
      await runGit(repo, ["remote", "add", "origin", "https://github.com/acme/new-app.git"]);
      const started = Date.now();
      expect(await lookupRepoPullRequests(root, [repo], { deadlineMs: 300 })).toEqual([]);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });
});
