# Auth adapters

Status: S1 implemented (OS-2492). Parent plan: OS-2491.

Convoy signs people in through one of three adapters, chosen at build time:

| Mode | Sign-in | Accounts | Used by |
| --- | --- | --- | --- |
| `clerk` | Clerk's hosted components | Clerk users, matched by `tokenIdentifier` | The hosted app. Default when the mode is unset. |
| `convex` | Our own email and password forms on Convex Auth 2 | Convex Auth users, matched by user id | Self-hosted multi-user installs |
| `local-demo` | None. Every request is the demo user. | One synthetic user | The no-auth demo. See [local-demo-auth.md](local-demo-auth.md). |

`NEXT_PUBLIC_AUTH_MODE` sets the mode for the web bundle. `apps/web/lib/auth/auth-mode.ts`
parses it with one `z.enum`, and an unknown value fails the build.

There is no `convoy` CLI command for any of this. Sign-in happens in a browser,
and the CLI keeps authenticating with API keys.

## Frontend

`apps/web/lib/auth/hooks.ts` holds an exhaustive `Record<AuthMode, AuthAdapter>`
and exports the selected adapter's parts under fixed names. Product code imports
only these: `AuthProvider`, `SignInScreen`, `SignUpScreen`, `useAppAuth`,
`useAppUser`, `useAppSignOut`, `useAppUpdateProfileName`, `useAppConvexAuth`,
`supportsSignOut` and `emailChangeHint`.

`emailChangeHint` is the line under the read-only email in user settings.
Convex mode has none: the address can't be changed yet, and the disabled field
already says so.

Each adapter lives in `apps/web/lib/auth/adapters/`:

- `clerk.tsx` wraps the app in `ClerkProvider` and `ConvexClerkProvider`
  (`convex-clerk-provider.tsx`, with its retry loop), and renders Clerk's
  `<SignIn/>` and `<SignUp/>`.
- `local-demo.tsx` renders a plain `ConvexProvider` behind the demo bootstrap
  gate. Its sign-in screens render nothing, because the auth pages redirect a
  signed-in user away.
- `convex.tsx` renders `ConvexAuthProvider`. Sign-out calls
  `useAuthActions().signOut` and then loads `redirectUrl`, or the sign-in page.
- `convex-user.ts` holds the profile hooks backed by our `users` row
  (`users.core.current`, `users.core.syncProfile`). The Convex and local-demo
  adapters both use them, and no adapter imports another.

Direct `@clerk/nextjs` imports are allowed only in `adapters/clerk.tsx`,
`adapters/convex-clerk-provider.tsx`, `proxy.ts` and the agent browser-login
route.

`proxy.ts` picks its handler from a `Record<AuthMode, () => NextProxy>`.
Clerk mode runs `clerkMiddleware`. The other two pass every request through
and keep only the link-preview response.

`AuthPageWrapper` sends a signed-in visitor of `/auth/sign-in` or
`/auth/sign-up` to `/auth/callback`, carrying `redirect_url`. The callback runs
`users.core.onboard` and then opens `redirect_url` or the first workspace. This
is how a new Convex Auth account gets its workspace right after sign-up.

### Convex mode screens

`/auth/sign-in` renders `EmailPasswordSignInForm` and `/auth/sign-up` renders
`EmailPasswordSignUpForm` (both in `components/blocks/auth/`), on the shared
`EmailPasswordForm` card. Each links to the other and keeps `redirect_url`.
Every error code the package returns maps to one plain message through an
exhaustive `Record`. A wrong password and an unknown address both show "Wrong
email or password." When the backend refuses with a `ConvexError`, such as
"Email sending is not configured on this deployment", the sign-up form shows
that text.

### Route gate

Until S4 there is no server-side gate in Convex mode. `SignedOutRedirect`, inside
the Convex adapter's provider, sends a signed-out visitor of any page other than
`/auth/sign-in` and `/auth/sign-up` to the sign-in page with `redirect_url` set
to the page they asked for. It reloads the page instead of using client
navigation, because the provider sits outside `NavigationProvider`. Sign-out
navigates itself, so the gate stands down while it runs. Otherwise the gate
would win and send the next person to sign in to the page the last one left.

### Session

`ConvexAuthProvider` keeps the tokens in `localStorage` and falls back to memory
during server render. The access token lasts 60 seconds and the client refreshes
it about once a minute. S4 moves the refresh token into an httpOnly cookie.

`useAppAuth().userId` is the session id from the token's `sub` claim. It stays
the same across refreshes and changes on the next sign-in, which is all the
per-user cache keys need. Treat it as an opaque cache key in every mode, never
as a stable user id.

## Backend

### Issuers

`convex/auth.config.ts` lists the Clerk provider and `convexAuthProvider()`.
`resolveIdentityUser` in `convex/lib/access/auth.ts` dispatches on the token
issuer, not on the mode. A token issued by `${CONVEX_CLOUD_URL}/components/auth`
names a Convex Auth session, and `getAuthUserId` turns it into the user id. Any
other issuer is matched through `users.by_token`. The backend needs no mode flag
for this, and the `withIdentity` test calls keep working.

`users.tokenIdentifier` is optional. Convex Auth users have none.

### Components

`convex/convex.config.ts` mounts `auth`, `authEmail` and `authPassword` on every
deployment. Their tables stay empty outside Convex mode. `convex/auth.ts` loads
on every deployment too, so it must not require an env var. It exports
`signOut`, `refreshSession`, `isAuthenticated`, `signUpWithEmailPassword`,
`completeSignUpWithEmailPassword`, `signInWithEmailPassword` and
`signUpWithoutEmailVerification`. Change-password, recovery and change-email arrive in
later slices.

The email method needs three absolute landing URLs at setup. They are built from
`getAppUrlBase()`: `/auth/verify-email`, `/auth/change-email` and
`/auth/reset-password`. None of these pages exists yet. The package checks them
when the module loads, so a `NEXT_PUBLIC_APP_URL` without a scheme, such as
`localhost:3000`, fails `convex deploy` in every mode.

### Opt-in

New Convex Auth accounts need `AUTH_MODE=convex` on the Convex deployment, the
same variable local-demo uses. `users.core.createAuthUser` checks it before the
password is hashed and throws "Convex Auth sign-up is not enabled on this
deployment" otherwise. The sign-up functions are public on every deployment, so
without this check anyone could create a Convex Auth account on the hosted
Clerk deployment by calling the API, once S1b adds a real sender. Token
resolution still dispatches on the issuer and needs no flag.

### Users

- `users.core.createAuthUser` is the method's `createUser`. It runs when sign-up
  starts and inserts a row with an empty email and name, because the method
  passes no address.
- `users.core.onAuthSignIn` runs on every sign-in. It reads the primary verified
  address from `authEmail` and writes it to `users.email`, normalized by
  `normalizeEmail` in `convex/lib/shared/strings.ts` (trimmed, lowercase, NFC).
  Member lists, notifications and the `by_email` lookups read that column, and
  invitations normalize the same way. An empty name becomes the address's local
  part. People rename themselves in user settings.
- `users.core.onboard` and `users.core.store` resolve a Convex Auth caller to the
  existing row. Clerk callers still upsert from their token claims. Without a
  JWT, `onboard` resolves the local-demo user, because `/auth/callback` runs in
  every mode.

## Email verification

`AUTH_EMAIL_VERIFICATION` on the Convex deployment is `required` or `off`. Unset
means `required`, so the safe setting is the default from day one. S1 implements
`off` only. With `required`, sign-up fails with "Email sending is not configured
on this deployment" until S1b adds Resend.

The package's email method has no option to skip verification. It always hands
a link to a function it expects to be Resend's `lib.sendEmail`. We pass our own
internal mutation, `auth.deliverAuthEmail`, with the same arguments. With
verification off it sends nothing:

- A sign-up link: it stores the link's `code` in `pendingSignUpCodes`, one row
  per normalized address.
- Any other link, recovery or change-email, is dropped. Handing a recovery code
  to whoever asks would be an account takeover.

The sign-up form calls `auth.signUpWithoutEmailVerification`, one mutation that
runs the package's `signUpWithEmailPassword`, takes the stored code, runs
`completeSignUpWithEmailPassword` and returns the session tokens. The form hands
them to `useAuthActions().setSession`. Because it is one transaction, the code
row never outlives the call, nothing can read or steal the code in between, and
a failure rolls back the user row with everything else. Expected errors
(`EMAIL_TAKEN`, a weak password, `RATE_LIMITED`) come back as `userError`; the
user row is created only after the package's own checks pass.

The package's `signUpWithEmailPassword` stays public, as the package exports it.
Calling it directly still leaves a user row with an empty email and no way to
complete it, limited by the package to 20 sign-up starts per hour per IP.

## Switching auth mode

Choose the mode before the first user signs up. Switching later does not move
accounts:

- Each mode matches only its own accounts, by Clerk token or by Convex Auth user
  id, never by email.
- After a switch, a person who signs up again with the same address gets a new
  empty user. The old user and its organizations, tasks, API keys and CLI logins
  stay in the database. Switching back restores access.
- API keys and CLI logins keep working as the old user, because they point at
  the `users` row.
- Two `users` rows can then share an address, and inviting it throws until S2
  (OS-2493).

## Deployment

A Convex mode deployment sets:

- `NEXT_PUBLIC_AUTH_MODE=convex` for the web build.
- `AUTH_MODE=convex` on the Convex deployment, to allow new accounts.
- `AUTH_EMAIL_VERIFICATION=off` on the Convex deployment, until S1b.
- A placeholder `CLERK_JWT_ISSUER_DOMAIN`, as local-demo does, because
  `auth.config.ts` always lists the Clerk provider.
- `NEXT_PUBLIC_APP_URL` on the Convex deployment, with a scheme, so the landing
  URLs point at the right host.

The deployment signs its own tokens, so there are no auth secrets.

## Not covered yet

Invitations (S2), the self-hosted script (S7a), verification on (S1b), forgotten
passwords (S3), the cookie session and server-side redirect (S4), agent browser
login (S5, `app/api/agent/browser-login` still calls Clerk), and Google (S6).

## Testing

`convex/auth.test.ts` runs the real components through `convex-test`. It covers
sign-up with verification off leaving one user and no pending code, the
normalized address in `users.email`, the workspace name, sign-in with right and
wrong passwords, a taken address, a weak password, sign-out, `store` on a Convex
Auth session, a token with a session's subject and another issuer, the stand-in
dropping recovery and change-email links, and sign-up failing with verification
`required` or without `AUTH_MODE=convex`. `convex/users/localDemo.test.ts`
covers anonymous `onboard` in local-demo. `lib/auth/adapters/convex.test.tsx`
covers the route gate and sign-out, and
`components/blocks/auth/email-password-sign-up-form.test.tsx` covers the
form's messages.

`convex-testing/context.ts` registers the three components. `vitest.config.ts`
loads `.wasm` imports as `WebAssembly.Module`, as Convex's bundler does, for the
password hashing.
