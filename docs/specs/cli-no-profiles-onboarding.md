# CLI No-Profiles Onboarding Specification

This specification defines the thread-page empty state shown when a project has no connected CLI profiles.

## Trigger

Show this state when `hasProfiles` is false in the thread layout **and the
route is not already pointing at a thread**. `hasProfiles` is based only on
profiles owned by the authenticated user; a teammate's saved or connected
profile does not suppress onboarding.

The route check exists for read-only sharing (`cli-thread-sharing.md`): a
teammate opening a shared-thread link has no profile of their own in that
project, and onboarding would replace the thread they were sent. On a thread
route with no profiles the workspace renders full-width and the **sidebar is
suppressed** — its list is empty and its New-thread affordance cannot work
without a profile.

## Goal

Help users get connected quickly with clear first-time setup paths:
- start interactive immediately, or
- create a project-prefilled profile, then connect by profile key.

## Required Guidance Blocks

The thread page shows one primary command block, then a collapsed "Other ways
to connect" section holding the other two. The section starts closed and opens
with a chevron toggle.

1. **Interactive mode** (primary, always shown)
   `npx @useconvoy/cli connect`

   Below it, still above the fold, a **Backend URL** block shows this
   deployment's Convex URL (`NEXT_PUBLIC_CONVEX_URL`) with its own copy
   button, because interactive connect asks for the deployment URL.

2. **Create profile** (under "Other ways to connect")
   Includes:
   - `--url`
   - `--project <project_id>`
   - `--profile <project_name>`
   - `--profile-key <derived_key>`
   - No `--api-key`; the CLI offers browser login (default) or pasting a key
     (see `cli-browser-login.md`; `convoy login` forces the browser flow).
   - No `--path`; the CLI prompts for the workspace folder.

3. **Connect using the saved profile** (under "Other ways to connect")
   `npx @useconvoy/cli connect --profile <derived_key>`

Every command block has a copy button that is always visible, not only on
hover. Long commands wrap inside the box instead of running past its edge.

The primary command lives once, as `INTERACTIVE_CONNECT_COMMAND` in
`lib/threads/setup-commands.ts`. Every surface that shows it imports that
constant.

User settings → Profiles shows the same primary command block in its "No CLI
profiles" empty state, followed by the same Backend URL block
(`BackendUrlBlock`). It has no project context, so it shows only the
interactive command and the URL.

The thread sidebar's Connected CLIs section (see
[cli-thread-list.md](cli-thread-list.md#connected-clis-os-1993)) lists only the
user's own CLIs. It shows a compact empty state when none of them are online:

- If the authenticated user has no saved CLI profiles for the project, show the same no-API-key setup command from block 2 with a copy button.
- If the authenticated user has saved CLI profiles but none are online, show `npx convoy connect` with a copy button.

## Prefill Rules

- `projectId` should come from current project context.
- `projectName` should come from current project context and is used for `--profile`.
- `projectAlias` should come from current project context.
- Suggested profile key is derived from alias using a lowercase-safe slug and must start with a letter.
- When values are unavailable, show placeholders (`<project_id>`, `<convex_url>`) and fallback profile/key (`default`).

## Compatibility

- This is guidance text only; it does not change backend/session behavior.
- Existing interactive onboarding remains available and is presented as the default path.
