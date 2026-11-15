# Handoff: Codex isolation lets agents write /tmp (OS-1242 follow-up)

Status: **resolved — two distinct causes, both closed.** Verified 2026-07-16
against codex-cli 0.144.4 on macOS, both transports. Confirmed mechanisms
recorded in `docs/specs/cli-sandboxing.md`; arg set locked by tests in
`codex/runner.test.ts`.

## Cause 1: stale connection (the original report)

The CLI reads config at startup; the original live test flipped the desktop
toggle without reconnecting. The desktop's `persistAndRestart` (added since)
removes this failure mode. The shipped shell-path args were verified correct:
with `--sandbox workspace-write` + `-c sandbox_workspace_write.writable_roots`
+ `-c exclude_slash_tmp=true`, shell writes to `/tmp` fail with
`Operation not permitted` while cwd/writable-root writes succeed — on both
`codex exec` and a scripted `codex app-server` JSON-RPC session with the
exact args our runners emit.

## Cause 2: apply_patch + `approvals_reviewer = "auto_review"` (the re-test escape)

The second live escape (desktop re-test, fresh connection) came through an
**Apply changes** (`apply_patch`) item, not shell. apply_patch writes from
the codex process outside the seatbelt; its only gate is the patch-safety
approval, which rejects out-of-root patches under approval policy `never`.
The user's `~/.codex/config.toml` set `approvals_reviewer = "auto_review"`,
which swaps that rejection for an AI reviewer that auto-approves — apply_patch
then wrote `/tmp` and even `$HOME`, including under `--sandbox read-only`.

Fix: isolation pins `-c approvals_reviewer="user"` (in
`codexWritableRootsConfigArgs`, so both transports inherit it). Verified:
out-of-root patches now rejected ("writing outside of the project; rejected
by user approval settings"), cwd patches still apply, shell behavior
unchanged.

## Other findings kept for posterity

- `writable_roots` merges into the defaults on the legacy path (cwd stays
  writable); the `/tmp` allowance is separate, which is why
  `exclude_slash_tmp` is still required.
- Codex 0.144.4 has a newer `[permissions]` profile system; explicitly
  selecting a profile (`-P :workspace` / `default_permissions`) intentionally
  ignores all `sandbox_workspace_write.*` settings. Our `--sandbox` flag /
  RPC `sandbox` param force the legacy path where the overrides apply. This
  also made the handoff's suggested `codex sandbox -P :workspace` repro a
  false negative. Never migrate the isolation args to profile syntax without
  re-verifying.
- Known ceiling: enterprise-managed codex config that force-selects a
  permissions profile (`requirements_force_profile_selection`) would bypass
  the legacy path and re-open `/tmp`; revisit if managed configs show up.

## Remaining (user action)

Live desktop re-test with the updated CLI (>= 0.28.0): Codex thread,
isolation ON — `/tmp` write blocked via **both** shell and apply_patch, cwd
write allowed, on both the exec and app-server transports.
