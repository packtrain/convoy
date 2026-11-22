# Git worktrees (isolated end-to-end environments)

Full details: [`docs/specs/worktree-preview-deployments.md`](../specs/worktree-preview-deployments.md).

## Dev servers: where they may run

**Never start the dev server or any app server in the primary checkout.** The app
is normally already running there.

**In a linked worktree you may — and should, for end-to-end verification — run
`pnpm web:dev`.** It serves an isolated instance at
`https://<branch-slug>.app.convoy.localhost`, backed by that worktree's own
Convex preview deployment. Agent browser login works on that host too (see
[ui-verification.md](ui-verification.md)). With `NEXT_PUBLIC_AUTH_MODE=convex`
in `apps/web/.env.local` before setup, the preview runs Convex Auth and setup
creates the agent user with the copied organizations
([spec](../specs/worktree-preview-deployments.md#convex-auth-mode)).

## Creating a worktree

Only when the user asks — the no-branch-creation rule still applies.

Use worktrunk, not raw `git worktree add`, so the automation runs:

```bash
wt switch --create <branch>   # post-create hook: env files, pnpm i, Convex
                              # preview deployment with dev data copied in
```

The worktree is fully usable when creation finishes.

## Working in a worktree

After editing `apps/web/convex/` functions:

```bash
pnpm worktree:convex:deploy   # preview deployments have no watch mode
```

## Removing a worktree

```bash
wt remove                     # cleanup hook kills lingering servers
```

## Troubleshooting

If `wt` fails with a hook-approval error in a non-interactive session, ask the
user to run `wt config approvals add`.

## In the devcontainer

No `wt` and no portless. One-time: put a deploy key generated on the dev
deployment into the primary checkout's `apps/web/.env.local` as
`CONVEX_DEV_DEPLOY_KEY=dev:...` (permissions listed in the spec). Never run `npx convex login` in the
container; that token reaches prod. Details:
[spec](../specs/worktree-preview-deployments.md#devcontainer).

From the worktree root (a Convoy thread worktree under `/workspace-worktrees`
counts):

```bash
cp /workspace/apps/web/.env.local apps/web/ && pnpm i --prefer-offline
pnpm worktree:setup          # preview deployment + dev data; prints the App URL
pnpm worktree:dev            # run in the background
```

Log in with the POST flow from [ui-verification.md](ui-verification.md),
using `NEXT_PUBLIC_APP_URL` from the worktree's `.env.local` as the host.
Screenshot with `playwright-cli`, attach with `convoy threads attach`, and give
the user the App URL. It opens from their Mac, and they sign in with their own
dev Clerk account.

If `playwright-cli` is missing, the image is stale. Rebuild it, or in the
meantime run `npx -y @playwright/cli@0.1.21` with a config whose
`executablePath` points at the Chromium under `/usr/local/share/convoy-browsers`.
