# Specs-first workflow

Specs under `docs/specs/` are authoritative. Code that contradicts a spec is a
bug in the code, not in the spec.

## Before implementing

1. Search `docs/specs/` for related specifications and read them.
2. If a related spec exists, the implementation must follow it.
3. If no related spec exists, create one under `docs/specs/` before or alongside
   the implementation.

## When behavior changes

Update the relevant spec(s) **in the same task/PR** whenever behavior, defaults,
edge cases, or user-visible interactions change. This applies to every domain —
CLI, permissions, keyboard UX, everything.

If multiple specs overlap, keep one clear source of truth and cross-link the
others rather than duplicating rules.

## Other docs to keep in sync

- **Root `README.md`** — update for user-facing features. (Note: the tracked
  file is `README.md` at the repo root. An untracked lowercase `readme.md` may
  exist locally; ignore it.)
- **`docs/guidelines/frontend-development.md`** — when the user gives design
  guidance that establishes a reusable UI convention, add it there in the same
  change so future agents inherit the rule.
- **Keyboard shortcuts** — new shortcuts go in the shortcuts dialog
  (`components/blocks/sidebar/keyboard-shortcuts-dialog.tsx`, the
  `SHORTCUT_GROUPS` array) and in `docs/specs/keyboard-navigation.md`.
- **MCP tool changes** — see [mcp-servers.md](mcp-servers.md) for the full list
  of surfaces to update.
- **`apps/cli/package.json` version** — bump it (minor for features, patch for
  fixes) in every change touching `apps/cli`. The connect banner prints it, and
  it is how running agents are matched to code.

## Definition of done

```bash
pnpm web:lint
cd apps/web && npx tsc --noEmit
pnpm web:test:once     # required if you touched apps/web/convex/
```

Convex backend changes require new or updated unit tests — see
[testing.md](../guidelines/testing.md).

## TDD for bug fixes

Mandatory (hard rule 8) for every bug, regression, and code-review finding — no
exceptions for "obvious" one-line fixes.

1. Write a test that reproduces the bug.
2. Run it and **read the failure output**. It must fail because the behavior is
   wrong — the assertion you care about, with the values you predicted. A test
   that fails on a typo, a missing fixture, a schema error, or an unrelated
   assertion is not red, it is broken; fix the test and re-run.
3. Implement the fix.
4. Run it again and confirm it passes.

Do not skip step 2 — it is the only step that proves the test can detect the bug
at all. A test written after the fix passes whether or not it tests anything.

**One test per distinct cause.** Findings that share a symptom usually do not
share a root cause: if two code paths can each produce the bug, each needs its
own red test. Fixing a symptom until the suite goes green is not the goal.

### If the fix is already written

Sometimes a fix lands before its test (you were mid-change, or a review named
both problem and fix). The guarantee is recoverable, so recover it rather than
declaring the test done: write the test, **revert the specific guard or line**
that fixes it, confirm red for the right reason, then restore. Say plainly in
your report that the test came second and how you verified it.
