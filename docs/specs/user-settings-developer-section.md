# User Settings Developer Section Specification

This document defines the `Developer` section inside the user settings dialog.

## Overview

- The user settings dialog includes a `Developer` section alongside the existing user-level settings areas.
- The `Developer` section is visible in production builds.
- Developer settings are local to the current browser/device and are not synced through backend user preferences.
- The section displays read-only frontend and backend deployment metadata for debugging stale client/backend combinations.

## Developer Settings Model

- Developer settings are owned by one shared client-side developer-settings subsystem.
- The subsystem exposes one generic typed hook for reading a setting plus convenience hooks for frequently used toggles.
- All public developer-settings hooks live in one file so the access surface stays easy to maintain.
- The shipped settings cover task-list diagnostics, gated project settings areas, unfinished placeholders, and the tool call debug copy.

## Current Toggles

- The section renders one toggle per feature, not one global developer mode switch.
- Toggling a developer setting updates local browser storage immediately and propagates to open tabs through the shared storage subscription.
- URL query parameters do not control developer settings.
- The initial toggle set includes:
  - `Project header: Board view`
  - `Extra Project settings`
  - `Task list: Show rank`
  - `Show unfinished items`
  - `Threads: Tool call debug`

## Tool Call Debug

- `Threads: Tool call debug` (off by default) shows a bug icon on tool rows
  that copies the raw tool call JSON (OS-2256). Off: the icon is not rendered.
- The copy confirms with a `Tool call JSON copied` toast, or an error toast
  when the clipboard is unavailable or the write fails. It never logs to the
  console.

## Unfinished Items

- `Show unfinished items` (off by default) controls disabled placeholders for
  features that are not built yet. Off: they are not rendered, and any
  separator that only framed them goes too. On: they render disabled, as before.
- New placeholder menu items go behind this toggle; a placeholder must never
  ship visible by default.
- Gated placeholders:
  - Main sidebar: `Threads (coming soon)`.
  - Project row `...` menu: `Archive`.
  - Project header settings menu: `Filters`, `Auto hide done items`, `Import`,
    `Export`, `Notify me`.
  - Task context and detail menus: `Create follow-up task`, `Add subtask`.
  - Thread composer environment picker: `Cloud`.
  - User settings dialog: `Account`, `Danger zone`.
  - Organization settings nav: `Workflows`, `Task Templates`,
    `Project Templates`.
  - Project settings nav and Customization tabs: sections and tabs gated by
    `Extra Project settings` while that toggle is off.
- Placeholder buttons inside settings pages (e.g. Danger Zone `Archive`) are
  not menu items and stay visible.

## App Version Metadata

- The frontend version is baked into the Next.js bundle at build time from Vercel metadata when available:
  - `NEXT_PUBLIC_APP_BUILD_ID` if explicitly set
  - otherwise `VERCEL_GIT_COMMIT_SHA`
  - otherwise `GIT_SHA`
  - otherwise `development`
- The backend version is returned by `api.appVersion.core.get` (module `convex/appVersion/core.ts`) from Convex runtime environment metadata:
  - `CONVOY_BACKEND_BUILD_ID` for the deployed backend commit/build id
  - `CONVOY_BACKEND_BUILD_TIME` for optional deploy timestamp
  - `CONVOY_BACKEND_GIT_REF` for optional branch/ref
  - `CONVOY_BACKEND_VERCEL_ENV` for optional Vercel environment label
- The Developer section renders this metadata for debugging.
- Transitional: root `convex/appVersion.ts` re-exports `get` so the legacy `api.appVersion.get` path keeps working for stale browser bundles until the app-update banner prompts a refresh. Remove the shim (and its legacy-path test) one deploy cycle after the rename ships.

## App Update Warning

- The root layout mounts a client-side app-version watcher outside Convex so the check does not depend on generated Convex API compatibility.
- The watcher fetches `/api/app-version` with `cache: "no-store"` on a fixed interval.
- `/api/app-version` is intentionally public because the root watcher also
  runs on signed-out authentication pages and the response contains only
  public frontend build metadata.
- The poll interval is configured by `NEXT_PUBLIC_APP_VERSION_POLL_INTERVAL_MS` and defaults to `120000` milliseconds.
- The watcher also checks once on mount and whenever the tab becomes visible again.
- When the fetched frontend build id differs from the loaded bundle's build id, the app shows a persistent fixed bottom banner with a refresh action.
- The first warning iteration is non-blocking and does not attempt frontend/backend compatibility decisions.
- Network errors, invalid responses, or matching build ids must fail soft without user-visible errors.

## Acceptance Checklist

- The user settings dialog sidebar shows `Developer` as an enabled section.
- Opening the `Developer` section renders one switch per developer feature.
- Opening the `Developer` section renders frontend and backend version metadata.
- A stale frontend build shows a persistent refresh notification after the watcher detects a newer `/api/app-version` build id.
- Toggling a developer setting updates the shared hook state without a page reload.
- Existing gated project controls continue to react to their grouped setting without depending on a global developer mode flag.
