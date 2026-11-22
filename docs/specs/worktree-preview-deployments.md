# Worktree Preview Deployments

## Purpose

Let each linked git worktree run the full app in isolation — its own Convex
backend (a [preview deployment](https://docs.convex.dev/production/multiple-deployments#preview)),
its own branch-prefixed local URL — so AI agents (and humans) can implement and
verify changes end-to-end without touching the shared dev deployment.

## One-Time Prerequisites

- Convex Pro (preview deployments are a Pro feature).
- A **Preview deploy key** from the Convex dashboard (Project Settings → Deploy
  Keys), stored in the primary checkout's `apps/web/.env.local` as
  `CONVEX_PREVIEW_DEPLOY_KEY=preview:...`.
- The portless proxy running (`portless proxy start`).
- Worktrunk hook approval: after `.config/wt.toml` changes, run
  `wt config approvals add` once.

## Creation Flow

`wt switch --create <branch>` runs the blocking `post-create` hook in
`.config/wt.toml` — a single chained command so ordering is guaranteed and the
worktree is fully usable the moment creation finishes:

1. Copy `apps/web/.env.local` and `apps/cli/.env.local` from the primary
   checkout.
2. `pnpm i`.
3. `node scripts/worktree-setup.mjs`, which:
   - Soft-skips (exit 0) if `CONVEX_PREVIEW_DEPLOY_KEY` is missing, and no-ops
     if `CONVEX_PREVIEW_NAME` is already set.
   - Exports the dev deployment's data (including file storage) and env vars
     while `.env.local` still points at dev.
   - Creates a preview deployment named after the branch slug (same
     sanitization portless uses: last `/` segment, lowercased, non-alphanumerics
     collapsed to `-`), via `convex deploy --preview-create`.
   - Copies all dev env vars (Clerk issuer domain, secrets, etc.) onto the
     preview deployment, redeploying once if the first function push failed
     because `auth.config.ts` needed them.
   - Imports the dev data snapshot with `--replace-all`, so preview data
     mirrors dev at creation time.
   - Rewrites the worktree's `apps/web/.env.local`: removes
     `CONVEX_DEPLOYMENT` (guards against accidentally targeting shared dev),
     points `NEXT_PUBLIC_CONVEX_URL` / `NEXT_PUBLIC_CONVEX_SITE_URL` at the
     preview deployment, records `CONVEX_PREVIEW_NAME` and
     `CONVEX_PREVIEW_DEPLOYMENT`, and appends the branch host to
     `CONVOY_AGENT_BROWSER_ALLOWED_HOSTS`.

## URLs

Portless automatically prepends the branch slug for linked worktrees, so
`pnpm web:dev` inside a worktree serves at
`https://<branch-slug>.app.convoy.localhost` with no extra configuration.
`next.config.ts` allowlists `*.app.convoy.localhost` for dev origins and
Server Actions. Clerk uses the shared development instance; `.localhost`
subdomains work without extra Clerk configuration.

## Working in a Worktree

- Start the app: `pnpm web:dev` (allowed in linked worktrees — the
  "never start the dev server" rule protects only the primary checkout).
- After editing `apps/web/convex/` functions: `pnpm worktree:convex:deploy`
  re-pushes to the preview deployment. Preview deployments do not support
  `convex dev` watch mode; redeploy after backend changes.
- Visual verification: the agent browser login endpoint works on the branch
  host, e.g.
  `https://<branch-slug>.app.convoy.localhost/api/agent/browser-login?...`
  (the branch host is appended to the allowed-hosts env var during setup).
- Manual provisioning (if hooks were skipped, or in a devcontainer): `pnpm worktree:setup`.

## Devcontainer

`worktree-setup.mjs` detects a devcontainer by `DEVCONTAINER=true` (set by the
image) and changes four things. Verified in an OrbStack container.

- **Dev access through a dev deploy key.** The container has no `convex login`,
  and must not get one: a login token reaches every deployment the user can
  see, prod included. Setup reads dev with `CONVEX_DEV_DEPLOY_KEY` from
  `apps/web/.env.local`, a deploy key generated on the dev deployment
  with only `env:view`, `data:view`, `backups:view`,
  `backups:create` and `backups:download`, which is enough for `convex export
  --include-file-storage` and `env list`. It refuses any key that does not start with `dev:`,
  and refuses to run in a devcontainer without one. The preview deploy key
  can't reach prod or dev; the Convex API rejects it on both. On a host
  without the key, setup keeps using the personal login.
- **URL.** OrbStack routes `http://<container-id>.orb.local:<port>`
  (container ID = `hostname`) to the container, from the Mac and from inside
  it. Setup picks a free port, writes it to `WORKTREE_DEV_PORT`, and sets
  `NEXT_PUBLIC_APP_URL` to that URL in `.env.local` and on the preview
  deployment. It appends the host to `CONVOY_AGENT_BROWSER_ALLOWED_HOSTS`.
  `next.config.ts` adds the `NEXT_PUBLIC_APP_URL` hostname to
  `allowedDevOrigins`; without it Next answers 403 for `/_next/*` chunks and
  the HMR socket, and the page hangs on "Loading…".
- **Dev server.** `pnpm worktree:dev` runs `next dev -p $WORKTREE_DEV_PORT`
  instead of portless. It never passes `-H 0.0.0.0`: `next dev` already
  listens on all interfaces, and `-H 0.0.0.0` makes `request.url` report
  `0.0.0.0`, which fails the agent browser login host check.
- **Detached worktrees.** A detached HEAD has no branch to name the preview
  after, so the slug falls back to the worktree folder name.

Two fixes apply on hosts too. Every `convex` call drops an inherited
`CONVEX_DEPLOYMENT`, because a process env var beats `.env.local`, and the
container inherits the host's (prod, for the firewall allowlist). And
`env list` passes `--include-values`; when the CLI detects an agent it
otherwise prints names only, and the copy sets no values. CLIs older than
1.49 reject the flag, so setup retries without it; they print values anyway.

## Convex Auth mode

A preview can run the `convex` auth mode ([auth-adapters.md](auth-adapters.md)).
Until S5 (OS-2499) the setup script does not do this for you:

1. Add `NEXT_PUBLIC_AUTH_MODE=convex` to the worktree's `apps/web/.env.local`.
2. Set `AUTH_MODE=convex` and `AUTH_EMAIL_VERIFICATION=off` on the preview
   deployment with `npx convex env set --deployment <preview-name> <NAME> <value>`,
   using the preview deploy key and no inherited `CONVEX_DEPLOYMENT`.
3. Restart `pnpm worktree:dev` and sign up with a new address.

The preview needs no auth secrets, because the deployment signs its own tokens.
The copied `CLERK_JWT_ISSUER_DOMAIN` stays as it is. Users copied from dev have
no Convex Auth password, and a new account does not see the copied
organizations. The agent browser login still uses Clerk, so it does not work in
this mode yet.

## Lifecycle & Limitations

- `wt remove` runs a `pre-remove` hook that kills any process still running
  inside the worktree (dev server, portless wrapper) — the portless route
  deregisters with the process.
- Preview deployments are deleted automatically by Convex 14 days after
  creation; the CLI has no delete command, so there is no backend teardown.
- Data is a snapshot from dev at worktree creation; it does not stay in sync.
- Schema changes deploy like any function push; the imported dev data must
  satisfy the new schema or the deploy fails (same as it would on dev).
- The CLI app (`apps/cli`) still targets whatever its own config points at;
  worktree isolation currently covers the web app + Convex backend.
