# Git & commits

## Non-negotiable

- **Never commit unless the user asked you to.**
- **Never create a branch, and never commit onto a new branch, until the user
  explicitly asks.** When the user says "commit", commit to the branch that is
  currently checked out. Do not switch or create branches. If the current branch
  seems wrong, ask first.
- **Never use `git stash`** — push, pop, or apply, for any reason. Agents have
  repeatedly corrupted the working tree with it: a failed `stash push` followed
  by `stash pop` re-applied the user's own unrelated stash entry over the
  checkout. The user's stash list is their private storage; never pop, apply, or
  drop entries from it.

  To compare against or test a clean HEAD, use non-destructive means:
  `git show HEAD:<file>`, or a temporary detached worktree the user approved.

- **Never silently revert or rewrite diff hunks that look unrelated to your
  change.** Formatting-only changes and unexpected cleanup may be intentional
  user edits. Ask before changing, excluding, or "cleaning up" those hunks.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
`feat(scope): ...`, `fix(scope): ...`, `docs: ...`

Include the task ref when known:

```text
feat(tasks): add compact sidebar task create dialog (OS-647)
```

## Task links

When you create a commit or PR for work tied to a Convoy ticket, attach the
commit or PR URL to the task using Convoy task links. Tickets referenced for
implementation always live in prod — use `mcp__convoy__*` tools. See
[mcp-servers.md](mcp-servers.md).
