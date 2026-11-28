# CLI agent sandboxing (OS-1242)

For the separate Linux per-project boundary, see
[Local project isolation](cli-project-isolation.md). Its `project_isolation`
registration does not change the legacy `isolated` flag described here.

Status: implemented (opt-in). Tier 1 of the OS-1145/OS-1147 isolation vision.

## What it is

When isolation is enabled, the CLI generates OS-level sandbox configuration
from the resolved profile's `paths[]` and applies it to every agent it
spawns, so agents cannot write outside the granted folders. Enforcement
lives where the spawn happens (`apps/cli`), so terminal users get it
directly and the desktop app inherits it for free — its folder UI writes
`paths[]`, this feature turns those into enforcement.

## Enabling it

Opt-in, two equivalent switches (flag wins over profile, default off):

- `convoy connect --isolated`
- `isolated = true` on the profile in `~/.config/convoy/config.toml`

The connect banner's runtime-config line reports `isolated=on|off`.

## Scope of the boundary

- **Writable roots** = the profile's `paths[]` plus the run's working
  directory (both runtimes treat the cwd as writable workspace natively;
  worktree working directories created outside `paths[]` therefore still
  work).
- Isolation constrains the **spawned agent**, not the Convoy CLI process
  itself. It is defense-in-depth under the existing permission modes, not a
  replacement for them: approval prompts and permission modes behave exactly
  as without isolation, including `agent` (bypass) mode — which is the mode
  isolation is most useful for.
- Network policy is the runtime's own sandbox default; Convoy does not
  add network rules in tier 1.
- **Temp directories**: Claude Code's sandbox blocks `/tmp` writes (verified
  empirically). Codex `workspace-write` allows `/tmp` by default, so the CLI
  adds `sandbox_workspace_write.exclude_slash_tmp=true` on macOS (where the
  per-user `$TMPDIR` remains available); on Linux `/tmp` stays writable
  because it is often the only temp dir and excluding it breaks builds.

## Closing the bash escape hatch

The SDK's Bash tool accepts a `dangerouslyDisableSandbox` parameter that the
**model** can set to run a command unsandboxed, honored by default
(`allowUnsandboxedCommands` defaults true). Verified: in `agent`/bypass mode
the model set it and wrote `/tmp` with no prompt — a hostile prompt could
opt straight out of isolation. The runner sets
`allowUnsandboxedCommands: false` whenever isolated, so the SDK ignores that
parameter and every command stays sandboxed. This is the load-bearing part
of bash containment; the OS sandbox alone is not enough without it.

## Codex apply_patch guard (approvals_reviewer)

Codex's `apply_patch` tool writes from the codex process itself, outside the
seatbelt sandbox — like Claude's file tools. Its only boundary is the
patch-safety approval check: out-of-root patches are rejected when the
approval policy is `never`. But a user-level
`approvals_reviewer = "auto_review"` in `~/.codex/config.toml` replaces that
rejection with an AI reviewer that auto-approves, letting apply_patch write
`/tmp`, `$HOME`, anywhere — even under `--sandbox read-only` (verified on
codex-cli 0.144.4). Isolation therefore pins `-c approvals_reviewer="user"`
on both transports (part of `codexWritableRootsConfigArgs`, so exec and
app-server inherit it). Shell commands were never affected — seatbelt blocks
them regardless of the reviewer.

## Claude Code file-tool guard

The SDK's OS sandbox wraps **bash commands only**. The file tools
(`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) write from the Claude process
itself, and in `agent` (bypassPermissions) mode no permission boundary
constrains them — verified empirically: with the sandbox on, a bash
`echo > /tmp/x` is blocked but the Write tool creates `/tmp/x` fine.

Hooks still run under bypassPermissions, so when isolated the runner
registers a `PreToolUse` hook that resolves the tool's target path
(relative paths resolve against the run's cwd) and blocks it unless it
falls inside a writable root or the cwd
(`createSandboxFileGuard` in `runtimes/claudeCode/runner.ts`). Known
ceiling: it is a resolved-path prefix check, so a symlink inside a root
pointing outside can evade it — bash remains contained by the OS sandbox
either way.

## Per-runtime mapping

| Runtime | Mechanism |
|---|---|
| Claude Code | Agent SDK `sandbox: { enabled: true, allowUnsandboxedCommands: false, filesystem: { allowWrite: paths } }` (Seatbelt on macOS, bubblewrap on Linux) plus `additionalDirectories: paths` so file tools may cross between profile paths. `failIfUnavailable` stays at its SDK default (true): the user opted in, so a machine that cannot sandbox fails the run loudly instead of silently running open. |
| Codex (exec + app-server) | Never `--dangerously-bypass-approvals-and-sandbox` / `danger-full-access`, even in `agent` mode — isolated agent mode maps to `workspace-write` with `approvalPolicy: never`. Profile paths become `-c sandbox_workspace_write.writable_roots=[...]` (process-level config; correct for app-server too because writable roots are profile-scoped, not thread-scoped), plus `-c approvals_reviewer="user"` (see apply_patch guard below). Verified empirically on codex-cli 0.144.4 (macOS, both transports): shell and apply_patch /tmp+$HOME writes blocked, cwd + writable-root writes allowed. The overrides only take effect through the legacy `--sandbox` flag / RPC `sandbox` param path — explicitly selecting a codex permissions profile (`-P :workspace` or `default_permissions` in `~/.codex/config.toml` requirements) makes codex ignore `sandbox_workspace_write.*` entirely, so never migrate these args to the profile syntax without re-verifying. |
| Cursor, OpenCode, Antigravity | No OS sandbox support. Antigravity stays here until someone checks that `agy acp --sandbox` honors the writable roots. Runs **fail fast** with a clear error instead of silently running unsandboxed — a security opt-in must not degrade quietly. |

A thread in one repo of a multi-repo folder runs below a profile path, so the
folder is already a writable root. Its runner also gets the folder as an
additional directory, isolated or not ([multi-repo projects → folder
access](cli-multi-repo-projects.md#folder-access)).

## Non-goals (tier 1)

- Default-on (planned once the opt-in has soaked).
- Network allowlists / egress control (the dev container's `strict` mode
  covers that today).
- Read isolation: Claude Code's sandbox restricts writes; broad reads
  remain possible (`denyRead` exists but needs a deny-list policy, which is
  a trust-model decision deferred with default-on).
- Sandboxing the Convoy CLI process itself (use a container/VM — see
  `apps/docs` isolation options page).

## Key files

- `apps/cli/src/agent/runtimes/contracts.ts` — `RunnerSandboxOptions`
  (provider-neutral `writableRoots`), carried on
  `CliRuntimeRunnerFactoryOptions.sandbox` (connection-level, like the
  profile it derives from).
- `apps/cli/src/agent/app/runner.ts` — builds `sandbox` from
  `isolated` + resolved `paths[]`.
- `apps/cli/src/commands/connect/workflow.ts` — `resolveIsolated`
  (flag → profile → off), mirrors `resolvePartialStreaming`.
- Runtime mappings: `runtimes/claudeCode/runner.ts` (query options),
  `runtimes/codex/runner.ts` (exec args), `runtimes/codex/app-server-runner.ts`
  (spawn config + thread permissions), `runtimes/cursor|opencode|antigravity/runtime.ts`
  (fail-fast guard).

## User docs

`apps/docs/content/docs/cli/isolation-options.mdx` (runtime sandbox layer)
and `apps/docs/content/docs/cli/security.mdx`.

## Browser automation, OS-1992

See [Project browser automation](cli-browser-automation.md) for the authoritative
command, state and sandbox contract. Both templates install the pinned Chromium
binaries and system libraries during image build. The repository devcontainer
uses the same browser version. Per-project launches retain private browser state
under HOME and use pipe transport; no TCP debugging server is exposed. The project
launcher additionally mounts `/etc/fonts` read-only when present. The optional
`--no-browser-sandbox` flag changes only Chromium's inner sandbox.
