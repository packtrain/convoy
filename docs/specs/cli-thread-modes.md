# CLI Thread Modes Specification

This document specifies chat mode behavior for CLI thread. It is the source of truth for mode defaults, mode persistence, keyboard toggles, and discoverability requirements.

For unsent draft persistence rules (text + selectors + thread keying), see `docs/specs/cli-thread-drafts.md`.

## Related Specs

- Read/unread behavior: `docs/specs/cli-thread-read-state.md`
- Message continuation context: `docs/specs/cli-message-context.md`

## Overview

- Supported mode values: `agent`, `plan`, `default`, `acceptEdits`, `auto`, `dontAsk`; each runtime offers a subset (see matrix below)
- Mode state is per chat and is applied to user messages
- New thread default mode is `agent` when available
- For Claude Code execution in `apps/cli`, mode maps to Agent SDK permission modes (`agent` -> `bypassPermissions`, others 1:1); see `docs/specs/cli-sdk-integration.md`
- For Codex execution in `apps/cli`, mode maps to sandbox flags on the exec transport (`agent` -> `--dangerously-bypass-approvals-and-sandbox`, others -> `--sandbox workspace-write`) and to approval policy + sandbox + collaboration mode on the opt-in app-server transport (`default` asks to approve, `plan` is read-only plan mode); see `docs/specs/cli-codex-runtime.md`
- For OpenCode execution in `apps/cli`, mode maps to session permission rulesets (`agent` -> allow-all, `default`/`plan` -> ask ruleset with interactive approvals) and `plan` additionally prompts OpenCode's built-in `plan` agent; see `docs/specs/cli-opencode-runtime.md`

---

## CLI Type Mode Matrix

| `cliType` | Supported modes |
|---|---|
| `claude-code` | `agent`, `default`, `acceptEdits`, `auto`, `plan` |
| `codex` | `agent`, `default` (labeled "Ask to approve"), `auto` (labeled "Sandboxed"), `plan` (approval/plan behavior requires the app-server transport, the connection default; degrades to sandboxed never-asks under `--codex-exec`) |
| `opencode` | `agent`, `default` (labeled "Ask to approve"), `plan` (read-only plan agent; no approve-plan gate) |
| `antigravity` | `agent` (labeled "Act"), `default` (labeled "Ask to approve"). See [Antigravity runtime](cli-antigravity-runtime.md#modes) |
| `droid` | _none_ |
| `amp` | _none_ |
| `other` | _none_ |

For CLI types with no configured modes:
- Mode selector is hidden.
- Plan-mode toggle shortcut is a no-op.

---

## Selection and Persistence Rules

In chat detail pages, input mode is resolved in this order:
1. Unsent draft mode for this chat (if valid for the chat `cliType`)
2. The thread's stored last-used mode (`cliThreads.metadata.cli.lastUsedMode`)
3. Default mode for the chat `cliType` (prefer `agent`)

For the `/threads` new-thread composer, mode uses the draft value when valid for selected `cliType`, otherwise `getDefaultMode(cliType)`.

The stored last-used mode is denormalized onto the thread at user-message-write time (OS-1454), so the mode pill is correct on the first frame and does not depend on which messages the client has loaded. Only **user messages** write it; assistant messages must not change input mode preselection.

The stored mode is sticky: a user message that omits `cliMode` (a non-web caller) leaves the thread's remembered mode as it was, unlike model and effort, which move together whenever a message names a model.

Because it is sticky, a **blank** `cliMode` is dropped rather than stored. `cliMode` is the one selection field persisted on the message unnormalized — there is no mode catalog on the server, so modes are validated at read time by `resolveChatDetailMode` — and `api.cli.messages.send` is public, so a whitespace-only value would otherwise pin the composer to the runtime default for the rest of the thread's life. A non-blank mode the runtime does not recognize is still stored and still falls through to the default at read time.

Approving a plan is the one action that writes the mode on the user's behalf: it sets the draft mode to the approved mode (`acceptEdits` or `default`), so the selector and the next outgoing message leave `plan` together. See `docs/specs/cli-interactive-approvals.md` ("Plan decisions").

In existing-thread detail pages:
- profile/path remain locked by `lockAgentContext`
- non-current CLI types remain unavailable
- the mode selector stays editable for the next outgoing user message

---

## Default Mode Rules

`getDefaultMode(cliType)` behavior:
1. Return `agent` if that mode exists for the CLI type.
2. Otherwise return the first declared mode for that CLI type.
3. Otherwise return `undefined`.

---

## Toggle Shortcut Rules

Shortcut behavior:
- all platforms: `Shift+Tab`

Scope:
- Chat input textarea only.
- Does not override task-table outdent behavior outside the composer scope.

Toggle behavior:
1. If current mode is `plan` and `agent` exists, switch to `agent`.
2. Otherwise switch to `plan`.
3. If `plan` is unsupported for the active `cliType`, no-op.

---

## Discoverability Requirement

Mode dropdown must show the plan-mode toggle hint on the **Plan** option:
- `Shift+Tab`
- When the selected mode is `plan`, the mode trigger icon and trigger label are accented with `blue-500`.
- Dropdown option rows keep default styling (no `blue-500` accent).

The new-thread empty state must describe the currently selected runtime mode:
- Use the canonical label, icon, and description from the runtime UI registry.
- Update the notice immediately when the runtime or mode changes.
- Present `agent` / Act as a cautionary full-access notice and other modes with neutral styling.
- Hide the notice for runtimes that do not define modes.

---

## Rules for Adding New CLI Types

When adding a new `cliType`, include these checklist items in the same change:
1. Define supported modes for the new `cliType`.
2. Decide default mode behavior.
3. Verify `Shift+Tab` behavior for that `cliType`.
4. Update this specification (`docs/specs/cli-thread-modes.md`).

---

## QA and Acceptance Checklist

- Codex shows `Act`, `Ask to approve`, `Sandboxed`, and `Plan`.
- OpenCode shows `Act`, `Ask to approve`, and `Plan`.
- New thread opens with `Act` by default.
- Existing threads reuse the last user-selected mode, correct on the first frame with no snap from the default.
- Existing thread detail keeps mode editable even while profile/path and CLI type remain locked.
- `Shift+Tab` toggles mode as specified.
- Plan option shows shortcut hint in the mode dropdown.
- New-thread notice matches the currently selected runtime mode.
