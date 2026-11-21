# CLI Provider Keys (Bedrock / Mantle / claude.ai / API keys per profile)

Profiles can pin the model provider their agents run through, instead of
inheriting whatever the machine's global Claude Code config happens to be.
Keys are stored **only on the user's machine** in
`~/.config/convoy/config.toml`; they are never registered with or synced to
the backend.

## Config format

```toml
[keys.work-bedrock]
provider = "bedrock"        # or "mantle"
token = "..."               # injected as AWS_BEARER_TOKEN_BEDROCK
region = "us-east-1"        # optional, injected as AWS_REGION

[keys.claude-sub]
provider = "anthropic"      # credential-free: pins this machine's Claude sign-in

[profiles.os-local]
# ...existing profile fields...
provider_key = "work-bedrock"   # optional; absent = machine's own Claude config
```

- `[keys.<name>]` entries are named, reusable providers (`provider`, plus
  `token` and optional `region` for the credential-carrying ones).
- `provider = "anthropic"` takes **no** `token` and no `region`. It is not a
  credential: it is an explicit opt-out that forces agents onto this machine's
  Claude sign-in (claude.ai subscription). The Zod schema requires `token`
  only for `bedrock`/`mantle`; a token stored on an `anthropic` entry would
  never be used, so `keys add --provider anthropic` refuses `--token` and
  `--region` instead of silently keeping them.
- `profiles.<key>.provider_key` assigns one entry to a profile.
- A profile without `provider_key` connects with the machine's own Claude
  config — *whatever* that config says. This is **not** the same as an
  `anthropic` entry: unset means "follow the machine", `anthropic` means
  "claude.ai regardless of the machine" (see Connect behavior below).

## Commands

- `convoy keys add <name> [--provider bedrock|mantle|anthropic] [--token <t>] [--region <r>]`
  — stores (or overwrites) an entry; prompts for provider/token when omitted
  (token via masked prompt). `--provider anthropic` stores no credential and
  errors if `--token`/`--region` are passed.
- `convoy keys list` — lists keys with masked tokens and the profiles using
  each key.
- `convoy keys remove <name>` — deletes a key; refuses while any profile
  still references it.
- `convoy keys use <name> [--profile <key>]` — assigns the key to the
  resolved (or explicitly named) profile.
- `convoy keys unassign [--profile <key>]` — clears the assignment.

Assignment changes take effect on the next `convoy connect`.

## Connect behavior

- At `convoy connect`, the resolved profile's `provider_key` is looked up.
  A `provider_key` that references a missing `[keys.*]` entry is a **fatal
  error** (structured `failed` event in `--json` mode) — connecting silently
  on the machine's default config would be a misconfiguration.
- `convoy connect --provider-key <name>` overrides the profile's assigned
  key **for that run only** — nothing is written to config.toml; the next
  plain `convoy connect` uses the profile's assignment again. A `<name>`
  that doesn't match a `[keys.*]` entry is the same fatal error as above.
  Resolution order: `--provider-key` flag → profile `provider_key` → none
  (machine's own Claude config).
- The key's env is injected into the CLI **process env** before runtime
  detection and before any agent spawns, so detection, the registered
  `availableClis` provider metadata, and every agent subprocess all agree:
  - `bedrock` / `mantle`:
    - `CLAUDE_CODE_USE_BEDROCK=1`
    - `CLAUDE_CODE_USE_MANTLE=1` (mantle) / `0` (bedrock)
    - `AWS_BEARER_TOKEN_BEDROCK=<token>`
    - `AWS_REGION=<region>` (only when set)
  - `anthropic`:
    - `CLAUDE_CODE_USE_BEDROCK=0`
    - `CLAUDE_CODE_USE_MANTLE=0`
  - Every entry also sets `CLAUDE_CODE_USE_VERTEX=0` and
    `CLAUDE_CODE_USE_FOUNDRY=0`, so a settings file that enables Vertex or
    Foundry cannot compete with the chosen provider (CLI 0.115.0).
    - No token var and no region: an `AWS_BEARER_TOKEN_BEDROCK` inherited
      from the environment needs no unsetting, because Claude Code ignores a
      stored token while the flags are off — the same rule detection applies.
- Process env alone is **not** enough for the spawned Claude Code: the
  runner loads `settingSources: ["user", "project", "local"]`, and Claude
  Code applies `env` from `~/.claude/settings.json` ON TOP of its process
  env — a machine that pins `CLAUDE_CODE_USE_BEDROCK=0` there would silently
  revert the run to claude.ai and fail Bedrock model names. Command-line
  settings outrank user settings, so connect also stores the provider env
  as JSON in `CONVOY_CLAUDE_PROVIDER_ENV`, and the Claude runner re-sends
  it per run through the `--settings` flag. The user's settings.json is
  **never modified**; only these variables are overridden, all other settings
  still apply.
- `--settings` gets a file path, never the JSON itself, because the env holds
  the token and argv is readable by every local user (`ps`). Each run writes
  the JSON to `settings.json` in a fresh 0700 `convoy-claude-settings-<pid>-*`
  directory under the temp dir, with mode 0600, and deletes the directory when
  the run ends (OS-2016). A CLI killed mid-run leaves its directory behind, so
  creating a Claude runner removes this user's directories whose `<pid>` no
  longer exists. Directories of live processes, including other CLIs, stay. Ultracode's setting travels in the same file. Until
  CLI 0.115.0 the JSON, and with it the Bedrock or Mantle token, went into
  argv.
- That `--settings` layer is what makes the `anthropic` entry meaningful: a
  machine (or devcontainer) whose `~/.claude/settings.json` enables
  Bedrock/Mantle would beat plain inherited `0` flags, but not the command-line
  layer. Leaving `provider_key` unset cannot achieve this — with no key there
  is no `--settings` layer at all, so the machine config wins.
- Connect prints the active provider (`Provider: AWS Bedrock ("work-bedrock")`,
  `Provider: Claude.ai subscription ("claude-sub")`).

## Provider detection (no key assigned)

Detection follows `docs/specs/cli-thread-model-selection.md`: explicit
`CLAUDE_CODE_USE_BEDROCK=0` / `CLAUDE_CODE_USE_MANTLE=0` wins over the
presence of a stored `AWS_BEARER_TOKEN_BEDROCK` or a `us.anthropic.*`
default model. A machine that keeps Bedrock credentials around but has the
flags off reports `anthropic` (claude.ai), matching what Claude Code
actually uses.

Because no key is assigned there is no `--settings` layer, so Claude
settings `env` outranks the inherited process env in detection — the same
order Claude Code itself applies. A container that inherits
`CLAUDE_CODE_USE_MANTLE=0` from its host but sets `1` in its own
`~/.claude/settings.json` therefore reports `mantle` and gets Mantle model
names, instead of reporting `anthropic` and sending an id Mantle rejects.

Assigning an `anthropic` key is the supported way to override that container:
its `0` flags travel through `--settings`, so detection and the run both
report `anthropic`.

## User-visible provider display

- The profile hover card ("Available agents") shows a human label next to
  each runtime version: `anthropic` → **Claude.ai**, `bedrock` →
  **AWS Bedrock**, `mantle` → **AWS Bedrock (Mantle)**; unknown values
  render as-is. Future providers (Vertex, Azure) extend this label map.
  The desktop app and `convoy keys` output use the same map, except that a
  stored `anthropic` entry reads **Claude.ai subscription** — there it names a
  chosen provider rather than a detected one.
- The connect banner logs the detected provider per runtime as
  `(provider=claude|bedrock|mantle)` — the `anthropic` slug is displayed as
  `claude`, and there is no separate Bedrock yes/no note.

## Desktop app

The desktop settings window manages the same config (see
`desktop-app.md` → Settings window): a dedicated **API keys** tab
adds/lists/deletes `[keys.<name>]` entries in one shared list, with the same
delete-while-referenced guard as `convoy keys remove` (Codex users are labeled
`profile (Codex)`); each profile card has a **Claude Code provider**
select bound to `provider_key` ("This machine's Claude config" = unset,
listed entries use a `key:` value prefix so a key named like the sentinel
cannot collide with it) and a **Codex provider** select bound to
`codex_provider_key` that lists only Bedrock/Mantle keys with a region. Selecting **Claude.ai subscription** in the API keys
form hides the token/region inputs and stores a credential-free entry.
Changing a profile's provider restarts its running agent so the change
applies immediately.

## Security

- `config.toml` is written with mode `0600` (directory `0700`).
- Tokens never leave the machine: they are not part of agent registration,
  heartbeats, or any Convex table.
- Agent output can still quote a token (an agent that runs `env`, an error
  that echoes a request). The connect process's Convex client replaces the
  Claude key's token, the Codex AWS token and a managed Codex key, and their
  JSON-escaped forms, with `[redacted]` in every mutation arg, so chunks,
  failure messages and permission prompts of every runtime are covered.
- A token the model writes usually arrives split across streamed deltas, and
  redaction matches only the whole token. So the chunk flush buffer holds back
  the longest ending of a delta's text that a token starts with, at most one
  character shorter than the token. The rest of the delta goes out on the
  normal schedule. The next delta of the same item joins the held ending, so a
  token is always redacted whole. Each stream holds its own ending: the main
  agent, a Claude subagent (`parent_tool_use_id`) or a Codex child. Chunks from
  other streams pass by it. The next chunk of its own stream that does not
  join it releases it first, and so does the end of the run. No fragment is
  uploaded, so failed and stopped runs, which keep their delta rows, need no
  cleanup. A failed run loses only the held ending (OS-2109).
- This covers text, reasoning and Claude tool-input (`input_json_delta`)
  deltas of every runtime. Each runtime's `ChunkStreamPolicy` reads and
  rewrites the delta text. One gap is accepted: a chunk from the same stream
  in the middle of an item, such as a Codex usage update, releases the held
  ending early. Codex sends usage after the model's response, not mid-message.
- Claude Code's local debug logs are not redacted; they stay on the key
  owner's machine.
- `keys list` masks tokens (`ABSKTW...gtE=`-style prefix/suffix) and prints
  `none (this machine's Claude sign-in)` for credential-free entries.

## Codex on AWS Bedrock and Mantle (OS-2105)

Ordinary profiles can run Codex through OpenAI models hosted on AWS. The
assignment is separate from Claude Code's, so changing one never changes the
other.

```toml
[keys.work-mantle]
provider = "mantle"        # or "bedrock" for Bedrock Runtime
token = "..."
region = "us-east-1"       # required for Codex

[profiles.os-local]
provider_key = "claude-sub"          # Claude Code, unchanged
codex_provider_key = "work-mantle"   # Codex; absent = this machine's Codex config
```

- `convoy keys use <name> --runtime codex [--profile <key>]` sets
  `codex_provider_key`. Codex accepts only `mantle` and `bedrock` entries that
  have a non-empty `region`; Codex's bearer-token auth needs `AWS_REGION`.
  `anthropic` entries and keys without a region are refused.
- `convoy keys unassign --runtime codex` clears it and Codex goes back to the
  machine's own Codex config and login.
- `keys remove` refuses while either runtime references the key, and
  `keys list` labels Codex users as `profile (Codex)`. Editing a key that Codex
  uses (provider or region) is refused when the result could no longer serve
  Codex.
- Isolated (`project_isolation`) profiles keep the managed credential flow
  below. `--runtime codex` routes there for them, and a `codex_provider_key` on
  an isolated profile is rejected. They use a managed Mantle or Bedrock entry
  instead (OS-2107, below).
- Assignment changes apply on the next `convoy connect`. Running threads keep
  the provider they started with.

### Connect and execution

- Connect resolves `codex_provider_key` with the same fatal handling as
  `provider_key` and prints `Codex provider: AWS Bedrock (Mantle) ("work-mantle", us-east-1)`.
  `--provider-key` overrides only Claude Code.
- The token never enters the CLI process env, registration or heartbeats. The
  runner factory receives it and puts `AWS_BEARER_TOKEN_BEDROCK` and
  `AWS_REGION` into the Codex child env only.
- Codex children also drop the env that Claude's key injected
  (`AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `CLAUDE_CODE_USE_*` and the
  `--settings` marker are restored to the machine's original values). A
  profile with a Claude Mantle key and no Codex key therefore runs native Codex,
  never Claude's AWS account.
- Provider selection is a per-process override: `-c model_provider="amazon-bedrock"`
  for Mantle, `-c model_provider="amazon-bedrock-runtime"` plus
  `-c web_search="disabled"` for Bedrock Runtime. `~/.codex/config.toml` and
  native auth files are never modified.
- AWS providers require the app-server transport. `--codex-exec` with a Codex
  key fails connect, and an old codex binary is not downgraded to exec.
- Before any thread opens, `config/read` must report the expected
  `model_provider`, no `[model_providers.<id>]` override of the built-in
  provider, and no `service_tier` other than `default` (Fast mode does not
  exist on Bedrock). The native OpenAI login probe is skipped.
- `thread/start`, `thread/resume` and `thread/fork` send `modelProvider` and
  must get the same value back. A resume that comes back on another provider
  fails with "Start a new thread". Nothing falls back to native login or
  another provider.
- Runs need an explicit model ID of the provider (`openai.*` for Mantle,
  `<geo>.openai.*` for Bedrock Runtime). A missing, default or native model
  fails before codex starts, so an older backend that drops the provider
  metadata cannot send `gpt-6-sol` to Mantle.
- `/usage` fails with a pointer to the AWS console; account quota is a ChatGPT
  concept. `/compact` works.
- The token is redacted wherever it appears whole: deltas, complete items,
  errors, stderr and debug logs. Deltas still stream. On an ordinary profile
  the agent's shell tools can read `AWS_BEARER_TOKEN_BEDROCK` (codex-cli
  0.156.1 passes it through, as Claude Code's Bash tool does for Claude's key),
  so dropping deltas would cost streaming without protecting the token.
- A 401 or "Invalid bearer token" adds a hint to replace the key's token. A 403
  names token, IAM and model access in the region as possible causes, since a
  403 alone does not prove the token is wrong. A missing model suggests another
  model or region. None of these mention `codex login`.

### Detection and models

- Detection reports `{ type: "codex", version, provider: "mantle" | "bedrock", region }`
  for an assigned profile and plain `{ type, version }` otherwise. The backend
  stores both fields on the existing session and profile snapshots; an
  unrecognized provider registers as `unknown` with no region.
- Model mapping and the composer notice are in
  `docs/specs/cli-thread-model-selection.md` → Codex on AWS.
- Usage keeps the reported AWS model ID (`openai.gpt-6-sol`). Codex reports
  no cost, so these IDs are estimated from the catalog's AWS rows (Mantle and
  `us.` add 10% over the direct API, `global.` matches it). Claude Code's
  list-priced Bedrock and Mantle usage is re-estimated from the same rows. See
  `cost-tracking.md`.

## Managed OpenAI keys for isolated Codex (OS-2015)

New OpenAI entries use the versioned owner-only `credentials-v1.json` beside
config.toml. Legacy Claude entries keep their existing semantics. Identity-based
Codex bindings select managed, disabled or native mode. Profile aliases share a
binding. New names cannot collide with legacy keys. No automatic migration occurs.

Managed add/rotate accepts a masked prompt, `--stdin` or `--from-env <name>`,
never a token argument. `keys use ... --runtime codex` assigns; `keys unassign
--runtime codex` disables Codex rather than silently restoring subscription
billing. `--native-login` explicitly restores private native auth. `keys disable`
prevents future grants, not provider-side use of already delivered keys.

The service reports desired/applied descriptors without credential bodies. Live
changes wait for targeted `service reload --profile ... --interrupt`; direct
workers require reconnect. No automatic drain is inferred from active run counts.
Changes may interrupt all runtimes in the selected project. Paused workers stay
paused. Saved configuration is distinct from application and provider verification.

Codex receives only its assigned credential over the launcher pipe and app-server
RPC. Managed runs require ephemeral auth storage and explicit OpenAI API mode,
preserve native auth files/history, and reject incompatible settings or exec-mode
fallback. Keys are never injected into worker-wide environment or saved profiles.
Manual shells retain their own auth. Authorized project code can extract a key
granted to that project; only central/unassigned credentials are protected.

The store uses bounded validated records, 0700/0600 permissions, symlink rejection,
a writer lock and atomic replacement with sync. Keep up to 32 explicit revisions
for rollback; refuse further rotation until the operator stops workers, unassigns
and recreates the entry. Removal conservatively refuses while any project lease
is active because direct workers do not report applied revisions. Through the
service (CLI 0.107.0), a lease held by the service's own live worker whose applied
descriptor names the entry for no runtime (Codex, Claude Code, since CLI
0.117.0 Cursor, and since 0.118.0 an OpenCode slot) does not block removal; direct
workers and other leases still do. Malformed stores
fail closed for new launches, while the service retains valid running workers.

Mixed old/new execution is unsupported. New clients require service and launcher
credential capabilities before mutation or delivery. Old binaries cannot enforce
new bindings. Upgrade the service and installed privileged launcher together.
The desktop continues to edit only legacy TOML; it does not manage this store.

From another machine, `--env <name>` ([cli-environments.md](cli-environments.md))
or `--remote <name>` ([cli-remote.md](cli-remote.md#managed-credentials-cli-01190-os-2020))
manages the target's store through its service, never host storage.

A private `credentials-v1.json.enabled` marker records that the environment opted
in. If the store later disappears while the marker remains, readers fail closed
instead of selecting native login. Create/sync the marker before the first store
rename. Restore the store and marker together from a protected backup; deleting
them is not a supported unassignment operation.


## Managed AWS keys for isolated Codex (OS-2107)

The managed store also holds Mantle and Bedrock Runtime entries, so Codex on an
isolated profile can run through AWS like an ordinary profile (OS-2105).

```bash
convoy keys add work-mantle --provider mantle --auth api-key --region us-east-1
convoy keys use work-mantle --profile a --runtime codex
```

- `--auth api-key` makes a `mantle` or `bedrock` entry managed. Without it the
  entry stays a legacy `[keys.*]` entry for ordinary profiles. `--region` is
  required and must look like an AWS Region (`us-east-1`, `us-gov-west-1`).
  The token comes from the masked prompt, `--from-env` or `--stdin`, as for
  OpenAI entries.
- The entry stores `aws = { provider, region }` beside its revisions. Rotate,
  rollback, disable, remove, `use` and `unassign` (including `--native-login`)
  work as for OpenAI entries. Rotation keeps the provider and region; a new
  region needs a new entry.
- An older CLI cannot read a store that has an AWS entry (the schema is
  strict), so it fails closed instead of sending an AWS token to OpenAI.
- Launch delivers `{ mode: "mantle" | "bedrock", secret, region }` over the
  launcher pipe. The launcher advertises `credentials-aws-v1` and checks the
  fields and the Region before spawn. Adding an AWS entry, service startup and
  direct connect refuse a launcher without it, as for `credentials-v1`.
- Inside the boundary the worker turns the payload into the OS-2105 Codex
  provider. Codex gets `AWS_BEARER_TOKEN_BEDROCK` and `AWS_REGION` in its child
  env only, with the same provider checks, model catalog, provider label, error
  hints and redaction. A failed run never falls back to native login, and the
  managed OpenAI login path is not used.
- `keys status` shows the provider and Region of an AWS entry
  (`work-mantle: AWS Bedrock (Mantle), us-east-1, ...`).
- Network: with `--env`, adding an AWS entry first allows the endpoint Codex
  calls for that Region, `bedrock-mantle.<region>.api.aws` or
  `bedrock-runtime.<region>.amazonaws.com`, through the environment's
  `allow-domain` helper. Inside the container or on a VM, the operator adds the
  host to the allowlist (see the project-isolation template README).

## Managed AWS keys for isolated Claude Code (OS-2108)

The same managed Mantle and Bedrock entries serve Claude Code on an isolated
profile. One entry can serve both runtimes, each with its own binding.

```bash
convoy keys add work-mantle --provider mantle --auth api-key --region us-east-1
convoy keys use work-mantle --profile a --runtime claude-code
```

- `keys use|unassign --runtime claude-code` on an isolated profile (or with
  `--env`) changes the Claude Code binding: `managed`, `disabled` (plain
  `unassign`) or `native` (`--native-login`). On an ordinary profile
  `--runtime claude-code` is the same as no `--runtime` and edits
  `provider_key`. Managed keys need an explicit `--runtime`.
- The store keeps Claude Code bindings in `claudeBindings`, beside Codex's
  `bindings`. Only entries with `aws` can be bound; OpenAI entries are refused.
  `keys remove` refuses while either runtime references the entry. An older CLI
  fails closed on a store that has `claudeBindings`.
- The service descriptor nests Claude Code's binding under `claude`. A project
  bound only for Claude Code reports Codex as `native`; both deliver nothing to
  Codex. Changing either binding marks the worker pending reload.
- Launch delivers `claudeAuth`: `{ mode: "mantle" | "bedrock", secret, region }`
  or `{ mode: "disabled" }`. Native login sends nothing. The launcher
  advertises `credentials-claude-v1` and checks the fields and the Region
  before spawn. Binding, service startup and direct connect refuse a launcher
  without it. Claude Code does not need the Codex app-server transport.
- The worker never puts the key in its own process env or saved profile. The
  Claude runner gives the provider env of the ordinary path
  (`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_MANTLE`,
  `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`) to the Claude Code child, in its env
  and through the private `--settings` file, so the private home's settings
  cannot switch it back to native login. Detection reports the entry's provider, so the model
  catalog and provider label match ordinary profiles. The token is redacted
  from uploads like a `provider_key` token.
- A disabled binding fails every Claude Code run with "Claude Code is disabled
  for this project". A failed AWS run never falls back to native login.
- `keys status` appends the Claude Code binding to the project line
  (`; Claude Code managed, desired 1, applied 1`).
- Network: Claude Code calls the same Region endpoint as Codex
  (`bedrock-mantle.<region>.api.aws` or `bedrock-runtime.<region>.amazonaws.com`),
  which `keys add --env` already allows.

## Managed Anthropic keys for isolated Claude Code (OS-2016)

An Anthropic API key in the managed store lets Claude Code on an isolated
profile bill API usage instead of each project's own Claude sign-in.

```bash
convoy keys add work-anthropic --provider anthropic --auth api-key
convoy keys use work-anthropic --profile a --runtime claude-code
```

- `--auth api-key` makes the entry managed. Plain `--provider anthropic` is
  unchanged: the credential-free legacy entry that pins this machine's Claude
  sign-in. The managed entry takes no `--region` and no token argument; the key
  comes from the masked prompt, `--from-env` or `--stdin`.
- The entry stores `provider: "anthropic"` beside its revisions. An entry has
  either `provider` or `aws`, never both. An older CLI fails closed on a store
  with this field (the schema is strict).
- Only Claude Code can be bound to it. `keys use --runtime codex` refuses it,
  and launch refuses a hand-edited Codex binding to it, so an Anthropic key never
  reaches OpenAI. Rotate, rollback, disable, remove and `unassign` (including
  `--native-login`) work as for the other managed entries.
- Launch delivers `claudeAuth: { mode: "anthropic", secret }`. The launcher
  advertises `credentials-anthropic-v1` and accepts exactly those fields. Adding
  the entry, binding it and launching with it refuse a launcher without the
  capability. A VM must rerun `install.py` after installing CLI 0.115.0.
- The Claude runner gives the child this env, in its env and in the private
  `--settings` file:
  `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_MANTLE`, `CLAUDE_CODE_USE_VERTEX`
  and `CLAUDE_CODE_USE_FOUNDRY` set to `0`, `ANTHROPIC_AUTH_TOKEN` and
  `ANTHROPIC_CUSTOM_HEADERS` set to empty, `ANTHROPIC_API_KEY`, and
  `ANTHROPIC_BASE_URL=https://api.anthropic.com`.
  Claude Code picks credentials in the order cloud
  provider, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`,
  `CLAUDE_CODE_OAUTH_TOKEN`, profiles, `/login`. Turning off the two sources
  above the key makes it win over the project's own settings, an inherited
  bearer token and the project's native login. Without the empty
  `ANTHROPIC_AUTH_TOKEN`, Claude Code 2.1.300 sends an inherited bearer token
  next to the key. Custom headers are cleared because an `x-api-key` or
  `Authorization` header from the repo's `.claude/settings.json` or the
  inherited env replaces the key (verified with 2.1.300). With the endpoint
  pinned, managed runs have no gateway to send other custom headers to.
- The endpoint is pinned. Without the pin, an `ANTHROPIC_BASE_URL` in the
  repo's `.claude/settings.json` or the inherited env sends the shared key and
  every prompt to that host (verified with Claude Code 2.1.300). Claude Code
  treats an unset base URL and one whose host is `api.anthropic.com` alike as
  Anthropic's own API, so the pin changes nothing else. A project that needs a
  gateway keeps its own login or key instead of a managed one.
- Before the prompt goes out, the runner asks Claude Code which credential it
  will use (`accountInfo()`, a control request with no model call). Unless it
  reports `apiProvider: "firstParty"` and `apiKeySource: "ANTHROPIC_API_KEY"`,
  the run fails with "Claude Code would not use the assigned Anthropic key"
  and the prompt is never sent. This catches the sources that outrank
  `--settings`: a signed-in Claude apps gateway session and administrator
  policy settings. The project's private login is left alone. The prompt waits
  on the answer for at most the startup timeout.
- Isolation keeps A's key from project B. It does not keep A's key from A's own
  agent: Claude Code exports its env to every tool subprocess, so Bash can print
  `ANTHROPIC_API_KEY`, as with the AWS token (OS-2108).
- Detection reports `anthropic`, so the model catalog and the **Claude.ai**
  label match a native-login profile. `keys status` shows
  `work-anthropic: Anthropic API usage, ...`. The key is redacted from uploads
  like the AWS keys. A rejected key fails the run; it never falls back to the
  project's native login.
- Network: Claude Code calls `api.anthropic.com`, which the project-isolation
  firewall already allows.
- Native Claude subscription sign-in stays private to each project. Convoy does
  not store or share subscription tokens; see the OS-2006 investigation.

## Managed Cursor account keys for isolated Cursor (OS-2017)

A Cursor API key in the managed store lets Cursor Agent on an isolated profile
run on that Cursor account instead of each project's own browser login. Cursor
issues the key, and usage bills to the Cursor account that owns it. It is not an
OpenAI or Anthropic key and never reaches Codex or Claude Code.

```bash
convoy keys add work-cursor --provider cursor --auth api-key
convoy keys use work-cursor --profile a --runtime cursor
convoy keys unassign --profile a --runtime cursor               # Cursor disabled
convoy keys unassign --profile a --runtime cursor --native-login
```

- `--provider cursor` always means a managed entry and needs `--auth api-key`.
  It takes no `--region` and no token argument; the key comes from the masked
  prompt, `--from-env` or `--stdin`. There is no legacy `config.toml` form, so
  `--runtime cursor` on an ordinary profile is refused like any managed bind.
- The entry stores `provider: "cursor"`. Bindings live in `cursorBindings`,
  beside `bindings` (Codex) and `claudeBindings`. An unbound Cursor uses the
  project's native login. A store with this field fails closed on older CLIs.
- Only Cursor can be bound to it. Codex and Claude Code refuse a Cursor entry,
  Cursor refuses every other entry, and launch refuses hand-edited bindings that
  cross runtimes. Rotate, rollback, disable, remove and the TUI work as for the
  other managed entries; removal also checks Cursor bindings.
- Launch delivers `cursorAuth: { mode: "managed", secret }` or
  `{ mode: "disabled" }`. The launcher advertises `credentials-cursor-v1`.
  Adding the entry, binding it, service startup and direct connect refuse a
  launcher without it. A disabled binding fails every Cursor run with "Cursor
  is disabled for this project".
- The runner gives the key to the `cursor-agent` child env only, never argv or
  the worker env. For that child it removes every inherited `CURSOR_*` and
  `AGENT_CLI_*` variable, then sets `CURSOR_API_KEY` and
  `AGENT_CLI_CREDENTIAL_STORE=memory`. Checked in the 2026.08.11-e8db854 and
  2026.10.22-27dcf5f bundles:
  - Cursor picks `CURSOR_AUTH_TOKEN` over the key, and the key over the stored
    login. Removing the token makes the key win.
  - `CURSOR_API_ENDPOINT`, `CURSOR_API_BASE_URL`, `CURSOR_API_URL` and the
    `AGENT_CLI_*` local and authless modes change where requests go or whether
    the key is used. Removing them pins requests to Cursor's default
    `api2.cursor.sh`.
  - With the default file store, Cursor exchanges the key and writes the access
    token, refresh token and the key itself into
    `$XDG_CONFIG_HOME/cursor/auth.json`. That would overwrite the project's
    native login and leave a token that keeps working after unassignment. The
    memory store keeps all of it in the child process.
- `AGENT_CLI_CREDENTIAL_STORE` is not in Cursor's public docs, so a managed run
  first checks `cursor-agent --version` (once per worker). Builds older than
  2026.08.11, or with an unreadable version, fail with "Cursor Agent <version>
  is not tested with managed keys", with a link to the install command, before
  spawn. Newer builds are accepted;
  recheck the bundle before moving the template pin.
- A key Cursor refuses ("The provided API key is invalid") fails the run with
  "Cursor rejected the assigned account key". It never falls back to the
  native login. The key is redacted from uploads like the other managed keys.
- Isolation keeps A's key from project B. A's own agent can read it: Cursor
  exports its env to tool subprocesses.
- `keys status` shows `work-cursor: Cursor account key, billed to its Cursor
  account, ...` and a `; Cursor <mode>, desired N, applied N` part per
  project. Cursor auth results are not recorded; delivery is what status shows.
- Network: Cursor calls `api2.cursor.sh` and related Cursor hosts, which the
  project-isolation firewall already allows.
- Native Cursor login stays private to each project:
  `project login <profile> --runtime cursor` (see
  [cli-project-isolation.md](cli-project-isolation.md#runtime-detection-and-login-cli-01100-os-2166-os-2160)).
  Convoy never copies one project's browser login to another.

## Managed Gemini keys for Antigravity (OS-2476)

A Gemini API key in the managed store lets Antigravity (agy) run on that key
instead of the project's Google sign-in, in isolated and shared projects. Usage
bills to the Gemini API project that owns the key. The key reaches Antigravity
only.

```bash
convoy keys add work-gemini --provider gemini --auth api-key
convoy keys use work-gemini --profile a --runtime antigravity
convoy keys unassign --profile a --runtime antigravity               # Antigravity disabled
convoy keys unassign --profile a --runtime antigravity --native-login
```

- `--provider gemini` always means a managed entry and needs `--auth api-key`.
  It takes no `--region`. The key comes from the masked prompt, `--from-env` or
  `--stdin`. There is no legacy `config.toml` form.
- The entry stores `provider: "gemini"`. Bindings live in `antigravityBindings`.
  An unbound Antigravity uses the project's native sign-in. A store with this
  field fails closed on older CLIs.
- Only Antigravity takes a Gemini entry, and Antigravity takes no other entry.
  Launch refuses hand-edited bindings that cross runtimes. Rotate, rollback,
  disable, remove and the TUI work as for the other entries.
- Launch delivers `antigravityAuth: { mode: "managed", secret }` or
  `{ mode: "disabled" }`. The launcher advertises `credentials-antigravity-v1`.
  Adding the entry, binding it, service startup and direct connect refuse a
  launcher without it. A disabled binding fails every Antigravity run before agy
  starts, with "Antigravity is disabled for this project".
- The runner puts the key in the `agy acp` child env only, as `GEMINI_API_KEY`.
  For that child it first removes `GEMINI_API_KEY`, `GOOGLE_API_KEY`,
  `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`,
  `GOOGLE_CLOUD_LOCATION`, `GOOGLE_CLOUD_QUOTA_PROJECT`,
  `GOOGLE_GENAI_USE_VERTEXAI`, `GCLOUD_PROJECT` and `CLOUDSDK_CORE_PROJECT`, so
  ambient Google settings cannot override the key. This is t3code's list.
- After `initialize` the runner calls ACP `authenticate` with `gemini-api-key`,
  then `session/new` or `session/resume`. It never tries the `oauth-personal`
  fallback, so a refused key never opens a browser. A failed `authenticate`, or
  `-32000 Authentication required` after it, fails the run with "Antigravity
  refused the assigned Gemini API key".
- Detection runs the model inventory with the key, so the model selector lists
  what the key offers. A disabled binding skips the inventory.
- Detection reports `provider: "gemini"` on a managed binding. Convex keeps it
  on the stored runtime, and the web profile card shows
  `<version> · Gemini API key`. The card shows no Antigravity model count.
- A backend without this field rejects the registration, so Convex deploys
  before a CLI that sends it is published.
- The key joins the upload redaction list. Isolation keeps A's key from project
  B. A's own agent can read it, since agy passes its env to tool commands.
- `keys status` shows `work-gemini: Gemini API usage, ...` and a
  `; Antigravity <mode>, desired N, applied N` part per project. A project with
  a managed key is not reported as logged out.
- Network: the key calls `generativelanguage.googleapis.com`. The strict
  devcontainer firewall does not allow it yet; OS-2477 adds agy's hosts.

What the live check found (agy 1.5.14, 2026-11-21, a scratch HOME with no
Google sign-in, a syntactically valid but unissued key):

- `authenticate` with `gemini-api-key` answers `{}` without checking the key.
  Without that call `session/new` fails with `-32000`, even with
  `GEMINI_API_KEY` set. Print mode ignored the variable in an earlier probe.
- `session/new` then succeeds and lists models. The prompt reaches the Gemini
  API, which refuses the key with `API_KEY_INVALID`. agy reports that as an
  `agent_message_chunk` ("⚠ agent executor error: ... API key not valid") with
  `stopReason: "end_turn"`, not an RPC error. A key Google refuses therefore
  shows agy's message as the reply, as the known limitation in
  [cli-antigravity-runtime.md](cli-antigravity-runtime.md#known-limitations)
  says for other upstream errors.
- agy writes the key nowhere under HOME, its logs and crash files included.
  No `settings.json` is needed. agy records the chosen method,
  `{"methodId":"gemini-api-key"}`, in
  `~/.gemini/antigravity-cli/cache/acp-auth-state.json`.
- That record outlives the binding. With the key removed, `session/new` fails
  with `-32000` even when the Google sign-in token is still there. The runner's
  `oauth-personal` fallback signs back in with the token and rewrites the record
  to `oauth-personal`, so restoring native login needs no manual step. The
  native inventory runs at worker start, before any run, so when the record
  still says `gemini-api-key` it calls `authenticate` with `oauth-personal`
  before `session/new`. Without that record it never calls `authenticate`, so an
  unattended inventory never starts a Google sign-in. Verified on 1.5.14: the
  native catalog came back with the sign-in's 9 models.
- Models: with the unissued key, the session offered 8 models (Gemini 4 Neon,
  Carbon, Hydrogen and Argon, Gemini 3.8, 3.7 and 3.6 Flash, Gemini 3.1 Pro),
  and no Claude, GPT-OSS or orchestrator models. The same agy signed in to
  Google AI Pro offers 9: Gemini 4 Neon, Argon and Hydrogen, Gemini 3.8 Flash,
  the two Gemini Pro orchestrators, Claude Opus 5.5, Claude Sonnet 5.5 and
  GPT-OSS 120B. Which of the 8 a real key can call is unverified until a real
  key is tried. A thread that stored a sign-in-only model fails with agy's
  `Unknown model ID` message, as for any refused model, and runs again on
  Default. Four Gemini models overlap, so this is left as is.

Pending, and required before publishing: a completed prompt with an issued
Gemini key in a HOME without Google sign-in, the models that key can call, the
key redacted from a thread that prints its env, and the isolated flow on the
acceptance VM.

## Managed provider keys for isolated OpenCode (OS-2018)

OpenCode on an isolated profile can run on managed OpenAI and Anthropic API
keys instead of the project's own `opencode auth login`. A project holds one key
per provider slot, so one project can use both providers at once.

```bash
convoy keys use work-openai --profile a --runtime opencode     # OpenAI slot
convoy keys use work-anthropic --profile a --runtime opencode  # Anthropic slot
convoy keys unassign --profile a --runtime opencode               # OpenCode disabled
convoy keys unassign --profile a --runtime opencode --native-login
```

- OpenCode reuses existing entries: an OpenAI entry (no `provider`, no `aws`)
  fills the `openai` slot, an Anthropic entry (`provider: "anthropic"`) the
  `anthropic` slot, a Bedrock entry the `amazon-bedrock` slot
  ([OS-2205](#managed-bedrock-keys-for-opencode-os-2205)). Mantle and Cursor
  entries are refused with "OpenCode needs a managed OpenAI, Anthropic or Bedrock
  key." `use` replaces the key in that entry's slot and keeps the other slots.
- The store keeps `opencodeBindings: { [identity]: { openai?: name, anthropic?: name } }`
  beside the other runtimes' bindings. No record means native login. `{}` means
  disabled. Native login is all or nothing: with any managed slot, OpenCode
  ignores the project's own `opencode auth`. There is no single-slot unassign;
  unassign, then `use` the key to keep. A store with this field fails closed on
  older CLIs. Removal checks the slots too, in the store and on a live worker.
- The descriptor carries `opencode: { openai?: {...}, anthropic?: {...} }`, one
  runtime descriptor per slot. A disabled entry turns its slot `disabled` and
  delivers nothing for it. Launch sends
  `opencodeAuth: { mode: "managed", keys: { openai?, anthropic? } }`, or
  `{ mode: "disabled" }` when no slot delivers a key. The launcher advertises
  `credentials-opencode-v1`. Binding, service startup and direct connect refuse
  a launcher without it.
- Only the `opencode serve` child gets the keys, in its env. For a managed or
  disabled project the runner drops every inherited `OPENCODE_*`, `OPENAI_*` and
  `ANTHROPIC_*` variable, then
  sets `OPENCODE_AUTH_CONTENT={}` and an inline `OPENCODE_CONFIG_CONTENT` with
  `enabled_providers` set to the assigned slots and
  `provider.<slot>.options.{apiKey, baseURL}`, with the base URL pinned to
  `https://api.openai.com/v1` or `https://api.anthropic.com/v1`. Checked with
  OpenCode 1.18.18 and 1.19.5 against a fake upstream:
  - A cached `oauth` entry in the project's auth.json wins over any API key,
    including one in inline config. It sent the ChatGPT access token to the
    project config's `baseURL`. `OPENCODE_AUTH_CONTENT` replaces the auth.json
    read, so `{}` leaves no cached login or OAuth plugin to apply.
  - A project `opencode.json` `options.apiKey` or `baseURL` beats auth.json but
    loses to inline config, so the key and endpoint come from Convoy.
  - `enabled_providers` hides every other provider, including OpenCode's free
    `opencode` provider, so nothing falls back to an unassigned account.
  - `/etc/opencode/opencode.json` and `opencode.jsonc` (Linux managed config)
    outrank inline config.
  - Request headers outrank the inline `apiKey`. A project's
    `provider.<slot>.options.headers` or `provider.<slot>.models.<id>.headers`
    `Authorization` was sent instead of the managed key (1.19.5). Agent
    `options.headers`, variant headers and a model's `options.apiKey` or
    `baseURL` did not change the key or endpoint.
- `OPENCODE_AUTH_CONTENT` is not in OpenCode's public docs, so every managed
  server start checks the binary first. Detection and runs share that start, so
  no untested binary gets the keys. OpenCode older than 1.18.18, an unreadable
  version, or an `/etc/opencode` config refuses the start, with "OpenCode
  <version> is not tested with managed keys" and the install command, or "<file>
  overrides Convoy's OpenCode keys". Detection then advertises OpenCode without
  models, and each run fails with that message. Recheck both mechanisms before
  moving the image pin (`TESTED_OPENCODE_PACKAGE` in `server.ts`).
- Before prompting, a managed run reads the effective config for its directory
  (`GET /config`, global, project and inline merged). Any header on an assigned
  provider or its models fails the run with "OpenCode config sets headers for
  <slot>, which override Convoy's key". Any header counts, not only auth ones:
  an `OpenAI-Organization` header changes billing too. Headers on unassigned
  providers are ignored, since `enabled_providers` disables those providers.
- A run whose model's provider has no usable key fails with "No usable
  <provider> key in this project. Check convoy keys status." A disabled slot
  delivers nothing, so it reads the same. A disabled project fails every OpenCode run with
  "OpenCode is disabled for this project". A key the provider refuses fails the
  run with the provider's error; there is no fallback.
- The server lives inside the worker. A rotation, rollback or reassignment
  applies on `service reload --profile <key> --interrupt`, which restarts the
  worker, so the server restarts with the new keys and a new server password.
  Siblings keep running. Detection's model inventory runs on a server with the
  same keys, so the composer lists only the assigned providers' models. A
  disabled project skips the inventory and advertises no models.
- Isolation keeps A's keys from project B: B cannot read A's process env, and
  A's server answers only with A's password
  ([cli-opencode-runtime.md](cli-opencode-runtime.md#execution-appscli)). A's own
  agent can read the keys: OpenCode's tool subprocesses inherit its env, and
  `GET /config` and `GET /provider` return them to an authenticated client.
- `keys status` shows `; OpenCode OpenAI managed, desired N, applied N` per bound
  slot, or `; OpenCode disabled`. Keys are redacted from uploads like the other
  managed keys. Auth results are not recorded.
- The TUI credentials panel has no OpenCode rows; use `convoy keys`.
- Network: OpenCode calls `api.openai.com`, `api.anthropic.com` and `models.dev`,
  which the project-isolation firewall already allows.
- Native OpenCode login stays private to each project:
  `project login <profile> --runtime opencode` runs `opencode auth login`.

## Managed Bedrock keys for OpenCode (OS-2205)

A Bedrock Runtime entry (`aws.provider: "bedrock"`) fills a third OpenCode
slot, `amazon-bedrock`, beside `openai` and `anthropic`.

```bash
convoy keys add work-bedrock --provider bedrock --auth api-key --region us-east-1
convoy keys use work-bedrock --profile a --runtime opencode
convoy service reload --profile a --interrupt
```

- Store and descriptor gain the optional `amazon-bedrock` slot. The payload key
  is `{ secret, region }`, not a string:
  `opencodeAuth.keys["amazon-bedrock"] = { secret, region }`.
- The launcher advertises `credentials-opencode-v2` beside v1 and accepts the
  Bedrock value only as exactly `{secret, region}`, with a bounded single-line
  secret and a valid Region. Binding a Bedrock key and launching with one need
  v2. OpenAI and Anthropic payloads still need only v1. Shared registrations
  skip launcher checks, as for the other slots.
- Mantle entries are refused. OpenCode's `amazon-bedrock` provider calls Bedrock
  Runtime; a Mantle key does not work there.
- Delivery goes in inline config, not the AWS env:
  `provider.amazon-bedrock.options.{apiKey, region, endpoint, baseURL}`, with
  both URLs set to `https://bedrock-runtime.<region>.amazonaws.com`. Checked
  with OpenCode 1.18.18 and 1.19.5:
  - A project `opencode.json` `options.apiKey` or `region` beats
    `AWS_BEARER_TOKEN_BEDROCK` and `AWS_REGION`. Inline config beats the project,
    so the key and Region go inline.
  - `baseURL` outranks `endpoint`, so both carry the pin.
  - With a project config that sets a bogus `apiKey`, `region`, `endpoint`,
    `baseURL` and `profile`, the effective config keeps Convoy's values (the
    project `profile` passes through), and a real request succeeds. The bearer
    key wins over a profile.
  - `OPENCODE_AUTH_CONTENT={}` hides a cached `amazon-bedrock` key in
    auth.json.
  - Provider or model `headers` on `amazon-bedrock` can add an `Authorization`
    header. The existing header guard refuses those runs, as for the other
    slots.
- The server env drops inherited `AWS_*` only when a Bedrock key is delivered.
  A project with only OpenAI or Anthropic keys keeps its AWS env for tool
  commands.
- OpenCode routes some Bedrock models through the Mantle SDK
  (`api.npm === "@ai-sdk/amazon-bedrock/mantle"`). The pinned Runtime endpoint
  cannot serve them, so with a managed Bedrock key the inventory drops them
  before the fair per-provider cap (19 of 169 at the time of writing). Native
  inventories keep them. A thread that already selected one gets the
  provider's error.
- The upload redaction list takes the Bedrock entry's `secret`.
- `keys status` shows `; OpenCode Bedrock managed, desired N, applied N`.
- Network: OpenCode calls `bedrock-runtime.<region>.amazonaws.com`. `keys add`
  for a target already allows that host, as for Codex.
- No new command. `keys rotate`, `rollback`, `disable`, `unassign` and `remove`
  work as for the other slots.

## Review corrections, 0.71.1

An absent store and marker do not impose Linux ownership checks on ordinary
Claude commands. Existing managed files still require strict validation.
Credential mutations take the config lock for identity/name validation but never
rewrite unchanged TOML. Failed first writes remove only a marker created by that
attempt, and only before store replacement. Existing markers are never removed.
A process crash during initialization can still require administrator recovery;
do not infer that a missing opted-in store is safe to discard.

Rollback selects a retained revision without enabling a disabled entry. Native
bindings remain visible in status but deliver no managed payload, preserving exec
mode and ordinary native runner fallback. Disabled bindings still forbid fallback.

Managed Codex checks the effective OpenAI endpoint before login: absent/null means
the built-in default; an explicit value must be https://api.openai.com/v1.
Managed text deltas stream like any other Codex run, with the whole key redacted
in each delta, complete item and debug log line (OS-2105 reversed the earlier
drop). A key split across deltas is held back until it can be redacted whole;
see Security.

When a changed live worker exits, normal reconciliation launches the desired
configuration; it does not regrant a historical key automatically. Launch-time
descriptor validation remains. A missing worker observation reports unknown
applied state rather than asserting a pending revision.
