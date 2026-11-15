# Local devcontainer shortcuts

Both commands work from the repo root and `apps/web`:

| Command | Config | Deployment |
| --- | --- | --- |
| `pnpm devcontainer` | `.devcontainer/devcontainer.json` | Resolves the mounted Convoy profile; optional `CONVEX_DEPLOYMENT` adds hosts |
| `pnpm sandbox` | `sandbox/.devcontainer/devcontainer.json` | Uses the sandbox config's dev deployment |

Both package scripts call `scripts/devcontainer.sh`. The script resolves the repo
root from its own location and passes absolute workspace and config paths to the
CLI. It runs `devcontainer up`, then opens an interactive zsh session through
`devcontainer exec`. Startup must succeed before opening the shell; CLI failures
propagate to the caller. Closing the shell leaves the container running.

The devcontainer CLI must be installed and Docker must be running. A missing CLI
produces an installation command. A missing config produces its expected path;
the launcher does not create one. The `sandbox/` directory is local and gitignored.

Existing configs control mounts and network access. Default mode does not require
a deployment export: the container resolves its selected profile and allowlists
that backend before applying the firewall. CONVEX_DEPLOYMENT remains an optional
additional deployment. Sandbox mode keeps its own config and caller environment.
