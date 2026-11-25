# User environments

OS-2241. An environment is a place that runs an operating system and executes
its owner's CLI threads: a laptop, dev box, VM, devcontainer or managed Docker
container. Its owner enrolls it once. After that it is offered in every project
where the owner can run threads, and a project gets set up on it the first time
the owner picks it there. Nobody runs `project add` on the machine for each
project.

The environment's mode, shared or isolated, works as in
[shared environments](cli-shared-environments.md). This spec covers what sits
above it: the environment as a principal, where it is offered, first-use setup,
and settings. Organization and project environments, and on-demand sandboxes,
are out of scope. The `scope` field and the set-up request leave room for them.

Prototype: `/playground/user-environments`. Terms: [CONTEXT.md](../../CONTEXT.md).

## Model

```
environments   owner, scope: "user", name, hostname, mode, url-independent id,
               apiKeyId, lastSeenAt, availability, soft delete
cliProfiles    + environmentId (optional)
setupRequests  environmentId, projectId, profileKey, folder, source,
               status: pending | failed, error
apiKeys        kind gains "environment"; a worker key may have an environment
               key as its source
```

A CLI profile stays one user and one project. An environment has one profile
per set-up project, and that profile carries `environmentId`. The composer,
threads, workflow runs and MCP keep reading profiles and never learn about
set-up requests. A request exists only while a setup is pending or failed;
success deletes it, because the profile the CLI registers is the result.

A project added on the machine (`project add`, TUI Add project) registers a
profile with `environmentId` and needs no request.

## Enrollment

`convoy environment enroll` enrolls a machine. It joins the existing
`convoy environment` group from [managed environments](cli-environments.md),
with one difference. Every other subcommand there requires `--env <name>`;
for `enroll` it is optional.

- Without `--env`, it enrolls the machine it runs on.
- With `--env <name>`, it enrolls that managed Docker container from the host.
  The container has no browser, so the host shows the device code and passes
  the key into the container over stdin, as project setup passes keys today.
- `convoy run --env <name>` never enrolls. It talks only to Docker and can run
  with nobody at the keyboard to approve a code. On an unenrolled environment
  it prints the enroll command and carries on.
- `enroll` starts the service, so an enrolled environment is always listening.
- The TUI shows whether the machine is enrolled, with Enroll in its Actions
  panel.

The first slice enrolls shared environments, so `enroll --env` builds on
[shared Docker environments](cli-shared-environments.md#shared-managed-docker-environments)
(OS-2251), which land first. After a reboot, `convoy service enable` brings
the service back: at login on a Mac (OS-2255), and at boot on a Linux VM with
lingering on (OS-2466; see
[start at boot on Linux](cli-shared-environments.md#start-at-boot-on-linux)).

Enrollment runs the browser device-code flow of
[browser login](cli-browser-login.md) with `purpose: "environment"` on the
request. The poll that completes it creates the `environments` row and one key
of kind `environment` with no expiry. The key lives until the environment is
deleted; rotation is OS-2244. The command reads the mode with
`environmentMode()`, which falls back to the launcher registry when
`~/.convoy/environment.json` is missing. The web never chooses the mode. To
change it, delete the environment and enroll again.

### Backends

An environment belongs to one backend URL. The identity file,
`~/.convoy/environment.json`, gains an `enrollments` list keyed by URL, each
with the environment id and key. One machine enrolled to prod and to dev is two
environments, one in each backend's settings, and the service opens one
connection per enrollment. `enroll --url <url>` picks the backend; without it,
the command prompts as `setup` does. Deleting one enrollment leaves the others.
Profiles keep their own `url` and `api_key`, so `connect --profile` and
existing registrations are unchanged.

### Existing profiles

Enroll adopts the machine's shared registrations: they switch to the
environment key at the next service reload, and their profiles get
`environmentId` at the next register, so those projects show as set up.
Ordinary `connect` profiles are left alone and keep working on their own keys.
No existing key is revoked.

### Re-enrolling and clones

One live service per environment. A second service connecting with the same
key gets the session-conflict answer `connect` gets today, naming the hostname
that holds the connection, and the user chooses to take over or stop. A copied
disk therefore shows up as a conflict, not as a silent duplicate. No machine
fingerprinting.

`enroll` on a machine whose identity file names a live environment of the
approving user replaces that environment's key and keeps its profiles. Any
other case, including an identity file for a deleted environment or another
user's, creates a new environment.

The web can't create an environment, because it can't reach a machine. Add
environment in settings shows the enroll command with this backend's URL
filled in, as the Backend URL block does today.

## Where it is offered

Only the owner sees their environment. It is offered in a project when the
owner is currently a member with `CLI_THREAD`, the permission that runs threads
today. The check runs on every read. Worker issuance from a manual key keeps
`PROJECT_UPDATE`.

Availability is an environment setting. "All my projects" is the default.
"Selected projects" (OS-2304) limits it to the projects picked. Deselecting a
set-up project removes its setup through the same path as Delete on the
profile.

## First use in a project

The composer's working-directory dropdown lists profiles grouped as today. A
profile with `environmentId` shows the environment's name, mode and online
state as its group heading, and renaming the environment renames the heading.
The profile hover card gains an Environment row above Machine. The pill beside
it that picks between working locally and a worktree stops calling itself
"Environment" and reads "Worktree".

Below the groups, a "Not set up in {project}" group lists the owner's other
offered environments, each with its mode and a Set up action. Set up opens a
popup with defaults:

| Field | Default |
|---|---|
| Source | Empty folder, or Clone from URL. The URL is prefilled from the `gitRemoteUrl` of the owner's other profiles in the project when there is one. The connected repository becomes the default once the GitHub integration exists |
| Folder | Shared: `~/convoy/<key>`, any path accepted; an existing folder is reused as is, and a clone target must be missing or empty. Isolated: `<key>` under the workspace root, which must be absent |
| Profile key | The project alias, lowercased |

An alias is unique inside one organization and an environment spans them all,
so a key or folder already used on this environment gets the organization slug
in front: `acme-os`. A later alias rename changes nothing on the environment.

Submitting writes a set-up request with status `pending`. The service holds
one environment-scoped subscription to its pending requests, runs the existing
`project add` path and either registers the profile or marks the request
`failed` with the error. In isolated mode the service mints the project's
worker key from the environment key, so `isWorkerSourceKey` accepts an
environment key as a source, and the worker key carries no expiry either.

| State | Dropdown and settings |
|---|---|
| pending, environment online | "Setting up…", not selectable, Cancel |
| pending, environment offline | "Waiting for {environment}", Cancel |
| failed | The error, Retry and Dismiss. Retry reopens the popup with the previous values |
| ready | A profile like any other |

A pending request has no timeout. When setup succeeds the composer selects the
new working directory. Only the owner sees requests.

A shared environment clones as its account, with that account's `gh auth
login` or git credentials, and `GIT_TERMINAL_PROMPT=0` turns a missing login
into a failed request whose error names `gh auth login`. An isolated
environment clones public repos only; private repos wait for the GitHub
integration's installation tokens, and the popup says so.

### Other hosts of the dropdown

Workflow runs, agent auto-submit and MCP `list_cli_profiles` see profiles only,
so they never meet an unfinished setup, and an MCP agent can't start one. The
threads page's no-profiles gate counts offered environments, and its empty
state shows "Set up {environment} here" for an enrolled user. A user with no
environment sees `npx @useconvoy/cli environment enroll` first and `connect`
under "Other ways to connect".

## Online, idle and offline

The service sends one heartbeat per environment, which writes `lastSeenAt` at
most once a minute. Settings shows online or last seen from it. No
subscription reads that row.

Every set-up project keeps a worker today. From OS-2302 on, the service stops
a worker after 15 minutes with no running or queued thread and starts it when a
thread arrives, learning about it through the environment-scoped subscription.
A set-up project is online whenever its environment is. The 128-worker limit
counts running workers.

## Deleting

Delete in settings asks the user to type `delete`, with the dialog pattern the
worktree revert uses. One mutation then deletes the environment key and the
worker keys sourced from it, ends the environment's sessions, fails its
streaming messages with "Environment deleted", and soft-deletes its profiles.
Files stay on the machine.

On the machine the claim subscription flips first, so a running turn stops
within seconds. The worker stops its runtime before exiting, and the service
stops retrying. The TUI says the environment was deleted and shows the enroll
command.

## Removing one project

Delete on a profile with `environmentId`, in the dropdown or in settings,
tells the service to stop the worker and drop the registration, and deletes
the project's worker key in isolated mode. Files stay. Deleting a plain
profile keeps today's behavior.

## Losing access

When the owner loses access to a project, or the project is deleted, the
environment stops being offered there and no new threads start. A turn already
running finishes, and its output stays in the thread. The worker stops when it
is idle (OS-2302), and the setup is still there if access returns. Nothing
else is cleaned up.

Finishing the turn needs a fix outside this feature: `complete`, `fail` and
`releaseClaim` require `CLI_THREAD` on the project, so today the turn's output
is saved and the message sits in `streaming` until the watchdog fails it.
Those three calls drop to the owner-and-claim check the other run mutations
already use.

## Settings

Environments are a section of the user settings dialog, between CLI profiles
and API keys. They belong to a user, not an organization, so the section shows
the user's environments across all organizations.

Each row shows name, mode, hostname, online or last seen, and how many projects
are set up. Rename and Delete are in the row menu. The expanded row shows what
the mode means, the availability setting, and every offered project with its
state: not set up, waiting, setting up, failed with the error, or ready with
its folder. Environment keys don't appear under API keys.

## Cost

New: one `environments` row per machine, one `setupRequests` row per unfinished
setup, one heartbeat mutation per environment per 30 seconds throttled to one
write a minute, and one subscription per environment on its pending requests
(and, from OS-2302, on new threads for its stopped projects). The dropdown's
"Not set up" group is one indexed read of the owner's environments. The
no-subscription line in [shared environments](cli-shared-environments.md#cost)
predates this spec.

## Delivery

1. OS-2297: enroll a machine and delete it from the web.
2. OS-2298: offered in every project; first use sets up a folder on a shared
   environment.
3. OS-2299: clone from a URL on a shared environment.
4. OS-2302: stop idle workers, start on demand.
5. OS-2303: remove a project's setup from the web.
6. OS-2300: isolated environments set up projects on first use.
7. OS-2304: restrict to selected projects.

OS-2301 (GitHub token for isolated environments) is cancelled. The
`complete`-after-access-loss fix is its own bug task and lands before slice 2.
