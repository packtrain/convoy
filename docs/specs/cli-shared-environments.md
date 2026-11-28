# Shared environments

OS-2242, CLI 0.127.0. An environment runs its projects in one of two modes.
**Shared** is the default: every project runs as the account that installed
the CLI, in that account's HOME, one folder per project. The user logs in to
`gh`, git and each agent runtime once. **Isolated** is the opt-in mode from
[project isolation](cli-project-isolation.md): a Linux UID, bubblewrap sandbox
and private HOME per project, installed by an administrator.

Shared mode has no boundary between projects. An agent in one project can read
another project's files and use the same logins. It suits a personal laptop,
dev box or VM. Isolated mode is for machines where projects must not see each
other.

Shared mode runs on macOS and Linux. Windows is unsupported and says so.

## Mode

The mode is fixed when the environment is created. There is no in-place switch:
the two modes leave different state on the machine (launcher, per-project UIDs,
folder ownership, per-project runtime logins). To change mode, delete the
environment and create a new one. On a self-managed machine, the CLI prints
what the new mode needs, for example the root installer for isolated mode.

The Local target stores `~/.convoy/environment.json`, `{ "schema": 1, "mode":
"shared" | "isolated" }`, owner-only and never a symlink, with the same checks
as the managed record. The first `service start` or `project add` writes it.
A machine with `/etc/convoy-projects.json` and no record is isolated, so
existing VMs and managed containers keep their behavior without migration. A
machine with neither is shared.

### Choosing the mode on Local and SSH targets

Isolated mode needs Linux (bubblewrap and user namespaces). On macOS the mode is
always shared, and the CLI offers no choice; for isolation on a Mac, use a
managed Docker environment.

On Linux, the first `project add` or `service start` on Local, and `remote add`
for an SSH target, ask for the mode, with Shared selected by default (CLI
0.140.0, OS-2252). The choice appears only while the environment has no mode
record, no launcher registry (`/etc/convoy-projects.json`, which already means
isolated), no registered projects, and is not a managed Docker image. Choosing
Isolated:

1. Checks the prerequisites before changing anything and prints each result:
   bubblewrap installed, unprivileged user namespaces allowed (an unprivileged
   `bwrap --unshare-user` probe; when it fails and
   `kernel.apparmor_restrict_unprivileged_userns` is 1, the fix is the AppArmor
   profile), the running Node root-owned and outside `/home`, `/root` and
   `.nvm`, and the running CLI root-owned under `/opt/convoy`. Each missing
   item is reported with what went wrong and its fix. A closing line says
   nothing was installed, the machine is still shared, and links
   [troubleshooting](https://docs.convoy.build/docs/cli/troubleshooting#isolated-mode-prerequisites).
2. Runs `sudo install -d` for the workspace `/srv/convoy-workspaces`, owned by
   the current account, then `sudo python3 -I install.py` with this account as
   control user and the running CLI and Node. Sudo prompts in the terminal, or
   over `ssh -t` for a remote. The installer's output is printed afterwards.
3. Saves `mode: "isolated"` to the environment record after the installer
   succeeds. A failed or cancelled install leaves the machine shared, with no
   record written, so the next run asks again. `install.py` writes
   `/etc/convoy-projects.json` last, after the sudo rule, so a failure after
   that write (such as in its diagnostics) leaves a finished launcher: the CLI
   then saves isolated and says so.

The choice is checked again before the install, and the record is created with
an exclusive link, never replaced. A prompt left open while another command
fixed the mode fails with "already <mode>". From before the sudo prompt until
the record is saved, Isolated holds `~/.convoy/environment.claim` (its PID,
linked into place). Any other command that would save a mode meanwhile fails
with "Another convoy command (PID n) is installing isolated mode". A claim whose
PID is no longer running, as after Ctrl+C at the sudo prompt, is stale and is
taken over.

Choosing Shared saves `mode: "shared"`. Non-interactive callers pass `--mode
shared|isolated` to `project add`, `service start` or `remote add`; without it
the mode is shared. Once the choice is closed, `--mode` must match the fixed
mode, and on macOS `--mode isolated` fails with a pointer to managed Docker.

`convoy service mode [--mode <mode>]` prints the mode, asking first while the
choice is open. `remote add` runs it on the target over `ssh -t` after saving
the target, when the terminal is interactive or `--mode` is given, so the
remote CLI decides whether to ask. A target CLI older than 0.140.0 cannot set
the mode: with `--mode`, add saves the target but fails with the update
command; without it, add prints a note. If the remote setup fails, the target stays saved and the error
names `convoy service mode --remote <name>` for a retry. The TUI's Start action
never asks; on a fresh machine it saves shared, as a non-interactive `service
start` does.

Guard: when config.toml holds isolated registrations (`project_isolation`) but
the launcher registry is missing, the service and project commands fail with a
configuration error. They never run those registrations as shared. `project
remove` still works: without a launcher it only deletes the profile. A record
that says `isolated` without the registry also fails `service start`.

One mode per environment. A shared service never runs isolated registrations,
and an isolated service never runs shared ones.

Managed Docker records gain `mode`; a missing value means `isolated` (CLI
0.134.0). CLI 0.139.0 builds
[shared Docker environments](#shared-managed-docker-environments) and writes
`mode` on every new record.

## Registrations and profiles

A shared registration is a profile with `project_mode = "shared"` and
`project_organization = "<org id>"`. Its identity is `projectIdentity(url,
organization, project)`, computed, never stored. `project_isolation` keeps
meaning "the launcher owns this profile". The legacy profile and path mutations
are refused for both kinds; use `convoy project`.

Existing ordinary profiles from `convoy connect` are not started by the service.
Only shared registrations are eligible. Registering a project is an explicit
action (`project add` or Add project in the TUI). OS-2241 later makes an
environment available in all the owner's projects by default.

## Registration

`project add <path>` in a shared environment resolves `<path>` against the
current directory, refuses traversal and overlap with another profile or its
`-worktrees` folder, and creates the folder, reuses an existing one (no
`--reuse` needed) or clones over HTTPS as the current user; a clone target must
be missing or empty. The path is saved with symlinks resolved through its
deepest existing folder, so overlap checks compare physical folders. Aliases of
one project (more profile keys for the same identity) must use the same folder;
add refuses another one, and the service refuses a config that has one. There is no workspace root and no ownership
audit. The key is used as given: any scope that can see the project is
accepted, and no worker key is minted. Registration then follows
[live registration](cli-service.md#live-registration-os-1960): `project.add`
when the service is reachable, otherwise an offline save. `project list` shows
shared rows without a UID. `project remove` never calls the launcher, and files
remain. Repeated identical adds are idempotent.

## Execution

The service spawns a shared worker directly: `node worker.js` as the control
account, cwd `/`, environment limited to `HOME`, `PATH`, `LANG` and `TERM`, the
launch frame on stdin with `mode: "shared"`. The runtimes' config homes,
`CODEX_HOME` and `CLAUDE_CONFIG_DIR`, pass through from `service start` to each
worker when set (CLI 0.134.1, OS-2250), so the service's runtimes read the same
config as a foreground connect. `CONVOY_ANTIGRAVITY_EXECUTABLE` passes the same
way (CLI 0.158.0, OS-2474), so a service worker runs the agy that `project
check` and `project login` resolved. The devcontainer template depends on this: its
private `CODEX_HOME` keeps the Codex state database off the host mount. Other
provider variables, such as the Bedrock token, do not pass; a project under the
service gets them from [managed credentials](#credentials). Antigravity needs no
variable: agy 1.5.14 keeps its state under `HOME/.gemini` and ignores
`GEMINI_HOME` and `ANTIGRAVITY_GEMINI_DIR`, verified by opening ACP sessions
with each set (OS-2474). So `GEMINI_HOME` is not passed, and the model
inventory deletes its session files from `HOME/.gemini/antigravity-cli`.

In shared mode, `PATH` is the one the service was started with: the shell that
ran `convoy service start`, or the TUI process. The service records it at start
and passes it to every worker, so runtimes installed through Homebrew, nvm,
npm's global folder or `~/.local/bin` are found, as with an ordinary `convoy
connect`. Over SSH, the remote command runs through the user's login shell so
their profile's `PATH` applies. Isolated mode keeps the fixed
`/usr/local/bin:/usr/bin:/bin`. The rest is the launcher contract:
one bounded frame, stdin EOF for graceful shutdown, JSON sidecar events, exit
codes 0/1/3, retries, pending/reload, pause and the 128-identity limit. The
worker skips the Linux boundary check and the private profile write, and
verifies only that its key can see the project.

### Locks

The service lock and the per-project execution lease use a lock implemented in
the CLI, not `/usr/bin/flock`, which macOS lacks. A lock file is created
exclusively and holds the holder's PID and role (`service`, `connect`, `shell`,
`login`); a shared shell or login takes no lease. A lock whose PID is no longer running is stale and may be taken over.
The file also records the process start time (`/proc/<pid>/stat` on Linux, `ps
-o lstart` on macOS), so a PID reused after a reboot or container restart counts
as stale. The file is written whole and linked into place, so a reader never
sees a partial holder. A takeover first claims the stale file's inode with an
exclusive `<lock>.<inode>.reclaim` file, then deletes the lock only if it still
has that inode and content, so a contender that read it earlier never deletes
the next owner's lock. A claim left by a crashed process is reported with the
path to delete. A lock file without a readable holder, such
as the empty `owner.lock` an older CLI left for flock, is stale.
Leases live at `~/.convoy/service/leases/<identity>.lease`. A second owner
fails with `project-active` and the same holder text as the launcher. A
foreground `connect --profile <key>` for a shared registration takes the same
lease and otherwise behaves as an ordinary connection.

### Runtimes and logins

Runtimes are detected on `PATH`, as for an ordinary `convoy connect`; there is
no trusted-path rule. Login status comes from the runtime's own status command
where one exists (for example `claude auth status --json`), because a login file
can be absent while the runtime is logged in (Claude Code keeps credentials in
the macOS Keychain). When the CLI cannot tell, status is `unknown`, never
`logged out`. Codex (`codex login status`) and Claude Code (`claude auth status
--json`) have status commands, run with the launcher's 8-second deadline and
16 KiB cap; Cursor, OpenCode and Antigravity always read `unknown`. agy has no
status command, so for it the check runs only `agy --version`, with the same
deadline, on the executable the worker resolves (`CONVOY_ANTIGRAVITY_EXECUTABLE`,
then `agy`, then `antigravity`). A version below `MIN_ANTIGRAVITY_VERSION`
(1.5.12) reads "Antigravity 1.5.11 is older than Convoy supports". A failed
probe reads "Antigravity did not report its version". Both have the fix `agy
update` or the install script. Such an agy counts as not installed for the
check's failure rule and for the worker's runtime list, since the worker would
not advertise it (CLI 0.158.0, OS-2474). `project check <profile>`
runs in-process (CLI 0.131.0, OS-2247): each runtime installed and logged in,
the lease holder and the backend probe. There is no sandbox row, an `unknown`
login is a skipped row, not a failure, and install fixes name `npm install -g
<package>` (Cursor: its own install script; Antigravity: `curl -fsSL
https://antigravity.google/cli/install.sh | bash`, which installs to
`~/.local/bin`) without `sudo`. A shared worker
started by the service runs the same status commands before its `connecting`
event and lists installed and logged-out runtimes in it, so the service shows
a "not logged in" warning: "Codex is not logged in on this account. Run `codex
login --device-auth` once for all projects." The check's fix names the same
command, and the TUI summarizes either wording as "Needs sign-in". A foreground
`connect` skips the status commands. The check creates no files; a missing
service or lease folder reads as a free lease.

`project shell <profile>` opens `$SHELL` (else `/bin/sh`) in the project folder
with the user's own environment and inherited stdio; its exit status is not an
error. `project shell --login <runtime>` and `project login` run the runtime's
own login command (`codex login --device-auth`, `claude auth login`,
`NO_OPEN_BROWSER=1 cursor-agent login`, `opencode auth login`, `agy acp
--login` with the resolved agy, spawned directly) in the user's
HOME, through `/bin/sh -c 'exec /usr/bin/env …'` so the runtime replaces the
shell and a cancelled TUI stops it. A login applies to every project in the
environment. Neither takes the project lease, pauses the project or reloads it
afterwards (CLI 0.133.0, OS-2248): Claude Code picks up new tokens without a
reload, and Codex is unverified, so `project login` and the TUI say the login
applies to every project and point to Reload. `project account` reads the same
status commands as `project check`.

On a shared Local target the TUI runs Shell without a pause or a confirmation,
since nothing is interrupted. Since CLI 0.169.0 (OS-2502) the TUI's Sign in sits
on each runtime row in Details: it confirms, runs the login once,
then reloads every project so each worker reports the new login
([Runtimes in Details](cli-tui.md#runtimes-in-details-cli-01690-os-2502)). The
worker's `connecting` event also carries the full login map (`logins`), not only
the logged-out list. Other targets learn their mode in a later
slice and keep the isolated flow until then.

`service start` runs in any shared environment as a non-root user. It owns the
lock and private socket under `~/.convoy/service`. Status, subscribe snapshots
and `inspect` carry the service's `mode`, and each `inspect` profile carries its
own (CLI 0.134.0, OS-2249). A service from an older CLI omits it. The service
advertises `local-shared-v1`.

### Start at login on macOS

`convoy service enable` (CLI 0.141.0, OS-2255) writes a per-user LaunchAgent,
`~/Library/LaunchAgents/build.convoy.service.plist`, mode 0644, that runs
`convoy service start` in the foreground at each login. Nothing installs it
silently. It holds the running Node and CLI paths as absolute paths, plus
`PATH`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `CONVOY_ANTIGRAVITY_EXECUTABLE`
from the shell that ran enable,
because launchd starts jobs with a minimal environment. Enable starts nothing
now. `convoy service disable` deletes the file and leaves a running service
alone.

The job sets `RunAtLoad`, `ProcessType` `Interactive` (an unset type lets
launchd throttle CPU and I/O, which slows agent builds) and no `KeepAlive`. A `KeepAlive` job would restart
after `service stop` or every 10 seconds while a manual start holds the service
lock. If the service crashes, it comes back at the next login. The service keeps
its own lock, socket and log retention; launchd discards the start command's
output, so diagnose a failed start by running `convoy service start` by hand.

Each `service start` on macOS rewrites an existing LaunchAgent whose paths or
environment differ from its own. After a CLI update or a Node version switch,
the next start or TUI Start keeps the login job pointing at the current binary.
Run `convoy service enable` again to refresh it without starting the service.

Enable refuses managed Docker environments, which
[restart with Docker](cli-environments.md#restart-after-a-reboot-cli-01410).

### Start at boot on Linux

On Linux (CLI 0.174.0, OS-2466) `convoy service enable` writes a systemd user
unit, `~/.config/systemd/user/convoy.service`, mode 0644, and runs `systemctl
--user enable convoy.service`. The unit holds the same command and environment
as the LaunchAgent, `WantedBy=default.target`, and no `Restart=`, for the same
reason the LaunchAgent has no `KeepAlive`. It sets `KillMode=mixed`: the default
`control-group` sends SIGTERM to every worker at once on `systemctl --user stop`
or shutdown, which skips the service's ordered stop. With `mixed` only the CLI
gets SIGTERM, and systemd sends SIGKILL to what is left after `TimeoutStopSec`.
Enable starts nothing now. If `systemctl --user enable` fails, typically for a
missing user bus under `su` or `sudo`, enable deletes the file and says to run it
from an SSH or console login. `convoy service disable` runs `systemctl --user
disable` and deletes the file; a running service keeps running.

The user manager starts at boot only when lingering is on for the account.
Turning it on needs root, so enable never does it. It reads
`/var/lib/systemd/linger/<user>` (the user from `$USER`). When that file is
missing, the user manager starts only at a login with no other session open and
stops at the last logout, taking the service and its runs with it. Enable says
so and prints `sudo loginctl enable-linger <user>`. With lingering on, an enrolled
VM comes back online after a reboot without anyone logging in.

Enable refuses a machine without a running systemd (`/run/systemd/system`
missing), such as a devcontainer. `service start` refreshes an existing unit as
it does the LaunchAgent; systemd reads the new file at the next boot or `systemctl
--user daemon-reload`. Journald keeps the start command's output: `journalctl
--user -u convoy`.

## Credentials

A shared environment manages keys with the same owner-only store as an isolated
one, `credentials-v1.json` beside config.toml ([managed
keys](cli-provider-keys.md#managed-openai-keys-for-isolated-codex-os-2015)),
since CLI 0.133.0. `keys add --auth api-key`, `rotate`, `rollback`, `disable`,
`remove` and `status` work as they do there. `keys use <name> --runtime
<runtime> --profile <profile>` assigns an entry to one shared registration;
`keys unassign --runtime <runtime>` disables the runtime, and `--native-login`
returns it to this account's own login. Bindings key on the registration
identity, so aliases share them. A project without a binding uses the account's
own login. A running service applies a change through `credentials.mutate`;
without one, the CLI writes the store directly. Either way, a running project
picks up the change after `service reload --profile <profile> --interrupt` or
TUI Reload. The service advertises `credentials-shared-v1`. A shared service
started by an older CLI lacks it, so `keys` and the TUI refuse the change and
say to restart the service.

The service reads the store with the registrations. Each shared worker's launch
frame carries only its own assignment, delivered as in isolated mode: Codex
through ephemeral auth storage, Claude Code, Cursor and Antigravity through
their process environment, OpenCode through `OPENCODE_CONFIG_CONTENT`. A managed
run never writes the user's `~/.codex` or `~/.claude` logins. A managed
Antigravity run does record its auth method, `gemini-api-key`, in the account's
`~/.gemini/antigravity-cli/cache/acp-auth-state.json`, though not the key; see
[managed Gemini keys](cli-provider-keys.md#managed-gemini-keys-for-antigravity-os-2476). A foreground `connect
--profile <shared>` reads the same binding and, like an isolated direct
connect, refuses `--codex-exec` with a managed Codex key. A runtime with a
managed key is not reported as logged out.

An assignment chooses which key a project's agent uses and who pays for it. It
is not a secret boundary: every project runs as the same account and can read
the store. For the same reason, there is no launcher capability check, and
`remove` does not wait for running projects. A running project keeps a removed
key until it reloads.

`--env` and `--remote` targets keep their own store. Legacy `[keys.*]` entries
and `provider_key` keep working on ordinary profiles. Shared registrations
refuse `provider_key`, as isolated ones do, and `keys use --runtime codex|claude-code`
on a shared registration writes the managed store instead. The store folder
must be 0700 when the store is first created; on a machine where
`~/.config/convoy` is wider, the error says which `chmod` to run.

In the TUI, a shared Local target has the Credentials editor and Runtime access
of an isolated one. The native choice reads "Native login (this account)".
Restoring it offers Reload, not a login, because the account's login already
exists.

Workers use the profile's API key directly. On an enrolled machine
([user environments](cli-user-environments.md#existing-profiles)) shared
registrations run on the environment key instead, and isolated profiles keep
one worker key per project, minted from it.

## Devcontainer template

The public template no longer bind-mounts the host's `~/.config/convoy` (CLI
0.134.1, OS-2250). Named volumes hold `~/.config/convoy` and `~/.convoy`, so
profiles, keys and service state survive a rebuild, and the container is its
own shared environment. `postStartCommand` runs `convoy service start -b` last,
after the firewall, at every container start and with or without registrations,
so `project add` always reaches a running service. A failed start prints a
`WARN:` line and never blocks startup. A shared mount would let a container service write
container paths into the host's `config.toml`. The template README says how to
connect the checkout with `project add`, or with `convoy setup`. In strict mode the firewall needs `CONVEX_DEPLOYMENT` (or an extra
domain) before the first setup, because there is no profile yet to supply the
backend hosts. Existing containers keep their mounts until the user installs
the new template with `convoy devcontainer --force` and rebuilds.

## Shared managed Docker environments

OS-2251, CLI 0.139.0. A managed Docker environment can run in
shared mode: one container account and home for every project, native logins,
no launcher. It can also mount host folders, so agents work on the files the
user sees on the host.

### Creating one

`convoy run --env <name>` creates a shared environment when no mode is given,
as on Local. `--mode isolated` asks for isolation. The TUI's Add environment
shows the Project separation radio from [cli-tui.md](cli-tui.md), with Shared
selected. The record stores `mode` like `networkMode`. Resume keeps the saved
mode and refuses a different one. A record without `mode` stays isolated, so
existing environments don't change. A CLI older than this slice refuses a
record that has `mode` or `mounts`.

Shared mode uses the isolated image and the same `docker create` security
options. The image now includes `gh`. Each build writes
`/etc/convoy-environment.json`, `{ "mode", "mounts" }`, root-owned, so the
helper and the container's CLI read the mode and mounts without an environment
variable. An image without it is isolated. The helper starts the service as
`node` and installs no launcher, and the service behaves as in a shared Linux
environment. In the TUI the target behaves like a shared Local target.

The helper reads the CLI's lock files (holder PID and start time, see
[Locks](#locks)) to tell whether the service runs and whether a shared lease is
held. It no longer uses `flock`, which stopped matching the service lock in CLI
0.127.0.

### Home

One volume, `home`, holds all of `/home/node`. It replaces the `config` and
`service` volumes, which sit inside it. Runtime, `gh` and git logins survive a
rebuild, including folders a runtime adds later. Nothing from the host's home
enters the container.

### Host folder mounts

Shared mode only. `--mount <folder>` is repeatable on `run --env`, and Add
environment shows Mount folders below the radio while Shared is selected,
comma-separated like the allowed domains. Isolated environments refuse mounts,
because per-project UIDs don't fit bind-mount ownership.

Mount parent folders such as `~/code`, not one folder per project. Docker fixes
mounts when it creates the container, so a per-project mount would need a
rebuild for every new project. Choosing the folders is the user's job.

Each folder is bind-mounted at the same absolute path inside the container.
There is no container path to choose. The working path, the thread and the web
show one path, and the absolute paths git writes for worktrees are valid on the
host and in the container. The record stores the list as `mounts`.

The host validates every folder before it creates the container:

- It exists, is a folder and is not a symlink.
- It is not `/`, the host home or a folder above it, or at or under a
  credential folder: `~/.ssh`, `~/.aws`, `~/.docker`, `~/.gnupg`, `~/.config`
  or `~/.kube`.
- It is not the Docker socket or a folder that holds it, including the socket
  `DOCKER_HOST` names.
- It is not at, under or above a path the image uses: `/workspace`,
  `/opt/convoy`, `/var/lib/convoy-projects`, `/home/node`, or a system folder
  such as `/usr`, `/etc`, `/bin`, `/sbin`, `/lib`, `/root`, `/proc`, `/sys`,
  `/dev`, `/run`, `/tmp` and `/var`.
- No folder on its path is a symlink, and its path has no comma.
- No mount is at or under another.

`~` expands to the host home and a relative folder resolves against the
current folder. The checks run when the record is created, on each rebuild and
before every `docker create`.

On a Linux host, the image is built with `node`'s uid and gid set to the host
user's, so files an agent writes in a mount belong to the host user. A host
root user keeps uid 1000. macOS Docker maps ownership itself. Docker's own error
is shown when macOS file sharing doesn't cover a folder.

`environment rebuild --env <name> --mount <folder>` replaces the list, and
`--no-mounts` clears it. A rebuild without either keeps the saved mounts. The
rebuild refuses to drop a mount that holds a registered project and names the
project. The home volume keeps logins across the rebuild. The TUI has no action
for this yet.

### Projects

`project add` in a shared Docker environment takes a folder under a mount or
under `/workspace`. A relative path resolves against `/workspace`. Any other
path is refused, because a rebuild would delete it. An existing folder is
reused and a clone target must be missing or empty, as in
[Registration](#registration). An environment without mounts keeps every
project in the `/workspace` volume. Adding a project never needs a rebuild.

A mount root is refused as a project folder when it is a git repo, or would
become one through `--clone`. The message says to mount its parent. Worktrees
sit beside the repo in `<repo>-worktrees` ([worktrees](cli-worktrees.md)).
With a parent mounted they are inside the mount and visible on the host. With
only the repo mounted they would fall outside every mount and volume, and a
rebuild would delete them. A mount root that isn't a repo is accepted as a
[multi-repo folder](cli-multi-repo-projects.md): its repos' worktrees go to
`<mount>/<repo>-worktrees/`, inside the mount. A thread in one of its repos can
write the whole mounted folder, isolated or not
([folder access](cli-multi-repo-projects.md#folder-access)).

### Git

Host credentials, SSH keys and the SSH agent are never imported. The user runs
`gh auth login` once in the container. Mounted host repos often have SSH
remotes, so the helper writes `url.https://github.com/.insteadOf` for
`git@github.com:` and `ssh://git@github.com/` into the container's global git
config when it creates the home. The gh token then covers those remotes. The
repo's own config on the host is never touched. Other git hosts need their own
HTTPS login.

### Enrollment

This slice adds none. `run --env` talks only to Docker, and projects are added
with `project add`. `environment enroll --env <name>` arrives with
[user environments](cli-user-environments.md).

### Cost and verification

No Convex call, Docker poll or background work is added. Creation adds local
path checks and one build argument. Tests cover the `docker create` arguments
for both modes, every path rule, the `project add` refusals, the rebuild that
drops a mount in use, and an old record without `mode`. The manual walkthrough
runs on macOS and on a Linux host whose user is not uid 1000: mount a parent
folder, add a project from it, run a thread with a worktree, check the files
and their owner on the host, push over an SSH remote, change the mounts with a
rebuild and confirm the logins survive.

## Cost

No Convex function, table, subscription or poll is added by shared mode itself;
[user environments](cli-user-environments.md#cost) adds its own. A shared worker makes
the same backend calls as `convoy connect` today; registration skips the two
worker-key queries and the mint. `project check` adds at most four local status
commands with an eight-second deadline each, plus the existing heartbeat probe.

## Verification

Service tests run shared fixture workers and assert that a shared service
refuses isolated registrations. Lock tests cover exclusive creation, stale-PID
takeover and the holder text. Project tests cover add, remove, check and login
with the launcher mocked out and asserted unused, plus the missing-registry
guard. Credential tests bind a shared registration without the launcher
registry, check that the shared snapshot and launch frame carry its assignment,
and run a foreground shared `connect` with managed keys. TUI fixtures cover
Local in shared mode, its Credentials editor and the environment form. The
manual walkthrough runs on macOS, a plain Linux VM, an existing isolated VM and
the repository devcontainer: add two projects, run a thread in each, pause one,
log in again, remove one, restart the service and confirm the lease refuses a
second `connect`.

## Delivery

Slices, one commit each: (1) a shared project runs under the service on macOS
or Linux, including the CLI lock; (2) `project check` and runtime warnings
without the launcher; (3) shell, login and the keys guard; (4) mode visible in
the TUI, status and inspect; (5) template, docs and acceptance; (6) shared
managed Docker environments with the Project separation choice in Add
environment and optional host folder mounts, specified in
[Shared managed Docker environments](#shared-managed-docker-environments);
(7) choosing the mode on
Local and SSH targets at first setup, including the sudo install of the
launcher; (8) managed credentials per shared registration (OS-2248); (9) an
environment default per runtime that projects without their own assignment
inherit.
