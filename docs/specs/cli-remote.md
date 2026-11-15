# Remote service targets over SSH

OS-1996, CLI 0.108.0. The host client reaches a Convoy service on another
machine through SSH. The service, its projects, paths, credentials and logs
stay on that machine. Nothing is synced, provisioned or installed remotely.

## Targets

`convoy remote add <name> --host <destination> [--container <name>] [--command <path>]`
saves a target in the private `~/.convoy/remotes.json` (mode 0600, owner-only).
The destination is an SSH destination, `ssh://` URI or `~/.ssh/config` alias. It
can never start with `-`. `--container` runs Convoy inside an existing container
on that host through `docker exec`. `--command` gives the absolute path of a remote
`convoy` that is not on the non-interactive `PATH`; relative paths are rejected.

Add runs `convoy --version` on the target, with a 30-second limit, and saves
nothing if SSH or the CLI fails. Since CLI 0.112.0 (OS-2163), when that probe exits
127 and no `--command` was given, add tries the documented install paths in one
more SSH call: `/opt/convoy/node_modules/.bin/convoy`, then `/usr/local/bin/convoy`.
It saves the first one that answers `--version` as `command`. A non-interactive
SSH shell often skips `.bashrc`, so `/opt/convoy` is rarely on its `PATH`. An
explicit `--command` is never replaced. It rereads the file after that check, so a target
saved meanwhile by another command is kept. Saves are not locked. Since CLI 0.140.0 (OS-2252), add then sets the target's
mode over `ssh -t` when the terminal is interactive or `--mode shared|isolated`
is given ([choosing the mode](cli-shared-environments.md#choosing-the-mode-on-local-and-ssh-targets)).
`remote list [--json]` prints saved targets. `remote remove <name>` forgets
one and never changes the remote host.

## SSH invocation

Since CLI 0.127.0 the remote command runs as `exec "$SHELL" -lc '<command>'`, so
the remote account's login profile sets `PATH`. A shared service started over
SSH passes that `PATH` to its workers ([shared environments](cli-shared-environments.md#execution)).
Login-shell output before the bridge marker is discarded like other startup output.

Every call uses the account's SSH configuration, keys, agent and `known_hosts`, with
these overrides: `BatchMode=yes`, `ForwardAgent=no`, `ForwardX11=no`,
`ClearAllForwardings=yes`, `ConnectTimeout=15`, `ServerAliveInterval=15` and
`ServerAliveCountMax=3`. SSH never prompts, so an unknown or changed host key and a
missing key fail. Run `ssh <destination>` once to accept a host key. Host-key
checking is never disabled. No management port is opened.

The remote command is one shell string built from single-quoted arguments, so
paths with spaces or quotes reach the remote CLI unchanged. Remote access is a
transport, not a sandbox. Project isolation on the target is whatever its own
installation enforces.

## Command routing

`--remote <name>` is accepted on `attach`, `service`, `project` and `keys` commands
and cannot be combined with `--environment`. `--target <name>` picks either one by
name; see [One target flag](#one-target-flag-cli-01200-os-2215).

Protocol commands run on the host over the SSH bridge: `attach`, `service status`,
`pause`, `reload`, `stop`, `outcome` and `service runs *`. The host renders output
and the existing hello negotiation rejects an incompatible service before any
mutation. `service stop` stops only the service. Nothing here stops a remote
machine or container.

Other commands are forwarded to the remote CLI with this terminal attached:
`service start`, `service logs`, `project add/list/remove/shell`. The host rebuilds
only the arguments given on the command line: root options first, then the
command path, its options, and `--` before operands. With a
TTY, SSH and `docker exec` allocate one so prompts work. The remote exit status
becomes the host exit status. `service start` without `-b` stays in the foreground
and stops when the SSH session ends; always use `service start -b --remote <name>`. `--api-key` on a forwarded command appears in
the remote process list, as when run there directly; prefer the prompt.

`keys` runs on the host against the remote service; see
[Managed credentials](#managed-credentials-cli-01190-os-2020). `browser` and
environment lifecycle commands are not forwarded. Run them on the target.

Restart is `service stop --remote <name>` then `service start -b --remote <name>`.
Updating the remote CLI (drain, install, health check, rollback) is deferred to
OS-2147. Convoy does not know how a user-managed VM installed the CLI. Until
then an incompatible target is rejected at hello, before any mutation, with
upgrade guidance, and the user updates it by hand.

## Bridge

The bridge runs `echo convoy-bridge-ready-1; exec convoy service bridge`. The host
discards stdout before that marker, so shell startup output cannot corrupt framing.
More than 64 KiB before the marker fails. Remote stderr is a bounded diagnostic
and is never parsed as protocol. Exit 255 reports the SSH error, 127 reports a
missing CLI (or `docker`), and other failures report the remote diagnostic. The
service client shows these transport errors verbatim. The bridge reports a stopped
service as "Service unavailable."; the host adds
`Start it with convoy service start -b --remote <name>.`

Closing the client kills the local `ssh`. The remote bridge sees EOF and exits.
SSH or network loss detaches only; agents and other clients continue. If the
first connection fails at the transport (SSH error, missing CLI, stopped remote
service), `attach` exits with that error. After one successful connection it
reconnects every second and resumes from its cursor or resnapshots after a gap.
Unknown mutation outcomes are never replayed, as in [cli-service.md](cli-service.md).

## TUI

`convoy tui` lists saved remotes after managed environments, with transport `ssh`.
It uses the same `ServiceClient` and rendering as other targets.

CLI 0.109.0 wires these Actions to single SSH commands:

- Start runs `convoy service start -b` with a 60-second limit, then reconnects.
- Saved logs run `convoy service logs --json` and validate each line. Output
  before the bridge marker is discarded, as for the bridge.
- Project shell runs `convoy project shell <profile> --expected-identity <id>`
  over `ssh -t`, after the existing pause confirmation.

Remotes have no environment maintenance.

### Guided Add project and credentials, CLI 0.113.0 (OS-2158)

Add project opens the same guided form as other targets. The form first opens the
bridge and reads hello. A service that does not advertise `project-setup-v1` shows
"Remote update required" with `Update the CLI on <name>, restart its service, then
retry. Or add projects from a terminal: convoy project add <path> --remote <name>.`
Nothing is sent to the remote. A failed probe (SSH error, stopped service) offers
Retry. Submit probes hello again; a failure there returns environment unavailable
before any registration.

Registration runs the hidden `convoy project setup` on the remote over one SSH
call. It reads the guided request, API key included, as JSON on stdin and prints
the structured result as its last stdout line. It runs the same entrypoint as
Docker and Local targets, so the API key never enters argv or the remote process
list. A non-zero exit or unreadable result is an unknown outcome, as for Docker.
There is no allow-domain step: a VM has no managed firewall, and the review says
to allow the deployment host if outbound access is restricted.

The Credentials tab reads status with `convoy keys status --json` over SSH and
validates it with the shared schema. Changes use `credentials.mutate` over the
bridge, as before. An AWS key's Region endpoint is not allowed automatically; the
review says to allowlist it on that host. Native login from the Credentials editor
hands over to the runtime login Action, which runs through the existing `ssh -t`
shell handoff.

Since CLI 0.122.0, applied registration opens the optional
[runtime access step](cli-tui.md#runtime-access-after-registration-cli-01220-os-2167).
It reads credential status over one SSH command, assigns through credentials.mutate
on the existing bridge and uses the same ssh -t login handoff. Skip performs no
credential mutation. Pending application shows the service-start guidance instead.

Errors from a transport that failed before hello carry no request ID or epoch,
because no request reached the service.

## Managed credentials, CLI 0.119.0 (OS-2020)

`convoy keys <command> --remote <name>` manages the remote's own managed
credential store, the same entries, bindings and revisions as `keys` run there.
These rules also apply to `--environment` ([cli-environments.md](cli-environments.md)).
The `keys` commands enforce them for both targets:

- With `--remote`, the host first prints `Remote <name>: <host>[ in <container>].` on stderr, so the
  target machine is clear before anything changes.
- The masked prompt, `--stdin` and `--from-env` read on the host. `--from-env`
  names a host variable. The secret travels inside one `credentials.mutate`
  frame over the SSH bridge, never in argv on either machine.
- Mutations (`add`, `use`, `unassign`, `rotate`, `rollback`, `disable`, `remove`)
  need the remote service running. The service serializes them, so two hosts
  managing one remote see one revision order. There is no offline write and no
  host fallback: a lost reply is an unknown outcome; run `keys status --remote`
  before retrying.
- `status` and `list` run `convoy keys status --json` over one SSH call and
  validate it with the shared status schema. They work while the service is
  stopped, reporting it offline.
- Only managed entries are reachable. `add` requires `--auth api-key` with
  `openai`, `anthropic`, `mantle`, `bedrock` or `cursor`, and `use`/`unassign`
  require `--runtime` and `--profile`. Legacy providers stay in the host's
  `config.toml`; host config and the host store are never read or written.
- After the remote stores an AWS entry, the host prints `If outbound access is
  restricted, allow <endpoint> on <name>.`. A VM has no managed firewall, so
  nothing is allowed automatically.
- Follow-up hints repeat `--remote <name>` (or `--env <name>`). Apply changes to running projects with
  `service reload --profile <key> --interrupt --remote <name>`.

Authorization is the SSH account: anyone who can run the remote service bridge
can manage its credentials, as on the machine itself. Isolated project workers
have private homes without the host's SSH keys or `remotes.json`, and the
service socket is not mounted into projects, so they cannot reach these
operations. Without `--remote` every `keys` command keeps its local behavior.

## One target flag, CLI 0.120.0 (OS-2215)

`attach`, `service`, `project` and `keys` also accept `--target <name>`. The host
looks the name up in `~/.convoy/remotes.json` and among managed environments
(`~/.convoy/environments/<name>/environment.json`), then continues exactly as
`--remote <name>` or `--environment <name>`. Routing, forwarding, the Docker
hello probe and firewall rules do not change. `--target` is never forwarded to
the remote CLI. `--env`, `--environment` and `--remote` stay as they were.

- `--target` with `--remote` or `--environment` fails: `Use one of --target,
  --remote or --environment.`
- An unknown name fails with `No environment or remote named <name>.` and both
  create commands.
- Both lists use the same name pattern, so one name could be in both. `remote add`
  refuses a name a managed environment has, and `convoy run` (and TUI creation)
  refuses to create an environment named like a saved remote. Existing
  environments are not checked, so resuming one keeps working.
- A clash saved before 0.120.0 fails with `<name> is both a managed environment
  and a remote. Use --env <name> or --remote <name>.` Nothing guesses.
- `browser` and the `environment` subcommands stay Docker-only and keep `--env`.

The lookup reads two local files. It adds no SSH or Docker call.

## Cost

No Convex function, table or poll is added. Each bridged command opens one SSH
connection; forwarded commands open one. `remote add` opens one, or two when it searches the install paths. The remote
service performs the same backend reads as a local client. Reconnect attempts are
one SSH connection per second while a connected service is unreachable, bounded by
`ConnectTimeout` during network loss. Each TUI Start, Saved logs or Shell action
opens one SSH connection when the user selects it; none polls. Opening Add project
opens one bridge for the hello probe, and Submit opens two: the probe, then the
setup call. Each Credentials status read opens one. `keys --remote` opens one SSH connection
per command: the bridge for a mutation, `keys status --json` for a read.

Runtime access account status uses one SSH `project account` request with the
confirmed project identity. CLI 0.123.0 and an updated project launcher are
required on the target. The [isolation spec](cli-project-isolation.md#native-account-status-cli-01230-os-2167)
defines the sandbox check and safe response; unsupported checks remain unknown.
