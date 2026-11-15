# Convoy project environment

This template is for the OS-1958 implementation. Runtime and Docker/VM acceptance
are still pending. Projects run Codex, Claude Code, Cursor or OpenCode when a root-owned binary is
installed; the launcher checks at each start. Do not use it for sensitive projects
until the acceptance procedure passes.

## Install

Run `convoy devcontainer ~/Convoy --projects` on the host, then open `~/Convoy`
with Dev Containers. That folder is the parent mount, so adding another project
does not require rebuilding. The default `convoy devcontainer` template remains
the single-repository template.

The image needs the selected CLI version to be published. For testing unpublished
code, install a locally packed build under `/opt/convoy` as root and use the Linux
setup below. Do not point the privileged launcher at a mutable development checkout.

The state volume holds stable UID reservations and each project's private HOME.
The control volume holds local registrations. Preserve both volumes and the
workspace when recreating the container. Never reuse project UIDs for other OS
accounts or delete the identity registry while retaining project files.

The template requires Linux ownership enforcement and unprivileged user
namespaces. Docker Desktop mounts or a Docker seccomp policy can prevent these.
Registration fails in that case. Use Linux storage and an environment that
supports bubblewrap; do not work around it with a privileged container or by
disabling isolation. This template does not install a custom Docker seccomp policy.

## Linux VM setup

For the complete VM walkthrough, including Ubuntu AppArmor and Codex login,
see [Isolated projects on Linux](https://docs.convoy.build/docs/cli/isolated-projects).

Use a dedicated machine or account with Node 22, Python 3, bubblewrap, sudo, Git, util-linux
and the selected runtime CLIs. Install the Convoy package under a root-owned
prefix, for example `/opt/convoy`. Install runtime executables under `/usr/local`
with root ownership. Create a parent workspace owned by the control account,
without group/world write access.

Run the bundled installer as administrator:

```sh
sudo python3 -I /opt/convoy/node_modules/@useconvoy/cli/dist/templates/project-isolation/install.py \
  --control-user convoy --workspace /srv/convoy-workspaces \
  --package-root /opt/convoy/node_modules/@useconvoy/cli --node /usr/local/bin/node
```

The control user gets permission to invoke a restricted launcher. Agents cannot
invoke it. The launcher switches identity before starting bubblewrap, Git,
shells or the network-facing Convoy worker. It supplies no host environment,
runtime configuration, SSH agent, Docker socket or control credentials.

## Register and run

Create a Convoy API key restricted to exactly one project in the web app. Run
`convoy project add a` to enter the deployment, key and accessible project.
The command returns without starting a connection. Complete non-interactive use:

```sh
convoy project add a --url https://example.convex.cloud \
  --api-key "$PROJECT_A_KEY" --project "$PROJECT_A_ID" --profile-key a --non-interactive
convoy project list
convoy project login a --runtime codex
convoy connect --profile a
```

Use another terminal for B. Ctrl+C stops the direct connection and its workers.
`convoy project remove b --yes` unregisters stopped B and keeps all files and
private state. Stop any connection or project shell before removal.

The last profile's removal disables that identity in the launcher. Removing
one of several aliases retains execution for the remaining profiles. Re-adding
the project re-enables its existing UID. Pending preparations appear in
`project list` with their path and allocated UID; an administrator can inspect
them before an explicit ownership migration. Retry the original registration
after repair. The audit and original clone source apply even if flags are
omitted on retry.

`convoy connect --profile a --name vm-a` preserves the connection name.
If a stale backend session conflicts, stop its owner or explicitly retry with
`--force`. Workers never prompt or take over automatically. Ctrl+C closes the
worker control pipe to release claims and disconnect, with a 30-second limit
before forced sandbox termination.

`--clone https://github.com/owner/repo.git` clones into a new folder without
inheriting host Git credentials. For private repositories, register an empty
folder, enter its project shell, authenticate Git there and clone into `.`.
`--reuse` accepts only a directory already owned by the allocated project UID/GID
with mode 0700 and project-owned files without hard links. It never changes
existing checkout ownership. Prefer a new clone; ownership migration is an
explicit administrator operation and should preserve a backup.

Profile keys remain local selectors. The existing `--project` connection flag
keeps its project-ID override meaning; use `--profile` for these registrations.
The plural `convoy projects list` still lists remote projects.

## Network and credentials

Strict mode is the container default. Set `CONVEX_DEPLOYMENT` for the backend,
or append self-hosted backend and clone domains to
`DEVCONTAINER_EXTRA_ALLOWED_DOMAINS`. After changing allowlists, run
`sudo /usr/local/bin/init-firewall.sh` with the updated variables in the
container. Include authentication endpoints needed by your selected runtime.
Codex or Claude Code on a managed AWS key calls `bedrock-mantle.<region>.api.aws` (Mantle) or
`bedrock-runtime.<region>.amazonaws.com` (Bedrock Runtime). `convoy keys add
--env <name>` allows that host itself; add it by hand when you add the key
inside the container. The direct VM workflow uses the VM's existing network
policy.

Projects share the environment's network namespace. Do not expose unauthenticated
local services or VM instance-role credentials to that network. File isolation
does not protect a token served over TCP. Projects have separate authentication
files, but signing them into the same provider account does not create separately
scoped provider credentials.

## Acceptance procedure

Use a disposable environment with two test projects and non-sensitive credentials.
The launcher runs only the runtimes Convoy has tested in the boundary, `codex` and
`claude-code`, and only from root-owned binaries. `install.py` prints its sandbox
check and the detected runtimes. Both Codex transports need testing.

1. Register A and B and enter their shells. Record `id`, `/proc/self/status`,
   workspace ownership and HOME. Check distinct UIDs, empty supplementary groups,
   zero capabilities and `NoNewPrivs: 1`.
2. In A, write a marker, use symlinks toward B and the control HOME, and verify
   reads/writes fail. Verify B's processes and control sockets are absent. Test
   hard-linked input is rejected during reuse and a second A shell/connection
   cannot acquire the lease.
3. Install one runtime in the disposable setup. Run real agents in A/B,
   including shell commands, file edits, helpers, worktrees and a resumed thread.
   Verify legitimate work succeeds and cross-project access still fails.
4. Cancel a run, close the terminal, kill the control process and kill the launcher
   in separate runs. From the host, verify no project descendants remain.
5. Add C without rebuilding. Stop/remove B, verify its files remain and re-add it
   with the same UID. Recreate the container preserving volumes and repeat.
6. Repeat on a configured Linux VM and record runtime/tool versions, mount type,
   kernel, namespace restrictions and any exposed local network endpoints.

Current evidence is limited to automated policy and command tests. No runtime,
bind-mount or direct VM combination is certified by this change yet.

Malformed TOML stops config operations. Repair the file before retrying. CLI
mutations use `config.toml.lock`; after a crashed writer, verify no writer remains
before removing that lock directory. Project execution leases use kernel locks
and release when their owner exits.

## Browser automation

The image preinstalls a pinned upstream `@playwright/cli` release (the Dockerfile's
`PLAYWRIGHT_CLI_VERSION` build arg), matching Chromium and OS libraries. Use
`playwright-cli` on PATH, independently of the Convoy CLI.
The configuration below selects image-installed headless Chromium and explicitly
disables its inner sandbox inside this dedicated container. Container/project
isolation and the firewall remain in force. Do not copy this sandbox setting to
an ordinary host.

```bash
playwright-cli -s=ui open --config=/usr/local/share/playwright-cli/config.json
playwright-cli -s=ui goto <url>
playwright-cli -s=ui set-color-scheme light
playwright-cli -s=ui screenshot --filename=/tmp/page-light.png
playwright-cli -s=ui set-color-scheme dark
playwright-cli -s=ui screenshot --filename=/tmp/page-dark.png
playwright-cli -s=ui close
```

Run inside the private project shell or agent when using project isolation.
Use a unique session name for concurrent work and close that session when done.
Profiles and session state belong to the invoking project; no host profile is
imported. Color preference does not override a site's saved theme. Use upstream
click and scripting commands for application-specific controls.

Browser updates require an image rebuild. Updating Convoy does not install or
update browsers. CLI 0.128.0 removes all `convoy browser` commands; rewrite old
scripts to use the upstream CLI. Existing profiles are left untouched, without
automatic migration. A managed environment's legacy browser cache volume is no
longer mounted and goes away with `environment delete`.

## Keep registered projects running

After authenticating the runtimes and closing project shells, run these as the
control account inside the environment:

```bash
convoy service start --background
convoy service status
convoy service logs --follow
convoy service stop
```

Closing a log viewer or the starting terminal leaves background work running.
Explicit stop drains all workers and retains data. CLI 0.68.0 applies new
registrations without restarting siblings. Remove a live project with
`convoy project remove c --yes --interrupt`. For runtime login, run
`convoy project login c --runtime codex`; it pauses C, runs the login and reloads C. See the [persistent service guide](https://docs.convoy.build/docs/cli/project-service)
for A/B verification, retained logs and failure recovery.

## Managed Codex API keys

CLI 0.71.1 adds control-account key storage and project assignments. This image
includes the credential-capable launcher and Codex 0.156.1. Existing VM installs
must refresh the privileged launcher after installing the new CLI. Preserve
control/project-state volumes when rebuilding. See the
[provider-key guide](https://docs.convoy.build/docs/cli/provider-keys) for commands
and the VM/devcontainer acceptance sequence. Manual project shells keep native auth.


### Create a project from the CLI

See the [project creation and recovery guide](https://docs.convoy.build/docs/cli/isolated-projects)
for creating or attaching projects, manual setup keys, and service commands.

## Managed host workflow

CLI 0.75.0 adds `convoy run --environment dev` and explicit `--environment` routing
for project, service and attachment commands. It builds this
bundled template through Docker with labeled Linux volumes, a custom seccomp
policy for nested bubblewrap, and a host-only root lifecycle helper. See
[Managed local environments](https://docs.convoy.build/docs/cli/managed-environments)
for setup, runtime login, updates, recovery and acceptance commands.
The manual Dev Containers workflow above remains available.

## Upgrading to CLI 0.118.0

The launcher runs OpenCode as a tested runtime and accepts managed OpenCode
keys (`credentials-opencode-v1`). This image installs `opencode-ai@1.19.5`
root-owned. On a VM, install the new CLI, rerun `install.py` with the same
arguments, and install OpenCode as in the
[isolated projects guide](https://docs.convoy.build/docs/cli/isolated-projects#install-opencode).
Until then, assigning a key to OpenCode is refused; other keys keep working.
Every OpenCode server now needs a password, so reload projects that run
OpenCode. A CLI older than 0.118.0 cannot read `project check` from this
launcher, so upgrade both together.

## Upgrading to CLI 0.117.0

The launcher runs Cursor Agent as a tested runtime and accepts managed Cursor
account keys (`credentials-cursor-v1`). This image installs Cursor Agent
2026.10.22-27dcf5f root-owned in `/usr/local/lib/cursor-agent` (amd64 and
arm64). On a VM, install the new CLI, rerun `install.py` with the same
arguments, and install Cursor as in the
[isolated projects guide](https://docs.convoy.build/docs/cli/isolated-projects#install-cursor). Until then, adding or assigning a Cursor key is refused; other keys keep
working. A CLI older than 0.117.0 cannot read `project check` from this
launcher, so upgrade both together.

## Upgrading to CLI 0.115.0

The launcher accepts managed Anthropic API keys for Claude Code
(`credentials-anthropic-v1`). On a VM, install the new CLI and rerun `install.py`
with the same arguments. In a managed Docker environment, run Update CLI. Until
then, adding or assigning an Anthropic key is refused; other keys keep working.

## Upgrading to CLI 0.111.0

The launcher now records who holds a project lease, tells the service why a
worker could not start, and answers `convoy project check`. On a VM, install the
new CLI and rerun `install.py` with the same arguments. In a managed Docker
environment, run Update CLI. An older launcher still runs projects; only
`project check` and the new service warnings need the update.

## Upgrading to CLI 0.110.0

The launcher now detects runtimes at each start, creates `~/.codex` and `~/.claude`
in each project HOME, and runs `project login`. `verified_runtimes` is ignored and
`environment verify` is gone. On a VM, install the new CLI and rerun `install.py`
with the same arguments. In a managed Docker environment, run Update CLI.
Registrations, credentials and project files stay in place.

