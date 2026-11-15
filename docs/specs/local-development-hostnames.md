# Local Development Hostnames

## Purpose

Define the stable local hostnames used by Convoy development servers when they run behind Portless.

## Canonical Hosts

- The main web app runs at `https://app.convoy.localhost`.
- The docs app runs at `https://docs.convoy.localhost`.
- The landing page runs at `https://convoy.localhost`.

## Startup Rules

- Workspace dev scripts should use `portless run --name <name> ...` so local URLs stay stable without manual port management.
- The main web app uses `app.convoy` as its Portless name.
- The docs app uses `docs.convoy` as its Portless name.
- The landing page uses `convoy` as its Portless name.

## Developer Experience

- Root workspace scripts should expose app-specific dev entrypoints so contributors do not need to remember package names.
- README setup docs should list the hostname each local app is expected to serve.

## Notes

- Portless may prepend a worktree branch prefix automatically for linked git worktrees.
- If Portless is running on a non-default proxy port, the same hostnames remain valid but may need an explicit port in the browser URL.
