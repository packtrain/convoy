# Managed local execution environments

The TUI uses the [CLI 0.103.2 interaction contract](cli-tui.md#unified-interactions-cli-01032). Environment operations live directly in contextual Actions; setup/progress use the main panel. Earlier TUI popup descriptions below are historical. Controller behavior remains unchanged.

OS-1995 adds an explicit host controller. `convoy run --environment <name>`
creates or starts a Convoy-owned Docker container and attaches to its service.
The default name for run is `default`. Other commands require explicit
`--environment`; ordinary host profiles and commands keep their existing meaning.
The one exception is `environment enroll`, where `--environment` is optional; see
[user environments](cli-user-environments.md#enrollment).

The host owns Docker access. The container never receives the Docker socket,
host credentials, host repository mounts or published management ports. Labeled
Docker volumes retain workspaces, project identities, control config, service logs,
CLI installation. Linux volumes avoid depending on host
bind-mount ownership semantics. Repositories are cloned or created inside them.
Existing checkout migration remains an explicit administrator operation.
Shared Docker environments (OS-2251, CLI 0.139.0) relax the host mount rule
for folders the user lists; see
[shared environments](cli-shared-environments.md#shared-managed-docker-environments).

The private host record pins a Docker daemon ID and random ownership token.
Every operation verifies daemon and container/volume labels. A private per-target
lock serializes provisioning and lifecycle requests from host processes. A crashed
lock requires confirming its writer exited before explicit removal. Never adopt,
stop or remove an unrelated container. Repeated run reuses both container and
service. Provisioning diagnostics go to stderr; structured results use stdout.

Host attachment uses Docker exec of the validated service bridge without a PTY.
The same ServiceClient performs negotiation, parsing, outcome tracking and bounded
output. Ctrl+C, EOF or losing that bridge detaches only. A project shell is a
separate, explicit interactive Docker exec with a PTY and the existing project
launcher. It retains project lease semantics.

Stop drains workers then stops the container. Restart stops/starts only the
service. Update requires explicit interruption, stages an exact npm version or
a local CLI package, checks its version, stops work, swaps the root-owned installation, refreshes the
launcher, then checks service readiness. Failures restore
the previous installation and launcher. Persistent transaction state allows a
later start to recover an interrupted update. Rebuild preserves all data volumes
and the selected installation. Host CLI update remains a separate command.

Project prompts render on the host. Registration uses the existing target-side
preparation and registration workflow, including project key narrowing and reuse.
Preparation never imports host config. Unknown mutation outcomes are never
replayed. New-project creation retains the existing recovery guidance.

The managed image keeps the runtime acceptance gate. Host verification commands
exercise the namespace and private filesystem boundary before explicitly enabling
selected candidate runtimes. Real provider acceptance remains a separate test;
structural probes alone do not certify every runtime or host combination.

See cli-service.md for framing, log retention and run history, and
cli-project-isolation.md for project identities and the security boundary.

## Wiring and delivery slices

The host feature lives in commands/environment. Its public index exports command
registration, current target selection and the target command adapter. Outside
wiring is limited to CLI registration, project/service/key command routing,
and generic duplex support in the existing service client. Existing project
registration and service operations keep ownership of their mutations.

The first usable slice provisions, registers and attaches from the host. The next
adds service/container lifecycle and update recovery. The final slice adds runtime
verification and the reproducible acceptance guide. No commits are
created until the user requests them.

`service stop --environment` stops only the service. `environment stop` also stops
the container after successful worker cleanup. Active private shells or direct
connections prevent lifecycle changes; the user must close them first. Host shell
and registration commands participate in the same lifecycle lock. The target
helper separately serializes root lifecycle operations.

The managed image uses the bundled Moby-derived seccomp policy to permit nested
bubblewrap namespaces and mounts. It explicitly uses apparmor=unconfined because
the Docker default profile denies those mounts. It does not grant SYS_ADMIN or
privileged mode. The structural verification gate checks private mounts, UIDs,
empty supplementary groups, no-new-privileges and zero effective capabilities.

Registration adds validated backend hostnames to the shared firewall. Convex cloud
hostnames also add the matching MCP site hostname. Additions persist in the root
installation volume and survive rebuilds. Other host credentials, environment
variables and checkout paths are never imported. Browser tools are image-owned and updated only by rebuild. CLI upgrades do not
download or launch browsers. Legacy browser volumes are no longer mounted; rebuild
leaves them and `environment delete` removes them with the rest. See [Browser automation](cli-browser-automation.md).

The service advertises host-cli-v1 and its package version during hello. Host
project and run operations reject targets without that capability. Service
start/stop and environment lifecycle use the target's installed controller so an
updated host can still stop the older service before replacing it. The original
direct VM stop behavior is unchanged by this phase.

Managed key commands also accept --environment. They follow the targeted keys
rules in [cli-remote.md](cli-remote.md#managed-credentials-cli-01190-os-2020),
shared with --remote. One difference: adding an AWS entry first allows its
Region endpoint through the environment's firewall.

Non-following operational log inspection remains available after service stop
while the container is running. It uses the target CLI's bounded offline reader,
validates each log entry, renders on the host and forwards retention-gap diagnostics
to stderr. Following logs and transcript queries still require the running service.

`convoy env` is an alias for `convoy environment`. Every command accepting
`--environment` also accepts `--env`, with the same defaults and requirements.
Since CLI 0.120.0, `--target <name>` on `attach`, `service`, `project` and `keys`
resolves to `--environment` or `--remote`; see
[cli-remote.md](cli-remote.md#one-target-flag-cli-01200-os-2215).

Managed containers also set Docker's `systempaths=unconfined`. Docker's default
masked and read-only system-path mounts prevent a nested user/PID namespace from
mounting a fresh procfs. Seccomp and AppArmor exceptions alone do not resolve this.
This setting removes outer Docker masks/read-only restrictions on system paths,
including paths under `/proc` and `/sys`; it is an explicit reduction of outer
container hardening. Project processes still use private PID/user/mount namespaces,
private filesystem views, distinct UIDs, no-new-privileges and dropped capabilities.
No host proc bind, host PID namespace, privileged mode or SYS_ADMIN is added.
Runtime verification remains mandatory and failures never enable the runtime.

The setting applies when the host creates a container, including rebuilds. Existing
containers need `environment rebuild --interrupt`, which keeps the same labeled
volumes and installed CLI. Restarting a service/container does not change its
creation-time security settings. An unpublished package may supply the rebuild
image without replacing the retained CLI installation volume.

Reference: [Docker security options](https://docs.docker.com/reference/cli/docker/container/run/#security-configuration).

## Local package updates, 0.97.0

`convoy env update --env test --package /path/to/cli.tgz --interrupt` updates
an existing running environment without publishing the CLI. Supply exactly one
of `--version` or `--package`. The host validates ownership as usual, copies the
local file to a unique temporary container path, invokes `update-package`, and
attempts to remove that upload on success or failure.

The helper installs the archive into the existing staging directory before
stopping work. It validates the staged package name, version and isolation
installer, then uses the same installation swap, launcher refresh,
health check and rollback as published updates. The selected version comes from
the installed package. Same-version development packages may replace the
current installation. Dependencies can still download from npm.

The host and environment helper must support `update-package`; there is no
compatibility fallback or automatic helper replacement. Older helpers reject
the operation. Rebuild still preserves the installed CLI volume.

Local updates add one Docker copy and one cleanup exec compared with a published
update. They add no Convex queries or writes. The existing lifecycle lock and
explicit interruption requirement remain in force.

The root helper sets umask 022 before creating locks, staging installations or
update state. Docker exec may otherwise inherit a permissive umask and npm can
create group/world-writable package directories, which the launcher installer
rejects. Version 0.97.1 fixes this without weakening root ownership or permission
checks. Failed staging from an earlier attempt is removed before the next install.

## TUI controller adapters, 0.103.0

The host TUI reuses runEnvironment and EnvironmentController through a maintenance
adapter. It rereads the private record inside the lifecycle lock and rejects a
changed owner or daemon. Status persists observed installed versions. Update checks
an exact stable host release on npm both before confirmation and under the lock
before execution; missing releases, registry errors, unknown installed versions and
newer targets fail without interruption. The target helper retains installation,
restart and recovery ownership. A reported old version or
failed readiness cannot become a successful TUI update.

Docker progress can use an optional callback instead of stderr. One-shot callers
keep their existing output behavior. The TUI bounds rendered progress and reuses
existing status and guided-schema probes. It adds no Convex function, table,
background poll or DB request. Opening Add project adds one read-only Docker schema
probe; the existing submission probe remains. Update availability makes one npm
request and a target status read; confirmation repeats both before installation.
Reconnection uses the existing service subscription and metadata reads. Worker
restart and subsequent project registration retain their existing backend traffic.

See cli-tui.md for confirmation, form retention, transport limits and manual
acceptance requirements.

### Review-fix request cost, 0.103.1

These fixes add zero direct Convex queries, mutations, subscriptions or DB reads.
Update proposals reuse the status response already fetched for release checking,
so accurate installed-version display adds no request. Diagnostic retention,
transport disabling and the exit notice are local operations.

Creating a new environment still checks npm once after confirmation. Resuming an
existing container removes that npm request. A resume now inspects status before
confirmation and again under the lock before starting. On a running container each
status inspection is four Docker commands: info, container ls, container inspect
and helper status. The added two checks therefore cost eight host Docker commands,
not backend calls. Stopped containers omit helper status, costing six additional
commands. A missing container uses info and ls; rebuilding checks its saved release
on npm once. Installation may perform its existing npm dependency downloads.

Retrying guided-support inspection costs three Docker ownership/running checks and
one read-only Node schema probe when the container is running. There is no timer or
background retry. A user choosing Start invokes the existing lifecycle, readiness
and reconnect operations. Reconnected workers resume their existing backend work;
this is not a new source of per-keystroke or polling requests. The two catalog
queries on Load choices and subsequent registration costs remain unchanged.

For 100 resumes of running containers, these fixes add 800 Docker commands and
remove 100 npm metadata requests. For 100 explicit probe retries they add 400 Docker
commands. Both add zero direct DB calls. Docker context and host latency determine
the elapsed cost; no real Docker latency measurement was available in this workspace.

## Explicit Internet access, CLI 0.104.0

Add environment shows an Internet access selector with Unrestricted selected by
default and Restricted as an explicit alternative. Unrestricted permits web
research and downloads without the environment allowlist. Restricted permits the
built-in destinations and configured extras; only this choice shows advanced
deployment/domain fields. Project registration retains the existing automatic
allowance for its backend hostname in Restricted mode. Unrestricted ignores hidden
allowlist drafts. Review names the effective policy before creation.

Tab and Up/Down move focus. Left/Right select the network mode and move between
Cancel and Review, which share a horizontal row. Enter activates the focused
control. Narrow terminals retain the draft and require resize when it cannot fit.

The private environment record stores optional networkMode, open or strict.
Missing values in legacy records mean strict. Resume keeps saved settings and
rejects an explicitly different mode. Changing policy requires a new environment.
The confirmation check under the lifecycle lock also compares network mode.
Docker receives the selected mode; the host-only helper skips firewall setup in
open mode both at startup and during project registration. Existing command-line
creation without a mode retains strict behavior.

This adds no DB calls, subscriptions, Docker commands or background polling.
Unrestricted agents can make additional Internet requests as their tasks require;
that traffic depends on the agent workload. Real Docker network acceptance must
check an unlisted site in each mode, including after project registration/restart.

## Failed creation, stopping and deletion, CLI 0.106.0

New environment records are saved after the confirmed npm preflight succeeds and
before Docker creation begins. An unpublished release leaves no saved environment.
If a later build/start fails after the record is saved, the TUI immediately adds
that retained environment to its sidebar without changing the current selection.
Empty state directories are ignored by discovery.

Stop is idempotent for an absent container and returns not-created with stopped=true.
It does not create a container. Running containers still require successful graceful
service shutdown before Docker stop. Stopping preserves volumes and the record.
Stop confirmation, progress, success and failure remain in a compact popup.

Managed environment Actions includes Delete environment, shortcut D. It is available
for incomplete and stopped environments. Confirmation defaults to Cancel and states
that the container, all saved volumes including project files, credentials, config
and logs, and the local record are permanently removed. Remote Convoy projects are
not deleted. Confirmation must fit before it can execute. Progress and result stay
in the popup; success removes the sidebar target immediately and selects Local.

Deletion uses the existing lifecycle lock and validates owner and Docker daemon.
It checks every existing volume's owner and environment label before any mutation.
A running container must shut down gracefully; active shells or failed cleanup block
deletion. Docker removes the container then its owned volumes without force. Only
complete success removes environment.json. A partial failure retains the record,
reports that some data may already have been removed, and supports retry. The empty
private directory remains so concurrent lifecycle callers share the same lock path.

No new direct DB queries, mutations, subscriptions or polling. Failed-create sidebar
sync reads local records only. Stop on an absent container uses two Docker commands.
Deletion with a running container and all six volumes uses 24 host Docker commands:
three container checks, twelve volume checks, helper stop, Docker stop, container rm,
and six volume removals. A record without container or volumes needs eight read-only
Docker commands before removing its local record. Normal service shutdown and the
return to Local retain existing connection/backend traffic.

Manual acceptance: unpublished creation leaves no sidebar ghost after restart;
failed Docker creation after preflight appears immediately; stopping absent/already
stopped/running targets behaves correctly and keeps a popup throughout; Cancel on
Delete changes nothing; confirmed deletion removes an incomplete or stopped target
without restart; an ownership mismatch or active shell prevents removal; retry a
partial deletion. Real Docker acceptance requires a Docker-capable host.

## Restart after a reboot, CLI 0.141.0

OS-2255. A managed container is created with `--restart unless-stopped`, so
Docker starts it again when the Docker daemon starts, as after a host reboot or
a Docker Desktop restart. `environment stop` runs `docker stop`, which Docker
remembers, so a stopped environment stays stopped. `service stop
--environment` stops only the service; the container keeps running, and the
service starts again at the next container start.

The image's entrypoint runs the helper's `start` before `sleep infinity`, so a
container that Docker restarts gets its firewall and service without the host.
A failed start is printed to the container log and the container keeps running;
Start from the TUI or `convoy run` retries. The helper's lock serializes this
with a host Start that runs at the same time.

The helper's marker `/run/convoy-initialized` now holds the start time of the
container's PID 1. The file survives a container restart, while the firewall
rules do not, so a marker from an earlier start no longer skips the strict
firewall.

Environments created before 0.141.0 have no restart policy and an entrypoint
that only sleeps. Rebuild gives them both. Docker Desktop must itself be set to
start at login for a Mac to bring the environment back.
