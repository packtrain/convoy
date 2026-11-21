# Local project isolation

Isolated mode is opt-in since CLI 0.127.0. The default, shared mode, is
specified in [shared environments](cli-shared-environments.md).

OS-1958 adds singular `convoy project` commands. Plural `projects list` still
queries remote projects. The existing `connect --profile <key>` selects a local
registration. `--project` keeps its existing project-ID override meaning.

## Linux boundary

An administrator installs a root-owned launcher and configuration. An
unprivileged control account can invoke only that launcher through sudo.
The launcher allocates a stable UID per deployment, organization and project.
Registrations for the same identity share private state. Removal never frees a
UID or deletes files. The network-facing worker and all its descendants run as
the project UID, without supplementary groups or capabilities.

Bubblewrap provides a private filesystem view, PID and IPC namespaces. Only
system tools, the installed CLI, the project's workspace, worktrees and private
HOME are visible. A fresh private `/tmp` and `/proc` exclude other projects'
temporary files and process environments. Privilege escalation is disabled.
The root launcher never imports or executes project files as root.

The deployment must permit unprivileged user namespaces. Missing prerequisites
fail closed. Shared network access remains subject to environment-wide policy;
this does not isolate unauthenticated TCP services or cloud metadata. Do not
expose credentials through such services in a supported environment.

Project execution accepts only an API key whose server-verified scope contains
exactly that project and organization. The registration stores that key, not a
control key. Runtime sign-in happens inside the private project HOME; host
runtime configuration is not copied. Shared provider credentials are not
independently isolated credentials.

## Registration and lifetime

`project add <path>` selects an accessible existing project, validates its key,
then registers a canonical direct child of the configured workspace root.
The command supports creating a folder, HTTPS clone into a new folder, and
explicit reuse of a directory whose ownership already meets the boundary.
It never recursively changes checkout ownership. Reject symlinks, path overlap,
worktree-name collisions and conflicting profile keys before mutation.

The shared TOML writer rejects malformed snapshots, serializes read/modify/write
operations and atomically replaces a validated file with mode 0600. Existing
setup/config/keys/paths commands use the same writer. External writers must
coordinate with the lock; desktop and hand edits are not serialized by the CLI.

Registration starts no service. Repeated identical adds are idempotent.
Preparation runs outside the TOML mutation lock; profile and path conflicts
are checked again under the lock before saving. A failed final save retains
launcher state for an explicit retry. Pending registrations expose their UID
and path through `project list`, even before a profile exists.
The launcher persists its UID registry with mode 0600 and atomic replacement
before creating project directories. If the first registry write fails, retrying
registration requires no project-directory cleanup.
Clone failure does not save a profile; allocated state is retained for recovery.
Retries retain the original clone source and audit the workspace before marking
it ready, even when retry flags are omitted. Changing a pending clone source is
rejected. Provider-key assignment cannot mutate managed profiles.
`project list` reports registrations and available live service status without
credentials. Offline `project remove` refuses an active worker; service removal
requires explicit `--interrupt` for a live connection. Both clear a matching
default and retain all data. See [live registration](cli-service.md#live-registration-os-1960).
Removing the last local profile for an identity disables launcher execution;
replaying an old connect or shell request is rejected. Other profiles for the
same identity keep it enabled when one alias is removed. Re-adding re-enables
the retained identity and keeps its UID and files.

Direct connect holds an exclusive project execution lease. Ctrl+C, terminal
loss and launcher death stop the project worker and its descendants. This is
different from the service log client's detach semantics. A second profile
for the same project cannot start a second execution owner.

Worker startup is one bounded newline-delimited JSON frame. The launcher keeps
the pipe open afterward and closes it for graceful shutdown; the worker uses
that EOF to stop runners, release claims and disconnect. The outer bubblewrap
process starts in a separate session so terminal Ctrl+C cannot kill it before
the control request is handled. The launcher kills the sandbox after 30 seconds
if shutdown does not finish. Launcher death still uses
bubblewrap's immediate parent-death cleanup. Project shells retain terminal
semantics separately.

Isolated connections preserve `--name` and explicit `--force`. Session conflicts
never prompt on worker stdin or automatically take over another session; report
how to retry with `--force`. Startup diagnostics distinguish malformed config,
identity, scope verification, private-profile writes and connection failures,
without printing input credentials or raw validation/backend errors. Intentional
connection diagnostics (`ConnectDiagnosticError`) are shown with the API key
redacted, for example a missing runtime, which names the runtimes the launcher detected.
Other errors keep the generic message. "Agent registered" prints only after the
backend accepts registration. A denied
runtime fails its run through normal message failure and claim release instead
of throwing out of queue dispatch. Ordinary non-project runtime behavior stays
unchanged.

## Compatibility and acceptance

`project shell <profile>` opens a shell under the same boundary for runtime login
and diagnostics. It holds the project lease, so it must close before connecting.
The shell acquires its own controlling PTY through util-linux `script` inside
the boundary. Keep bubblewrap's `--new-session`; the shell must not regain the
control account's controlling terminal. Terminal output is not saved to disk.
Runtimes are detected at launch (below). No runtime compatibility is claimed by
unit tests.

### Runtime detection and login, CLI 0.110.0 (OS-2166, OS-2160)

The launcher keeps the runtimes Convoy has tested inside the boundary in code:
`codex` (binary `codex`), `claude-code` (binary `claude`), since CLI
0.117.0 `cursor` (binary `cursor-agent`, OS-2017), since 0.118.0 `opencode`
(binary `opencode`, OS-2018) and since 0.159.0 `antigravity` (binary `agy`,
OS-2475). Adding one is a release,
not an administrator edit. At every worker, shell and login start it
looks for each binary on the sandbox `PATH`, without the project's
`~/.local/bin`, and keeps it only if the binary resolves to a root-owned file
whose path has no group or world write. That is the same `trusted_path` check as
Node and the CLI: a shared binary an agent could replace would run inside every
project. The worker receives the result as `CONVOY_PROJECT_RUNTIMES`. A missing
or untrusted runtime is skipped. With none left, the worker reports
`runtime-missing` ([cli-sidecar-contract.md](cli-sidecar-contract.md#status-events)).
Installing a runtime later needs only a project reload. `verified_runtimes` in
older configurations is ignored, and the installer drops it on rewrite.

`install.py` runs the boundary probes once as a diagnostic and always finishes.
The probes run under a throwaway UID outside the project range. They check the UID,
empty supplementary groups, `NoNewPrivs`, zero effective capabilities, a writable
workspace, and that a sibling project folder, the control account's HOME and
the Docker socket are absent. On failure the installer prints the cause, for
example bubblewrap's `setting up uid map: Permission denied` with a link to the
Ubuntu AppArmor fix. It then prints the detected runtimes. The real gate stays
at launch and fails closed: no boundary, no worker, never an unsandboxed fallback.
After fixing the machine, reload the projects; no reinstall is needed. Managed
Docker environments run the same installer at start, so `environment verify`
and its `runtimes.json` are gone. The helper's status still returns an empty
`runtimes` list because host CLIs 0.109.0 and older require the field.

Before every shell, login or worker start, the launcher creates `~/.codex`,
`~/.claude`, `~/.config/cursor`, `~/.local/share/opencode` and `~/.gemini/antigravity-cli` (0700, project UID) in the project HOME if
they are missing. It opens HOME with `O_NOFOLLOW` and walks each folder one
part at a time with `O_NOFOLLOW` relative to that handle, so it never follows
or changes a link the project made. A linked `~/.config` leaves Cursor's folder
uncreated and reads as not logged in. `project check` looks for
`~/.config/cursor/auth.json`, `~/.local/share/opencode/auth.json` and
`~/.gemini/antigravity-cli/antigravity-oauth-token` the same way.

`launcher login <identity> <runtime>` is the shell mode with one command
instead of bash: `codex login --device-auth`, `claude auth login`,
`NO_OPEN_BROWSER=1 cursor-agent login`, which prints the browser link,
`opencode auth login`, which asks for a provider and its key, or
`agy acp --login`, which prints a Google link and asks for the code from the
page it lands on. It refuses
a runtime that detection did not find. The CLI exposes it as
`project shell <profile> --login <runtime>`, which local, managed Docker and SSH
targets forward like the shell. `project login <profile> --runtime <runtime>`
wraps it for people. With a running service it pauses the project, runs the
login, reloads the project and waits up to 60 seconds for `online`. If the
project has active runs, it requires `--interrupt`. A failed login still reloads
the project. Without a service it only runs the login. With `--environment` the
container's CLI runs the whole command. With `--remote` the whole command is
forwarded over SSH. TUI login actions: [cli-tui.md](cli-tui.md#runtime-login-cli-01100).
Existing VMs need an `install.py` rerun with the same arguments to get the new
launcher; managed Docker environments need Update CLI.

`apiKeys.core.currentScope` returns the authenticated principal's existing scope,
without key material, so registration and worker startup can enforce the one-project
credential rule. It adds no key creation or permission-grant capability.

The launcher uses bubblewrap's private mount/PID/IPC namespaces and parent-death
handling. Reference: [upstream bubblewrap manual](https://github.com/containers/bubblewrap/blob/main/bwrap.xml).

The legacy `--isolated` runtime sandbox is unchanged and may be an additional
layer. External isolation is explicit on registered profiles. Unverified runtime
paths must not be advertised as supported. Browser acceptance belongs to
OS-1992; [persistent service management](cli-service.md) is implemented by OS-1959.

On a machine with the administrator's `/etc/convoy-projects.json`, the control
CLI refuses unregistered connections, including bare `convoy`. Project workers
cannot see that control file and run only within the launcher's boundary.
This prevents an accidental legacy setup flow from launching agents as the
control account inside a managed project environment.

Acceptance requires real A/B agents doing legitimate edits, cross-project
read/write and signal denial, helper/file-tool checks, worktrees, resume and
cancellation. Add C without rebuild, remove stopped B retaining files, recreate
the container preserving identities. Repeat on a configured Linux VM. Unit
tests and fake workers alone do not establish this acceptance.

## Failure reasons and project check, CLI 0.111.0 (OS-2161, OS-2162)

A failed project used to show "Connection failed after retries" for most causes.
The service never keeps worker text, so the launcher and worker now report fixed
codes ([cli-sidecar-contract.md](cli-sidecar-contract.md#status-events)), and
`project check` runs every precondition once.

**Lease holder.** Whoever takes a project lease writes its role into the lease
file: `service` or `connect` for a worker (from the request's `holder` field; the
CLI sends `service` from the service), `shell`, `login`, or `registration` for add and
remove. On a conflict the launcher reads that role back and says who holds the
project, for example "Project is in use by a private project shell". A file
without a known role reads as `unknown`. The role is a label, not a credential:
any lease holder overwrites it, and a stale label is read only while the lease is
held.

**Launcher events.** For a `service` connection, the launcher writes a
`failed` status event with `project-active` (and `holder`) when the lease is
held, and with `sandbox-failed` when bubblewrap exits before the worker command
starts. It tells the two apart with a pipe passed into the sandbox: `/bin/sh`
writes one byte to it, closes it and execs the worker. No byte and a non-zero
exit means the sandbox never started. A foreground connect keeps the plain
stderr message, because its stdout is the terminal.

**Runtime state.** Detection now also reports runtimes it skipped. The worker
receives `CONVOY_PROJECT_UNTRUSTED` (on the sandbox `PATH` but failing
`trusted_path`) and `CONVOY_PROJECT_LOGGED_OUT` (detected, with no login file:
`~/.codex/auth.json`, `~/.claude/.credentials.json` or another runtime's login
file listed above). The launcher checks those
files as root through `O_NOFOLLOW` handles and `lstat`, so it never follows a
link the project made or reads a file's contents. The worker drops a runtime from
`loggedOut` when the profile assigns it managed credentials.

**Worker codes.** Registration that throws before a response is
`backend-unreachable`. HTTP 401 or 403 on registration or heartbeat is
`auth-rejected`.

**`project check <profile>`** is read-only and never prints credentials. The
launcher's `check` operation runs the `install.py` boundary probes, then reports
each tested runtime (`ready`, `untrusted` or `missing`), whether its config
folder exists and whether its login file exists, and the lease holder. It
releases the registry lock before the probes. The CLI adds a backend probe: a
heartbeat request without a session. With the key accepted the backend answers
400 for the missing session, so 400 means reachable, 401/403 means rejected and a
thrown request means unreachable. It creates and changes nothing. The checklist:

| Check | Fails when | Fix |
| --- | --- | --- |
| Sandbox boundary | a probe fails | the probe's cause; the AppArmor link only when bubblewrap reports "Permission denied" or "Operation not permitted" |
| `<runtime>` installed | untrusted; missing only if no runtime is ready | reinstall as root with `umask 022`, or the install command |
| `<runtime>` config folder | missing for a ready runtime | reload the project once; the launcher creates it |
| `<runtime>` logged in | no login file, native login only | `project login <profile> --runtime <runtime>` |
| Project lease | held by anyone but the service | stop the named holder |
| Backend | rejected or unreachable | renew the key, or check network, DNS and proxy |

A missing runtime is skipped while another one is ready, and managed credentials
skip the login row. Plain output prints one line per check and exits 1 if any
check fails. `--json` prints `{ profile, checks: [{ id, status, label, fix? }] }`
and exits 0 whenever the check ran, so the TUI can read it over Docker and SSH.
`--environment` runs the command in the container and `--remote` forwards it. An
older launcher answers "Unsupported operation"; the CLI says to rerun
`install.py`. TUI: [cli-tui.md](cli-tui.md#project-check-cli-01110).

`install.py` rejects a Node under `/home`, `/root` or an `.nvm` folder, since
the sandbox cannot see it. It suggests a system Node and `--node /usr/bin/node`.

## Browser automation, OS-1992

See [Project browser automation](cli-browser-automation.md) for the authoritative
command, state and sandbox contract. Both templates install the pinned Chromium
binaries and system libraries during image build. The repository devcontainer
uses the same browser version. Per-project launches retain private browser state
under HOME and use pipe transport; no TCP debugging server is exposed. The project
launcher additionally mounts `/etc/fonts` read-only when present. The optional
`--no-browser-sandbox` flag changes only Chromium's inner sandbox.

## Command failure reporting

The CLI awaits asynchronous command actions and reports rejected operations with
one error message, without a JavaScript stack or Node crash footer. A refused
project connection keeps its nonzero failure result and includes service status/
stop guidance as well as direct-connection and shell ownership. JSON connect
emits a terminal failed status event. This also applies to bare CLI profile
connections. Lease enforcement and the existing owner's lifetime are unchanged.

The 0.67.2 launcher bounds registry-lock waits to ten seconds and observes a
connect owner's EOF while waiting. This closes the cancellation gap before
supervise installs its normal drain handlers. Existing installations must refresh
the root-owned launcher from the new package. Profile registration and worker
startup share the service's 80-character profile-key validator.

## Managed Codex credentials, OS-2015

Native sign-in remains private. An explicit control-account OpenAI assignment can
now deliver a project-specific Codex auth payload through the existing bounded
launch pipe. The launcher advertises `credentials-v1` and validates auth mode,
fields and secret size before spawn. No arbitrary env/path directives are accepted.
The worker never writes model keys to its Convoy profile or global environment.
The control store and management socket remain outside project mounts.

Mantle and Bedrock Runtime entries (OS-2107) use the same pipe with
`{ mode: "mantle" | "bedrock", secret, region }`. The launcher advertises
`credentials-aws-v1` and accepts exactly those fields and an AWS Region pattern.
The worker hands them to the Codex app-server only, as its AWS provider. A
target environment allows the Region's endpoint with `allow-domain` when the key
is added.

Claude Code bindings (OS-2108) send `claudeAuth`, `{ mode: "mantle" | "bedrock",
secret, region }` or `{ mode: "disabled" }`, over the same pipe. The launcher
advertises `credentials-claude-v1` and accepts only those shapes. The worker
passes the key to the Claude Code child env and its private `--settings` file
only, never to its own environment or argv.

Managed Anthropic keys (OS-2016) send `claudeAuth: { mode: "anthropic", secret }`.
The launcher advertises `credentials-anthropic-v1` for that shape; Codex never
accepts it.

Managed Cursor keys (OS-2017) send `cursorAuth: { mode: "managed", secret }` or
`{ mode: "disabled" }`. The launcher advertises `credentials-cursor-v1` and
accepts only those shapes. The worker hands the key to the Cursor runner, which
puts it in the `cursor-agent` child env only. `project check` output gains a
`cursor` runtime; the CLI treats it as absent for older launchers.

The project-isolation image installs Cursor Agent 2026.10.22-27dcf5f root-owned
in `/usr/local/lib/cursor-agent`, linked from `/usr/local/bin/cursor-agent`,
for amd64 (`x64`) and arm64. The Dockerfile checks the archive's SHA-256 and
extracts it with `--no-same-owner`, because the archive's files belong to a
build user and the launcher accepts only root-owned binaries. Other
architectures fail the build. A VM administrator runs the same steps as one
`sudo sh -c` command, published in the isolated projects guide. `project check`
prints a missing runtime's install command on its skipped row too, so it shows
while Codex or Claude Code is ready.

Managed OpenCode keys (OS-2018) send `opencodeAuth: { mode: "managed", keys }`,
where `keys` holds any of `openai`, `anthropic` and `amazon-bedrock`, or
`{ mode: "disabled" }`. The launcher advertises `credentials-opencode-v1` and
accepts only those shapes: a non-empty `keys` with known slots and bounded
single-line values. `credentials-opencode-v2` (OS-2205) adds the
`amazon-bedrock` value, exactly `{ secret, region }` with a valid Region. The worker hands them to the OpenCode server manager, which
puts them in the `opencode serve` child env only. `project check` output gains
an `opencode` runtime; the CLI treats it as absent for older launchers.

The image installs `opencode-ai@1.19.5` with npm, root-owned, beside Codex and
Claude Code. Its postinstall puts the native binary at
`/usr/local/lib/node_modules/opencode-ai/bin/opencode.exe`, linked from
`/usr/local/bin/opencode`, so the launcher's trust check sees the real binary,
not a wrapper. A VM administrator installs it with the same npm command, which
`project check` prints.

Managed Gemini keys for Antigravity (OS-2476) send `antigravityAuth: { mode:
"managed", secret }` or `{ mode: "disabled" }`. The launcher advertises
`credentials-antigravity-v1` and accepts only those shapes. The worker hands the
key to the Antigravity runner, which puts it in the `agy` child env only.

Antigravity (OS-2475): the image installs agy
1.5.14, the build `ANTIGRAVITY_BUILD` in `apps/cli/src/commands/project/formatters.ts`
pins for a managed install, from the same release tarball and SHA-512 per
architecture. Its single `antigravity` executable lands root-owned in
`/usr/local/bin`, with `agy` linked to it; a test keeps the Dockerfile and the
managed install on the same build. The sandbox sets `AGY_CLI_DISABLE_AUTO_UPDATE=1`
for every command, because the login runs outside the runner that sets it for runs.
With no D-Bus session in the sandbox agy stores its sign-in as a file in the
project HOME, so the sign-in survives restarts and stays per project
([cli-antigravity-runtime.md](cli-antigravity-runtime.md#isolated-projects)).
`project check` output gains an `antigravity` runtime; the CLI treats it as
absent for older launchers.

Install matching CLI/launcher versions before enabling bindings; older launchers
are rejected by the new CLI. Codex managed auth is app-server-only and ephemeral;
manual shells keep native auth. See cli-provider-keys.md for assignment, revocation
and the boundary's limitations.

## Create and register (OS-1961)

`project add <path> --create --org <id-or-slug> --project-name <name>
--project-alias <alias>` creates a remote project before registration. Interactive
selection also offers creation, including when the organization has no projects.
The existing account, organization and Linux installation are prerequisites.

A broad creation key stays in the control process. Registration obtains a
separate single-project worker key through `apiKeys.core.createProjectKey`,
verifies its scope, and sends only that key to the service/worker. Broad keys
can also register an existing accessible project through the same narrowing
step; existing single-project keys remain usable directly.

Full non-interactive inputs include `--url`, `--api-key`, `--profile-key`, and
either `--project` or all four creation flags. Incomplete or contradictory inputs
fail before creation. Local path and supplied profile-key syntax are checked
before remote mutations. Alias conflicts never silently select an old project.

The CLI prints a confirmed new project ID immediately. Subsequent failures
retain it, files and any issued key. Retry with `--project <id>` instead of
`--create`. A lost creation response is uncertain: inspect remote projects before
retrying. There is no application-level mutation replay. If worker-key issuance
succeeds but local registration fails, the key ID is printed for cleanup in API
Keys. A saved linked worker key is reused only after backend confirmation of its
source link and validity. Without a saved secret, retry may issue another key
under the worker quota. Clone preparation precedes issuance. Never print secrets.
Existing service registration/application semantics are unchanged.

### Worker source lifecycle

Broad setup credentials for isolated registration must be manual keys. Validate
eligibility before creating remotely or preparing a workspace; browser-login and
MCP keys cannot become worker sources. A source can serve multiple projects, so
its expiry/revocation affects all of them. Renew each registration with a new
manual source, reload its service worker, and verify before revoking the old
source. Bulk rekey and proactive expiry warnings remain outside this phase.

### Native account status, CLI 0.123.0, OS-2167

`project account <profile> --expected-identity <identity>` returns JSON for Codex
and Claude Code from the registered private environment. Local, Docker and SSH
adapters use the same command contract. The launcher runs `codex login status`
and `claude auth status --json` as the project UID inside its sandbox, with a
clean environment, no stdin and no managed credential injection. It does not
pause workers or take their lease. Registry validation and private-directory
checks still apply.

Each command has an eight-second deadline and a 16 KiB combined output cap.
Process groups are killed on completion, overflow or timeout. Only recognized
status, login method and an account address may leave the launcher; raw output
and tokens never do. This is the runtime's reported authentication state, not an
online subscription or quota check. Codex's command reports the login method,
not an email. Unsupported or failed checks return unknown. Older CLI/launcher
installations need updating; the UI still allows sign-in, Skip and Refresh.
