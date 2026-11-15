# ADR 0003: Centralize App Navigation

## Status

Accepted

## Context

Project pages, thread workspaces, auth flows, and sidebar links previously mixed
direct Next router calls, direct `window.history` calls, string URL builders, and
component-local query parsing. That made query-only state changes harder to reason
about and caused project-page task open/close flows to use a transport that could
trigger full page reloads in long-lived tabs.

The app needs one internal routing boundary that owns:

- route target construction
- URL serialization
- same-path query state updates
- path-changing Next router transitions
- subscription to location state

## Decision

App code must use `@/lib/navigation` for navigation and route construction.

The navigation kernel exposes:

- `RouteTarget`, `routeTarget`, and `href` for typed target construction and
  serialization.
- `useNavigation` for navigation transport. Same-path updates use native history
  and emit a shared location event. Path transitions use the Next router with
  `scroll: false` by default.
- `useNavigationLocation` for pathname/search/hash state.
- `AppLink` for app links.
- domain adapters such as `useProjectNavigationState` and
  `useThreadNavigationState`.

Direct imports from `next/navigation`, `next/link`, and the deleted
`@/lib/routing/urls` module are lint-restricted outside `lib/navigation`.

## Consequences

URL state rules are centralized and testable. New project or thread URL features
should extend the relevant adapter instead of introducing local query parsing or
direct router calls. The navigation kernel is intentionally internal to the app;
it is treated like a stable library API but can evolve with project needs.
