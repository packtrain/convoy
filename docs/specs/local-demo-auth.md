# Local Demo Auth Mode

Status: implemented (OS-1230)

The self-hosted bundle (`self-hosted/`) can run entirely without third-party
services. In **local-demo** auth mode there is no sign-in: every anonymous
request acts as one stable synthetic demo user. **clerk** mode (the default
everywhere) is unchanged.

## Mode wiring

One logical flag in three places kept in sync by `self-hosted/start.sh`, which
offers `local-demo`, `convex` and `clerk`. For `convex` see
[auth-adapters.md](auth-adapters.md#deployment).

| Surface | Mechanism | Consumed by |
| --- | --- | --- |
| Web bundle | `NEXT_PUBLIC_AUTH_MODE` build ARG (`self-hosted/web.Dockerfile`), default `clerk` | `apps/web/lib/auth/auth-mode.ts` (`authMode`, `isLocalDemoAuthMode`) |
| Convex deployment | `AUTH_MODE` deployment env var, set by `start.sh` in every mode (`npx convex env set AUTH_MODE local-demo`) | `apps/web/convex/lib/access/localDemo.ts` (`isLocalDemoDeployment`) |
| Compose/.env | `AUTH_MODE` in `self-hosted/.env` | `start.sh`, compose build arg |

Rules:

- The mode is **fixed at web-image build time**. Switching modes requires
  rebuilding the image and re-syncing the Convex env (`start.sh` does both).
- The backend trusts only its own deployment env var, never the client.
- It must never activate implicitly: an unset flag means `clerk` on both
  sides. The Next.js production build must pass with zero Clerk env in
  local-demo mode.
- `convex/auth.config.ts` must NOT reference `AUTH_MODE`: Convex requires
  every env var used in the auth config to be set on the deployment, which
  would break existing Clerk deployments. Local-demo deployments instead set
  `CLERK_JWT_ISSUER_DOMAIN=https://local-demo.invalid` — a placeholder
  provider that is never exercised because no JWTs are issued.

## Backend behavior

- `convex/lib/access/localDemo.ts` defines the demo identity:
  `tokenIdentifier = "local-demo|user"`, name "Demo User", email
  `demo@convoy.local`.
- `getOptionalAuthenticatedAccess` (`convex/lib/access/auth.ts`) resolution
  order: Clerk JWT identity → API key → **local-demo fallback** (only when
  `AUTH_MODE=local-demo`). The fallback is **lookup-only**; queries never
  create the demo user.
- `users.core.onboardLocalDemo` (public mutation, rejects with `ConvexError`
  unless the deployment flag is set) idempotently creates the demo user, a
  workspace org (demo user as owner), the starter project with its Inbox
  list, and the project-admin membership. It shares the onboarding helper
  with the Clerk `users.core.onboard` path.
- All authorization stays real: the demo user goes through the normal
  permission helpers via its memberships. No permission bypasses.
- API keys, MCP, and CLI authentication are unchanged; the demo user can
  create API keys like any user.
- `users.core.syncProfile` resolves the user through the canonical auth
  boundary, so profile-name updates work without a Clerk identity.

### Semantics caveat

In local-demo mode, "optional auth" (`getOptionalAuthenticatedUser/Access`)
only returns `null` before `onboardLocalDemo` has run. Code paths that
distinguish unauthenticated visitors (invitation acceptance, no-access
screens) effectively never see an anonymous caller on an onboarded
local-demo deployment.

## Frontend behavior

- `lib/auth/auth-mode.ts` exposes the build-time flag; `lib/auth/hooks.ts`
  selects the adapter. Product code uses its exports instead of Clerk hooks.
  [auth-adapters.md](auth-adapters.md) lists them and the files allowed to
  import `@clerk/nextjs`.
- `lib/auth/adapters/local-demo.tsx`: the provider renders plain
  `ConvexProvider` (no ClerkProvider) and gates the app behind an
  `onboardLocalDemo` call so first-load queries see an onboarded workspace.
- `proxy.ts`: local-demo skips `clerkMiddleware` (which requires keys) and
  keeps only link-preview handling; every route is reachable.
- In local-demo the adapter reports a permanently signed-in state; auth pages
  redirect away via `AuthPageWrapper` and Clerk components never render.
- Sign-out affordances (sidebar user menu, no-access screen, route error
  state, signed-in-as note) are hidden when `supportsSignOut` is false. The
  sidebar user menu shows a "Local demo" badge instead.
- `app/api/agent/browser-login`: in local-demo, after the same
  secret/host validation, it skips Clerk and returns/redirects directly to
  the requested URL (auth is ambient). `userEmail` config is not required.
- MCP OAuth (`docs/specs/mcp-oauth.md`): the authorize/approve flow works
  unchanged — the approving "signed-in user" is the demo user via the
  backend fallback.

## Security boundary

Local-demo mode is intentionally no-auth and single-user:

- Anyone who can reach the Convex or web ports has the demo owner's full
  authority.
- `self-hosted/docker-compose.yml` binds all published ports to `127.0.0.1`
  by default (`BIND_HOST`); `start.sh` prints an explicit warning in demo
  mode.
- Not suitable for shared, hosted, or sensitive data; docs must not suggest
  otherwise.
- Invitations/multi-user membership flows are not meaningful (emails are not
  configured; there is exactly one identity).

## Testing

`convex/users/localDemo.test.ts` covers: flag-off rejection of
`onboardLocalDemo`, bootstrap creating user/org/project/memberships,
idempotency, anonymous resolution to the demo user (and to `null` before
bootstrap / with the flag off), Clerk identities keeping precedence, and
anonymous `syncProfile`.

## Related specs

- `docs/specs/mcp-oauth.md` — OAuth flow (works via the demo-user fallback)
- `docs/specs/auth-redirect-return-url.md` — Clerk-mode redirects (bypassed
  in local-demo)
