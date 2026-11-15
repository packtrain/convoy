# App Navigation

## Goal

All in-app URL state and navigation flows go through `apps/web/lib/navigation`.
Feature code should describe the target route/state it wants, not choose browser
or Next transport directly.

## Rules

- Build app routes with `appRoute`, `routeTarget`, and domain state helpers.
- Render app links with `AppLink`.
- Read route params with `useRouteParams`.
- Read pathname/search/hash with `useNavigationLocation`.
- Navigate with `useNavigation`.
- Same-path query-only updates must use native history.
- Pathname transitions must use the Next router with `scroll: false` unless a
  caller explicitly opts into another scroll behavior.
- After native history updates, emit the shared navigation location event so URL
  subscribers update without waiting for a full router transition.
- Project URL state lives in `project-state.ts` and
  `use-project-navigation-state.ts`.
- Thread workspace URL state lives in `use-thread-navigation-state.ts`.

## Forbidden In Feature Code

- Direct imports from `next/navigation`.
- Direct imports from `next/link`.
- The legacy `@/lib/routing/urls` module.
- Ad hoc string query manipulation for project or thread URL state.

## Acceptance

- Opening, closing, and switching project tasks updates the URL without
  `pagehide` and a fresh mount.
- Board/list path transitions still route through Next.
- Browser back/forward works across same-path query entries and path entries.
- Tests assert transport selection, not only final string output.
