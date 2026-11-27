# Automatic migrations

Every deploy starts the pending data migrations on the deployment it just
updated. Nobody runs `migrations:runAll` by hand.

## The registry

`migrations:runAll` in `apps/web/convex/migrations.ts` is the only list of
migrations, in the order they run. The `@convex-dev/migrations` component
records progress per deployment. A call skips finished migrations, resumes a
partial one, and does nothing while one is running, so calling it after every
deploy is safe.

Rules for whoever edits the list:

- `runAll` always exists and always lists at least one migration. A runner
  with an empty list throws, and that fails every deploy. When the last
  pending migration is finished everywhere, leave it in the list.
  `migrations.test.ts` calls `runAll` the way a deploy does. It fails on an
  empty list, on a migration that does not finish, and on a second call that
  changes the recorded state.
- A migration must be safe to run twice. A deployment whose record is missing
  runs it again. Check each row before patching it.
- `runAll` runs one batch of the first listed migration inside the call and
  schedules the rest. The rest runs in the background, so the code deployed
  with a migration must read both the old and the new shape. The widen,
  migrate, narrow flow already requires that.

## The deploy step

`apps/web/scripts/convexDeploy.mjs` runs `convex deploy`, then
`convex run migrations:runAll` on the same deployment. `pnpm convex:deploy`
in `apps/web` calls it.

- Its arguments go to `convex deploy` only. Choose the deployment with
  environment variables (`CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`,
  `CONVEX_SELF_HOSTED_URL`), from the shell or from `.env.local`, as with the
  Convex CLI.
- It refuses `--env-file`, `--url` and `--admin-key` before deploying. Only
  the deploy would follow them, and migrations would start on another
  deployment.
- A failed deploy starts no migrations and exits with the deploy's code.
- If `runAll` cannot start, the script exits 1. That covers a failed
  `convex run` and a first batch that fails. The runner returns that failure
  as `Status: "Migration failed: ..."` with exit code 0, so the script reads
  the output. A batch that fails later, in the background, does not fail the
  deploy.
- When the script exits 1 for migrations, the backend is already pushed. On
  Vercel the build fails and the previous web build stays live, which the
  widened backend still serves.
- When `runAll` starts, the script prints the command that shows progress:
  `npx convex run --component migrations lib:getStatus`, with `--prod` when the
  deploy went to production through a login or a project key.
- `--dry-run` pushes nothing, so it starts nothing.

The script has to pick the target for `convex run` itself, because
`convex deploy` defaults to production and `convex run` defaults to dev:

| Environment | `convex run` target |
|---|---|
| `CONVEX_SELF_HOSTED_URL` | none needed |
| `CONVEX_DEPLOY_KEY` of one deployment (`prod:`, `dev:`, `preview:<name>`) | none needed, the key names it |
| project key, or a login with `CONVEX_DEPLOYMENT` | `--prod` |
| preview deploy key (`preview:<team>:<project>`) | not run, see below |

## Deploy paths

| Path | How migrations start |
|---|---|
| Vercel production | `vercel-build` calls the deploy step |
| Vercel preview | `--preview-run migrations:runAll`, passed by the deploy step |
| Self-hosted Docker | `self-hosted/start.sh` calls the deploy step inside the `web` image |
| Contributors | `pnpm web:convex:dev` passes `--run migrations:runAll`, which runs once after the first push |
| Worktree previews | `scripts/worktree-setup.mjs` runs `runAll` by deployment name after the snapshot import and after each `deploy` |
| Manual deploy | `pnpm convex:deploy` from `apps/web` |

### Preview deployments

A preview deploy key names a project, not a deployment, so `convex run` has no
target without a preview name. The Convex CLI also runs `--preview-run` only
when it has just created the preview. A Vercel preview therefore runs
migrations on its first deploy and not on later pushes to the same branch. A
new preview starts empty, so this only matters for data created in the
preview before a later commit added a migration. Run it by hand then:

```bash
npx convex run --preview-name <branch> migrations:runAll
```

Worktree previews hold a copy of dev data, so `worktree-setup.mjs` does not
rely on `--preview-run`. It knows the deployment name and starts
`convex run --deployment <name> migrations:runAll` through the deploy step's
`startMigrations`, with the same first-batch check.

## What the automatic path leaves out

- No dry run on production. The migration's tests and its run on the dev
  deployment replace it. A maintainer can still dry-run a risky migration by
  hand before pushing.
- No waiting. The step reports that migrations started, not that they
  finished. OS-2618 makes `start.sh` wait.
- No `verify*` queries. They stay the maintainer's check before a narrowing
  commit.
- No `convoy` CLI command (hard rule 19). This is deploy tooling for operators,
  run through `pnpm` and `start.sh`, not an action inside the product.

Public docs: `apps/docs/content/docs/operations/migrations.mdx`.
