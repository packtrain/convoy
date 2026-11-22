# Auth Redirect Return URL

## Scope

Defines how authentication redirects preserve the user's intended in-app destination when a protected page is opened with no valid Clerk session. Convex Auth mode redirects the same way from `proxy.ts`, with the session cookie in place of Clerk's ([auth-adapters.md](auth-adapters.md#route-gate)).

## Expected Behavior

- Protected app routes redirect signed-out users to `/auth/sign-in`.
- The sign-in URL must include a `redirect_url` query parameter for the originally requested app URL.
- The sign-in and sign-up pages force the Clerk post-auth redirect through `/auth/callback`, forwarding the incoming `redirect_url` as a query parameter (`buildAuthCallbackPath`). Clerk otherwise prefers a `redirect_url` query parameter over `fallbackRedirectUrl`, which would skip onboarding entirely.
- `/auth/callback` waits for both Clerk sign-in and authenticated Convex state
  before invoking onboarding. It must invoke onboarding at most once per
  callback mount after auth becomes ready.
- `/auth/callback`, `/o`, and `/o/<organizationSlug>` share one auth-readiness
  policy with a 30 s timeout. Each distinct pending window receives the full
  timeout grace period, including a later Clerk token refresh or Convex
  reconnect after recovery. 30 s covers a stalled Clerk token request (observed
  up to 15 s) plus the re-auth retries below.
- Convex gives up on auth after one failed Clerk token fetch and never retries
  on its own. `ConvexClerkProvider` re-runs `setAuth` while Clerk reports
  signed-in but Convex reports unauthenticated, with exponential backoff
  (1 s doubling to a 16 s cap, unbounded), so a Clerk stall self-heals without
  a page reload.
- A route error boundary that infers an auth error from a raw `Error` renders
  an "Authorizing" spinner while readiness is `loading`, calls the boundary
  `reset` once readiness becomes `authenticated`, and renders the recoverable
  auth error state only when readiness times out or reports signed-out.
  Callers that select the auth variant explicitly have already applied the
  timeout and render the error state immediately.
- After successful sign-in and onboarding sync, `/auth/callback` redirects to that `redirect_url`.
- Onboarding failures stay on the callback route and render the recoverable
  route error state; they must not redirect through `/` and create an
  onboarding loop.
- `/` forwards to `/o`. `/o` redirects to the last-used organization when
  that organization is still present in `listForUser`; otherwise it redirects
  to the first accessible organization returned by that query.
- An organization no-access screen provides a primary action back to `/`, so a
  stale or inaccessible organization URL can recover through the same
  accessible-organization selection flow.
- `/o` skips `organizations.core.listForUser` until Convex is authenticated.
  Only an authenticated empty result routes to `/auth/callback`; transient
  unauthenticated results must not be interpreted as a user with no
  organizations.
- Auth readiness on `/auth/callback` and `/o` is bounded. If it does not
  settle within the shared timeout, the route renders the recoverable auth
  error state instead of an indefinite spinner.
- If `/auth/callback` is reached while signed out, it forwards the same safe `redirect_url` to `/auth/sign-in`.
- If a client-side session transition leaves `/o` or an organization route
  signed out after middleware has already passed, the protected route renders
  the recoverable authentication error state. This avoids automatic redirect
  loops while retaining `Try again` and `Sign in again` actions.
- Routes that know a failure is authentication-related select the
  authentication recovery variant explicitly. Message-based error
  classification is reserved for route error boundaries that only receive a
  raw `Error`.
- The identity-sync mutations (`users.core.store`, `users.core.onboard`) reject
  unauthenticated callers with the same structured Convex error code
  `AUTH_NOT_AUTHENTICATED`; client behavior must not depend on a server error
  message that production may redact.
- Direct visits to `/auth/callback` without a redirect continue to fall back to the user's organization route.
- Direct visits to `/o/<organizationSlug>` continue to use the existing last-project redirect behavior.
- When local agent browser login is enabled, `/api/agent/browser-login` mints a short-lived Clerk sign-in-token URL for the configured preview user and points it at `/auth/callback?redirect_url=<target>` so Convex user sync/onboarding still runs before the protected destination is opened.

## Redirect URL Safety

- `redirect_url` may be an app-relative path beginning with `/`.
- `redirect_url` may be an absolute URL only when its origin matches the current app origin.
- Same-origin absolute URLs are normalized to path, search, and hash before client navigation.
- External origins, protocol-relative external URLs, non-http schemes, empty strings, and path-relative values such as `threads/1` are ignored.

## Agent Browser Login Safety

- Agent browser login is disabled unless `CONVOY_AGENT_BROWSER_LOGIN_ENABLED=true`, `CONVOY_AGENT_BROWSER_AUTH_SECRET`, and `CONVOY_AGENT_BROWSER_USER_EMAIL` are configured.
- The endpoint is public at the Clerk middleware layer but must reject requests without the configured secret.
- The endpoint must only accept requests for allowed local hosts. The default allowlist is `localhost`, `127.0.0.1`, `::1`, `app.convoy`, and `app.convoy.localhost`; deployments can override it with `CONVOY_AGENT_BROWSER_ALLOWED_HOSTS`.
- POST requests accept the secret through the `x-convoy-agent-browser-secret` header and return JSON containing the Clerk login URL.
- GET requests may accept the secret in the `secret` query parameter and redirect directly to Clerk. This is for browser-tool convenience only; POST is preferred when a shell is available.
- Sign-in tokens must be short-lived. Agents must use a dedicated preview user, not a real human user.

## Regression Case

When a user returns to an expired session at `/o/acme/WEB/threads/abc?task=WEB-7`, Clerk sign-in must return them to `/o/acme/WEB/threads/abc?task=WEB-7`, not to `/o/acme/` or the last opened project.
