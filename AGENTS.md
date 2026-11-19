# AGENTS.md

Note: CLAUDE.md is a symlink to this file.

Convoy is a multi-tenant project management app (Next.js + Convex) with a
remote CLI agent system that gives AI code agents a web interface.

Package manager: **pnpm** (>=10 <11). Monorepo of five apps under `apps/`:
`web` (the product), `cli` (agent bridge), `desktop` (Tauri menubar),
`docs` (public docs site), `landing` (marketing site).

Root folders outside `apps/`, and what each is for:

| Path | What | Movable? |
|---|---|---|
| `docs/` | Internal docs: specs, ADRs, guidelines | yes |
| `playground/` | Prototypes; `playground/*` are pnpm workspace members | yes |
| `plugins/` | Claude Code plugin marketplace | **no** — copied to `dist/marketplace` by `apps/cli` build; the GitHub path is documented for `npx skills add` |
| `reference/` | Vendor repos cloned for reading (gitignored, ~11G) | yes |
| `sandbox/` | Gitignored devcontainer for driving the dev CLI against dev Convex | **no** — its path is in the `devcontainer --config` commands you type |
| `scripts/` | Repo-wide tooling only (worktree setup). App-specific scripts live in `apps/<app>/scripts/` | yes |
| `self-hosted/` | Docker self-hosting setup | **no** — linked from public docs |
| `templates/` | Public devcontainer template | **no** — fetched at runtime from `raw.githubusercontent.com/.../main/templates/devcontainer` by published CLI versions |

## Before you finish any task

```bash
pnpm web:lint
cd apps/web && npx tsc --noEmit
pnpm web:test:once     # required if you touched apps/web/convex/
```

## Hard rules

These apply to every task, no exceptions.

1. **Never commit unless the user asked you to.** When they say "commit", commit
   to the branch already checked out — never switch or create a branch. If the
   current branch looks wrong, ask.
2. **Never create a branch or worktree** until the user explicitly asks.
3. **Never use `git stash`** (push, pop, or apply) for any reason. The user's
   stash list is their private storage. To inspect a clean HEAD use
   `git show HEAD:<file>` instead.
4. **Never "clean up" diff hunks you did not intend to make.** Formatting-only
   changes or unrelated cleanup in the working tree may be deliberate user
   edits. Ask before touching them.
5. **Never start a dev server or app server in the primary checkout** — it is
   normally already running. `pnpm web:dev` is allowed *only* inside a linked
   git worktree. See [Worktrees](docs/agents/worktrees.md).
6. **Always use the `mcp__convoy__*` (prod) tools.** `convoy-dev` points at
   the dev environment — use `mcp__convoy-dev__*` only when the user
   explicitly asks for it, for testing. Never for real work.
7. **Read [Specs-first workflow](docs/agents/specs-first-workflow.md) before
   implementing any feature or behavior change.** Specs in `docs/specs/` are
   authoritative and must be updated in the same change.
8. **Keep comments short — no walls of text.** A docblock is 1–3 lines, inline
   comments one or two. Rationale, rejected alternatives, and cost analysis go in
   the spec; the comment links to it. See
   [Code style](docs/guidelines/code-style.md#comments).
9. **Fix every issue test-first (TDD).** Bug, regression, or review finding — the
   failing test comes before the fix, and you **run it and read the failure** to
   confirm it fails *for the reason you intend*. No exceptions, including
   "obvious" one-line fixes. Full sequence:
   [TDD for bug fixes](docs/agents/specs-first-workflow.md#tdd-for-bug-fixes).
10. **Never invent a new file-role name.** Put code in the file the existing
   vocabulary already names — `permissions.ts`, `validators.ts`, `*Repo.ts`,
   `resolution.ts`, `naming.ts`, `invariants.ts`. Grep for a sibling that holds
   the same *kind* of thing before creating a file. A coined noun
   (`authority.ts`, `utils.ts`, `helpers.ts`) hides that two roles are sharing
   one file. See
   [Convex backend development](docs/guidelines/convex/backend-development.md#how-to-split-files).
11. **A shared shape lives in `validators.ts`, never in a callable module.** The
    moment a second module needs a validator, move all three parts of the shape
    together into the domain's `lib/validators.ts`: the `v.object(...)`, its
    `Infer`-ed type, and its `to*` projection. Only a single-use validator may
    stay inline in the callable that returns it. Validator modules stay pure (no
    `_generated/api` import; `_generated/dataModel` is fine) — a validator
    defined in a callable drags that module's `api` imports into every type
    consumer. Inside `convex/`, types come from validators, never from
    `FunctionReturnType<typeof api...>` (circular there, and lint-banned). See
    [Convex backend development](docs/guidelines/convex/backend-development.md#type-sources).
12. **Always apply the `unslop` skill to prose you write.** Docs, specs, commit
    messages, comments, PR bodies, chat replies. Rules:
    [.agents/skills/unslop/SKILL.md](.agents/skills/unslop/SKILL.md).
13. **Bump `version` in `apps/cli/package.json` in every change that touches
    `apps/cli` code.** Minor for features, patch for fixes. The publish workflow
    skips a version npm already has, so an unbumped change never ships. Set
    `CONVOY_VERSION` in `templates/project-isolation/devcontainer.json` to the
    same version in the same commit; `install.test.ts` fails the publish run
    otherwise. See [Publishing the CLI](docs/agents/publishing-the-cli.md).
14. **Plan in vertical slices, never by layer.** Each slice is one commit that
    carries whatever backend, CLI, and UI it needs to be verified by clicking in
    the running app, and the first slice is already end to end. Later slices
    widen it. A schema → functions → UI split is the wrong cut, however cleanly
    it reviews. A pure refactor has no slice of its own; it is the first commit
    of the slice that needs it.
15. **Design a feature as a deep module.** One isolated folder per layer; the
    UI folder's `index.ts` is the only entry and exports one to three things,
    everything else stays internal.
    Name the thin wiring points outside it (route helper, host switch, one mount
    line) before writing code. Existing entities (Convex tables, CLI op
    processors) stay in their owning module — extend them, don't fork them into
    the feature folder. See
    [Architecture → Deep modules](docs/guidelines/architecture.md#deep-modules).
16. **Never write tests for playground work.** Mockups and prototypes under
    `apps/web/app/playground/` are judged by looking at them, and none of it
    ships. No unit, component, or interaction tests, and rule 9 does not apply
    there. Validate with lint, TypeScript, and a visual check.
17. **Build every app URL with `appRoute`** (`apps/web/lib/navigation/routes.ts`),
    e.g. `href(appRoute.task(orgSlug, ref))`. Never assemble a path by hand or
    from `window.location.pathname`: the current page may be a thread, not the
    page you mean (OS-2325). A route `appRoute` lacks gets added there first.
18. **A skeleton has the shape of what it replaces, in the current mode.**
    Build it from the loaded UI: read that component's markup, or screenshot
    it with real data, and copy its toolbars, headers, rows, and panes at
    their real heights. Compact layout gets compact skeleton rows, cards get
    card rows, and a page's header, tab row, and panes keep their places. A
    single block standing in for a panel or tab is wrong. See
    [Frontend development → Loading states](docs/guidelines/frontend-development.md#loading-states).

## Working on Convoy tasks

When your work is tied to a Convoy task, keep its status current with
`mcp__convoy__update_task`. Nobody else will move it for you.

- Set `Planning` when the user asks you to plan the task, and `Plan Review`
  once the plan is written and waiting for the user.
- Set `In Progress` when you start implementing.
- Set `In Review` when the work is done and a human needs to review it. Leave
  `Done` to the user unless they tell you to close it.
- Before implementing a subtask, read its parent with `get_task`, plus any
  sibling subtasks that are already done (and their commits). A subtask makes
  sense only as part of the parent's plan.
- When the last open subtask of a parent reaches `Done`, re-read the parent. If
  every subtask is `Done` or `Canceled` and nothing in the parent's description
  is left unbuilt, set the parent to `Done`. Otherwise leave it and tell the
  user what's still missing.

Tracker conventions (tags, labels, subtasks): [Issue tracker](docs/agents/issue-tracker.md).

## Estimates

Estimate by change size and complexity by default: small, medium, or large.
Explain the size using affected flows, existing components we can reuse,
new contracts or migrations, testing scope, and concrete unknowns. Inspect the
relevant code before sizing; file count alone is not a measure of difficulty.
Give a time estimate only when the user explicitly asks for one, and calibrate
it against completed work in this repository.

Calibration example: OS-1619 sent-message attachment highlighting, hover
previews, and lightbox clicks reused existing components across regular and
steered messages. Implementation and automated checks took about 16 minutes,
despite an estimate of 1–2 hours. Treat comparable component reuse as a small
change. Visual verification was still pending; do not count it as completed or
turn this example into a fixed time promise for other tasks.

## Reference

Read the file for the area you are touching.

| Topic | File |
|---|---|
| Specs-first workflow, validation, definition of done | [docs/agents/specs-first-workflow.md](docs/agents/specs-first-workflow.md) |
| Commits, conventional commit format, task links | [docs/agents/git-and-commits.md](docs/agents/git-and-commits.md) |
| Git worktrees & preview deployments | [docs/agents/worktrees.md](docs/agents/worktrees.md) |
| Publishing the CLI to npm | [docs/agents/publishing-the-cli.md](docs/agents/publishing-the-cli.md) |
| Verifying UI visually (agent browser login) | [docs/agents/ui-verification.md](docs/agents/ui-verification.md) |
| Which Convoy MCP server; updating MCP tools | [docs/agents/mcp-servers.md](docs/agents/mcp-servers.md) |
| Issue tracker, tags vs. labels | [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) |
| Triage labels | [docs/agents/triage-labels.md](docs/agents/triage-labels.md) |
| Domain docs layout (`CONTEXT.md`, `docs/adr/`) | [docs/agents/domain.md](docs/agents/domain.md) |
| Convex: query/validator/auth/permission rules | [docs/guidelines/convex/core-conventions.md](docs/guidelines/convex/core-conventions.md) |
| Convex: domain layout, `ensure`, repo files | [docs/guidelines/convex/backend-development.md](docs/guidelines/convex/backend-development.md) |
| Testing (`convex-test` + Vitest) | [docs/guidelines/testing.md](docs/guidelines/testing.md) |
| TypeScript, comments, file-naming conventions | [docs/guidelines/code-style.md](docs/guidelines/code-style.md) |
| Architecture & module-ownership guardrails | [docs/guidelines/architecture.md](docs/guidelines/architecture.md) |
| Frontend design system (read before UI work) | [docs/guidelines/frontend-development.md](docs/guidelines/frontend-development.md) |
| Frontend code patterns (theming, hotkeys, LexoRank) | [docs/guidelines/frontend-patterns.md](docs/guidelines/frontend-patterns.md) |
| Repo layout | [docs/architecture/project-structure.md](docs/architecture/project-structure.md) |
| Data model concepts (task refs, LexoRank, soft delete) | [docs/architecture/data-model.md](docs/architecture/data-model.md) |
| CLI agent bridge architecture | [docs/architecture/cli-bridge.md](docs/architecture/cli-bridge.md) |
| CLI TUI interaction guidelines, read before UI changes | [apps/cli/TUI-UX-GUIDELINES.md](apps/cli/TUI-UX-GUIDELINES.md) |
| Product vocabulary | [CONTEXT.md](CONTEXT.md) |

## Browser automation

Our shipped devcontainers provide standalone `playwright-cli`. Check
`playwright-cli --help`; if missing, rebuild the container. Do not use the removed
`convoy browser` commands or assume arbitrary user environments have a browser.

Use a unique named session and the environment-owned configuration to capture the
already-running app. This container configuration explicitly disables Chromium's
inner sandbox; the outer container/project boundary remains in force.

```bash
playwright-cli -s=ui open --config=/usr/local/share/playwright-cli/config.json
playwright-cli -s=ui goto <url>
playwright-cli -s=ui set-color-scheme light
playwright-cli -s=ui screenshot --filename=/tmp/page-light.png
playwright-cli -s=ui set-color-scheme dark
playwright-cli -s=ui screenshot --filename=/tmp/page-dark.png
playwright-cli -s=ui close
```

For login, clicks and application-specific theme controls, use upstream CLI
commands. Color preference does not override a site's saved theme. See
[UI verification](docs/agents/ui-verification.md) for preview-user login and
[Browser automation](docs/specs/cli-browser-automation.md) for environment details.
Inspect screenshots before attaching them with the run's `convoy threads attach`
command. Close your named session; do not close another agent's sessions.

Run `convoy threads attach` once per file set, and never pipe its output
through `tail` or `grep`. Each run adds new attachments, and the CLI cannot
remove them, so a retry after an upload that worked leaves duplicates. Judge
success by the exit code and the `✓ Attached` line, not by whether any
output appeared.

## Commands

```bash
# Validation (run before finishing — see above)
pnpm web:lint
pnpm web:test:once           # single run
pnpm web:test                # watch mode
pnpm web:test:coverage

# Build
pnpm web:build

# Dev servers — USER-RUN ONLY in the primary checkout (see hard rule 5).
# Safe to run yourself only inside a linked worktree.
pnpm web:dev                 # Next.js
pnpm web:convex:dev          # Convex, auto-syncs schema/functions
pnpm worktree:convex:deploy  # worktrees only: no watch mode on previews
```

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `apps/web/convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.
<!-- convex-ai-end -->
