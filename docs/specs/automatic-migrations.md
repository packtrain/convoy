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
| Self-hosted Docker | `self-hosted/start.sh` calls the deploy step inside the `web` image, then waits for the migrations |
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

## Upgrade stops

A narrowing commit fails `convex deploy` on any install that has not run the
migration it depends on, and that migration ships with the failed deploy. An
install that skips from before the widened commit to after the narrowing one
is stuck. An upgrade stop is a git tag on a commit such an install must deploy,
and wait on, before going further.

### The rule

Before a commit that narrows the schema lands on `main`, tag the `main` commit
it lands on. Narrowing means stored data might no longer fit: a field or union
value removed, a field made required, a type made stricter.

```bash
git tag -a upgrade-stop-YYYY-MM-DD <commit> -m "Upgrade stop before <what narrows>"
git push origin upgrade-stop-YYYY-MM-DD
```

- The tag must be on `main`: `upgrade.sh` only follows tags merged into
  `origin/main`. A squash-merged pull request lands on main's tip at merge
  time, so tag that commit, not the branch's parent.
- Use the UTC date. A second stop on the same day gets `-2`, then `-3`.
  `upgrade.sh` sorts with `version:refname`, so `-10` sorts after `-9`.
- Annotated tags only (`-a`), so `git push --follow-tags` carries them.
- A migration may leave the `runAll` list once a stop exists at a commit that
  lists it. Every install past that stop has waited for it to finish. Keep
  one entry in the list (see [The registry](#the-registry)).
- The first stop is the commit that added `upgrade.sh`, so every stop has
  the script and the wait.

### The wait

`start.sh` starts the web app, then runs `apps/web/scripts/waitForMigrations.mjs`
inside the `web` image. It polls `migrations:runAllStatus`, which reports each
`runAll` migration in order, with `unknown` for one the series has not reached
yet. The component's `lib:getStatus` lists only migrations that have started,
so between two migrations it would look finished.

- It exits 0 when every migration is done.
- It exits 1 naming a migration that failed or was canceled, and `start.sh`
  fails with it.
- It exits 1 when three polls in a row find nothing running and a migration
  still pending. One idle poll is normal: the next migration is scheduled, not
  yet started.

### `upgrade.sh`

`self-hosted/upgrade.sh` replaces `git pull` for Docker installs:

1. Refuse to run with uncommitted changes to tracked files.
2. `git fetch --tags origin`.
3. For each tag from
   `git tag --merged origin/main --no-merged HEAD --list 'upgrade-stop-*' --sort=version:refname`,
   check it out and run `start.sh`.
4. Check out `main`, fast-forward to `origin/main`, run `start.sh`.

A failed `start.sh` stops the script and leaves HEAD detached at that stop.
`--no-merged HEAD` would then skip it, so a run that starts detached deploys
the stop at HEAD first. The body is one function called on the last line,
because the checkout rewrites the file while bash is reading it.

When the deploy step fails, `start.sh` prints a pointer to `upgrade.sh` and
the "Upgrade stops" section of the public upgrading doc. Installs on Vercel
and Convex cloud deploy each stop tag by hand, as that section describes.

## What the automatic path leaves out

- No dry run on production. The migration's tests and its run on the dev
  deployment replace it. A maintainer can still dry-run a risky migration by
  hand before pushing.
- No waiting on Vercel or in `pnpm convex:deploy`. They report that
  migrations started, not that they finished. Only `start.sh` waits (see
  [Upgrade stops](#upgrade-stops)).
- No `verify*` queries. They stay the maintainer's check before a narrowing
  commit.
- No `convoy` CLI command (hard rule 19). This is deploy tooling for operators,
  run through `pnpm` and `start.sh`, not an action inside the product.

Public docs: `apps/docs/content/docs/operations/migrations.mdx`.
