# Auth adapters

Status: S1 (OS-2492), S2 (OS-2493), S1b (OS-2495), S3 (OS-2496), S4 (OS-2497) and S6 (OS-2500) implemented. Parent plan: OS-2491.

Convoy signs people in through one of three adapters, chosen at build time:

| Mode | Sign-in | Accounts | Used by |
| --- | --- | --- | --- |
| `clerk` | Clerk's hosted components | Clerk users, matched by `tokenIdentifier` | The hosted app. Default when the mode is unset. |
| `convex` | Our own email and password forms on Convex Auth 2, plus Google when configured | Convex Auth users, matched by user id | Self-hosted multi-user installs |
| `local-demo` | None. Every request is the demo user. | One synthetic user | The no-auth demo. See [local-demo-auth.md](local-demo-auth.md). |

`NEXT_PUBLIC_AUTH_MODE` sets the mode for the web bundle. `apps/web/lib/auth/auth-mode.ts`
parses it with one `z.enum`, and an unknown value fails the build.

There is no `convoy` CLI command for any of this. Sign-in happens in a browser,
and the CLI keeps authenticating with API keys.

## Frontend

`apps/web/lib/auth/hooks.ts` holds an exhaustive `Record<AuthMode, AuthAdapter>`
and exports the selected adapter's parts under fixed names. Product code imports
only these: `AuthProvider`, `SignInScreen`, `SignUpScreen`, `VerifyEmailScreen`,
`ForgotPasswordScreen`, `ResetPasswordScreen`, `useAppAuth`,
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
- `VerifyEmailScreen`, `ForgotPasswordScreen` and `ResetPasswordScreen` render
  nothing in Clerk and local-demo mode. Clerk verifies the address and resets
  passwords inside its own screens.
- `convex.tsx` renders only the client route gate. The session provider sits
  in the root layout (see Session). Sign-out calls `useAuthActions().signOut`
  and then loads `redirectUrl`, or the sign-in page.
- `convex-user.ts` holds the profile hooks backed by our `users` row
  (`users.core.current`, `users.core.syncProfile`). The Convex and local-demo
  adapters both use them, and no adapter imports another.

Direct `@clerk/nextjs` imports are allowed only in `adapters/clerk.tsx`,
`adapters/convex-clerk-provider.tsx`, `proxy.ts` and the agent browser-login
route.

`proxy.ts` picks its handler from a `Record<AuthMode, () => NextProxy>`.
Clerk mode runs `clerkMiddleware`, Convex mode runs the route gate below, and
local-demo passes every request through with only the link-preview response.

`AuthPageWrapper` sends a signed-in visitor of `/auth/sign-in` or
`/auth/sign-up` to `/auth/callback`, carrying `redirect_url`. The callback runs
`users.core.onboard` and then opens `redirect_url` or the first workspace. This
is how a new Convex Auth account gets its workspace right after sign-up.

### Convex mode screens

`/auth/sign-in` renders `EmailPasswordSignInForm` and `/auth/sign-up` renders
`EmailPasswordSignUpForm` (both in `components/blocks/auth/`), on the shared
`EmailPasswordForm` page. Each links to the other and keeps `redirect_url`.
Sign-up shows "At least 10 characters." under the password and asks for it a
second time in a "Confirm password" field. If the two differ, the form shows
"Passwords don't match." and does not call the backend. The package enforces
the password rules on the server either way.

The landing hero's animated halftone fills the page on its dark background, in
light and dark mode. The Convoy wordmark sits centered above a card that holds
the form. `components/custom/halftone-hero.tsx`
copies `apps/landing/components/effects/halftone-hero.tsx`, and
`public/gradient.jpg` copies the landing's source image. Change both copies
together. Clerk mode keeps Clerk's own centered card on the plain page.
Every error code the package returns maps to one plain message through an
exhaustive `Record`. A wrong password and an unknown address both show "Wrong
email or password." When the backend refuses with a `ConvexError`, such as
"Email sending is not configured on this deployment", the sign-up form shows
that text.

On a deployment with Google credentials both forms show "Continue with Google"
and an "or" divider above the fields (`GoogleSignInButton`, see
[Google](#google)). Without them the forms show only email and password.

### Verification screens

With verification required, `auth.signUpWithoutEmailVerification` answers
the error `EMAIL_VERIFICATION_REQUIRED` and changes nothing. The form then calls the
package's `useSignUpWithEmailPassword`, which runs `signUpWithEmailPassword` and
keeps the returned browser secret in the auth client's storage. The form swaps
to a "Check your email" card that names the address and says to open the link
in this browser. "Sign up again" goes back to the form. That is also how a
person gets a new link: S1b has no resend button.

The emailed link can't carry `redirect_url`, because the package builds it from
a fixed landing URL. The form keeps `redirect_url` in `localStorage` under
`convoy.signUpRedirect` (`rememberSignUpRedirect` in
`lib/routing/auth-redirects.ts`). Without it, someone who signed up from an
invitation would land in a new workspace instead of on the invitation.

`/auth/verify-email` renders `VerifyEmailScreen`. It runs the package's
`useCompleteSignUpWithEmailPassword` with the link's `code`, shows a spinner,
and on success replaces the page with `/auth/callback`, carrying the kept
redirect and removing it from storage. Errors map through an exhaustive
`Record`. A link opened in another browser (`MISSING_SECRET`) says to open it
where you signed up. An expired or used link says to sign up again. Its "Back
to sign up" link carries the kept redirect without removing it, so a retry
started from an invitation still ends on the invitation.

### Route gate

`convexAuthGate` in `proxy.ts` runs inside the package's `convexAuthNextjsProxy`.
A request for any page other than Clerk mode's public routes plus
`/auth/verify-email`, `/auth/forgot-password` and `/auth/reset-password` needs a
session, or it is redirected to the sign-in page with `redirect_url` set to the
path and query it asked for, before the page renders. A link-preview crawler
gets the generic preview instead, as in Clerk mode.

The gate checks that the proxy has an unexpired access token, refreshed from
the cookie when it is close to expiry. It does not ask the backend whether the
session is live: that would be one Convex query per page load and prefetch,
and every Convex call verifies the token anyway. A forged or revoked token
gets the page shell and no data, and the client gate below then sends it to
sign-in.

The proxy matcher skips `/auth/signin`, `/auth/refresh` and `/auth/signout`, so
the proxy's own refresh never races the handler's cookie writes.

`SignedOutRedirect`, inside the Convex adapter's provider, covers a session
that ends while a page is open, such as a sign-out in another tab. It sends a
signed-out visitor of any page other than those five auth pages to the sign-in
page with `redirect_url` set to the page. It reloads the page instead of using
client navigation, because the provider sits outside `NavigationProvider`.
Sign-out navigates itself, so the gate stands down while it runs. Otherwise the
gate would win and send the next person to sign in to the page the last one
left.

### Session

The refresh token lives in an httpOnly cookie, never in browser storage.
`lib/auth/convex-auth-server.ts` sets up the package's server side once
(`setupConvexAuthServer`, `setupConvexAuthNextjs`), lazily, so Clerk and
local-demo builds never create its Convex client.

- The root layout wraps the app in `ConvexAuthNextjsServerProvider`, inside a
  `Suspense` boundary, in Convex mode only. It reads the access token from the
  cookie and renders the package's client provider, which creates its own
  Convex client. The client keeps only the access token in `localStorage`.
  Reading cookies makes every page render dynamically in Convex mode. Clerk and
  local-demo stay as they were.
- The package's client posts to three fixed route handlers:
  `app/auth/signin/route.ts`, `app/auth/refresh/route.ts` and
  `app/auth/signout/route.ts`. Next routes are static, so they exist in every
  build and answer 404 outside Convex mode. `/auth/signin` and `/auth/signout`
  sit next to our pages `/auth/sign-in` and `/auth/sign-up`; the package fixes
  its paths.
- `/auth/signin` forwards a call to the deployment only for the functions that
  mint a session, and answers 403 for anything else:
  `signInWithEmailPassword`, `completeSignUpWithEmailPassword`,
  `completePasswordRecovery`, `signUpWithoutEmailVerification` and
  `completeSignInWithGoogle`. It moves the
  refresh token from the result into the cookie. A new session-minting
  function must join this list. Each must return the package's sign-in
  envelope, `{ status: "complete", tokens }` or `{ status: "error", userError }`;
  the route answers 500 for any other shape.
- The three routes accept a request only when its `Origin` host equals `Host`,
  `NEXT_PUBLIC_APP_URL`'s host, or, in dev, `localhost:$PORT`, because portless
  rewrites `Origin` to that.
- The routes and the proxy call the deployment at `CONVEX_SERVER_URL`, read at
  runtime, or `NEXT_PUBLIC_CONVEX_URL` when it is unset. The self-hosted
  compose file sets `http://backend:3210`, because the browser's
  `http://127.0.0.1:3210` points into the web container. The rendered client
  provider keeps the browser's URL.
- The cookie is `Secure` when `NEXT_PUBLIC_APP_URL` is `https`, or, with no app
  URL, in a production build. An install served over plain http, such as the
  self-hosted default `http://127.0.0.1:3000`, still gets its cookie.
- The agent browser login (`app/api/agent/browser-login`) signs its configured
  user in with `signInWithPasswordCookies`: it calls `signInWithEmailPassword`
  from the server with `CONVOY_AGENT_BROWSER_USER_PASSWORD` and sets the same
  cookies on its redirect. Convex Auth has no "sign in as" call app code may
  use, so it needs the password. Rules:
  [auth-redirect-return-url.md](auth-redirect-return-url.md#agent-browser-login-safety).

The access token lasts 60 seconds. The client refreshes it about once a minute
through `/auth/refresh`, and the proxy refreshes it when a page load finds it
close to expiry. Sessions made before S4 lived in browser storage and do not
carry over; those people sign in once more.

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

`convex/convex.config.ts` mounts `auth`, `authEmail`, `authPassword` and
`authGoogle` on every deployment. Their tables stay empty outside Convex mode. `convex/auth.ts` loads
on every deployment too, so it must not require an env var. It exports
`signOut`, `refreshSession`, `isAuthenticated`, `signUpWithEmailPassword`,
`completeSignUpWithEmailPassword`, `signInWithEmailPassword`,
`signUpWithoutEmailVerification`, `startPasswordRecovery`, `checkPasswordRecovery`,
`completePasswordRecovery`, `startSignInWithGoogle`, `completeSignInWithGoogle`
and the `getSettings` query. Change-password and change-email
are not exported.

The email method needs three absolute landing URLs at setup. They are built from
`getAppUrlBase()`: `/auth/verify-email`, `/auth/change-email` and
`/auth/reset-password`. `/auth/change-email` has no page yet. The package checks them
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

The check runs before anything the package writes sticks. The package's
`signUpWithEmailPassword` calls `createUser` before it hashes the password or
starts the email challenge, and nothing catches the error, so the whole mutation
rolls back.

`AUTH_MODE` is declared in `convex/convex.config.ts` as `clerk`, `local-demo` or
`convex`, and read from `env`. Convex refuses any other value when it is set,
so a typo fails at `convex env set` instead of quietly turning sign-up off.

### Users

- `users.core.createAuthUser` is the `createUser` of both methods. For email and
  password it runs when sign-up starts and inserts a row with an empty email
  and name, because the method passes no address. For Google see
  [Google](#google).
- `users.core.onAuthSignIn` runs on every email and password sign-in. It reads the primary verified
  address from `authEmail` and writes it to `users.email`, normalized by
  `normalizeEmail` in `convex/lib/shared/strings.ts` (trimmed, lowercase, NFC).
  Member lists, notifications and the `by_email` lookups read that column, and
  invitations normalize the same way. A new address also sets or clears
  `emailVerifiedAt` (see [Accounts](#accounts)). An empty name becomes the address's local
  part. People rename themselves in user settings.
- `users.core.onboard` and `users.core.store` resolve a Convex Auth caller to the
  existing row. Clerk callers still upsert from their token claims. Without a
  JWT, `onboard` resolves the local-demo user, because `/auth/callback` runs in
  every mode.

### Invitations

A Convex Auth token carries no `email` claim. `getIdentityEmail` in
`convex/lib/access/auth.ts` gives `organizations.invitations.accept` and
`getByToken` the caller's address: `users.email` for a Convex Auth session, the
token's `email` claim for any other issuer. Clerk behavior is unchanged.

With `AUTH_EMAIL_VERIFICATION=off` that address is unverified. Anyone can sign
up with any address, so accepting rests on holding the invitation link alone.
This is the cost of turning verification off.

## Email verification

`AUTH_EMAIL_VERIFICATION` on the Convex deployment is `required` or `off`. Unset
means `required`, so the safe setting is the default from day one.

The package's email method has no option to skip verification. It always hands
a link to a function it expects to be Resend's `lib.sendEmail`. We pass our own
internal mutation, `auth.deliverAuthEmail`, with the same arguments.

With verification required it forwards the call to the mounted Resend
component's `lib.sendEmail`. It fills in `RESEND_API_KEY` and the sender from
`getEmailFrom()` (`EMAIL_FROM`, the same sender as invitation email) when it
sends, so the package setup holds neither. Without `RESEND_API_KEY` it throws
"Email sending is not configured on this deployment". The throw rolls back the
whole sign-up, user row included, and the form shows the text. The package
sets the link lifetime and writes a plain-text email; we can't change either.
`deliverAuthEmail` adds our own subject and HTML from
[email-templates.md](email-templates.md) and keeps the package text as the
plain-text part: `verify-email` for a sign-up link, `reset-password` for a
recovery link, and `password-changed` for the notice with subject "Your
password was changed". It reads the link, its landing page and the lifetime out
of that text. If the text stops matching (a package update), the email goes out
as the package's plain text alone.

With verification off it sends nothing:

- A sign-up link: it stores the link's `code` in `pendingSignUpCodes`, one row
  per normalized address.
- Any other link, recovery or change-email, is dropped. Handing a recovery code
  to whoever asks would be an account takeover.

The sign-up form calls `auth.signUpWithoutEmailVerification` through the
`/auth/signin` route, one mutation that runs the package's
`signUpWithEmailPassword`, takes the stored code, runs
`completeSignUpWithEmailPassword` and returns the session tokens. The route
keeps the refresh token in the cookie, and the form hands the rest to
`useAuthActions().setSession`. With verification required it answers the error
`EMAIL_VERIFICATION_REQUIRED` and changes nothing. Because it is one transaction, the code
row never outlives the call, nothing can read or steal the code in between, and
a failure rolls back the user row with everything else. Expected errors
(`EMAIL_TAKEN`, a weak password, `RATE_LIMITED`) come back as `userError`; the
user row is created only after the package's own checks pass.

The package's `signUpWithEmailPassword` stays public, as the package exports it.
With verification off, calling it directly still leaves a user row with an
empty email and no way to complete it, limited by the package to 20 sign-up
starts per hour per IP. With verification required that is the normal path,
and a sign-up nobody verifies leaves the same row. It has no memberships, so
nothing lists it, and there is no cleanup job.

There is one account type in both settings. An account made with verification
off has a verified address in `authEmail`, so it keeps signing in after an
instance turns verification on. Sign-in only finds verified addresses, so an
account whose link was never opened gets "Wrong email or password."

## Forgotten password

Password reset needs a mailbox, so it exists only while verification is
required. With it off, the stand-in sender drops recovery links (see above).

`auth.getSettings` is a public query that reports the deployment's auth
configuration: `{ emailEnabled }`, false only when `AUTH_EMAIL_VERIFICATION=off`.
The sign-in form shows "Forgot password?" next to the password label only while
it is true, and carries `redirect_url` to the next page.

`/auth/forgot-password` renders `ForgotPasswordForm`, inside `AuthPageWrapper`
like sign-in. It asks for the email and calls the package's
`useStartPasswordRecovery`, which runs `startPasswordRecovery` and keeps the
browser secret in the auth client's storage. On success the card says "Check
your email", names the address the package returns as `sentTo`, and says to
open the link in this browser within 10 minutes. Errors map through an
exhaustive `Record`. An unknown address says "No account uses this email." The
package reports it, and sign-up's `EMAIL_TAKEN` reveals the same, under the same
per-IP limit. A `ConvexError` such as "Email sending is not configured on this
deployment" shows its text. The form appears only once `getSettings` says email
is on; until then the card shows a spinner. With email off the page says
password reset is off, for anyone who opens the URL directly, and that wins over
an earlier "Check your email": the stand-in sender drops the link.

The package writes the recovery email as plain text: subject "Reset your
password", the link, and its 10-minute lifetime. `deliverAuthEmail` sends it in
our `reset-password` template.

`/auth/reset-password` renders `ResetPasswordForm`. `useCompletePasswordRecovery`
subscribes to `checkPasswordRecovery` with the link's `code` and the kept secret,
so the page asks for a password only for a live link. The form has "Password"
with the length hint and "Confirm password", no email. A rejected password
(too short, too common) shows its message and keeps the form, because the
package checks it before it claims the link. On success the package sets the
password, revokes every session of the account, this browser's old one
included, and returns a new session. The page then replaces itself with
`/auth/callback`. The package also emails the primary address that the password
changed, sent in our `password-changed` template with a "Reset password" button
to `/auth/forgot-password`.

Link errors end the flow: a link opened in another browser (`MISSING_SECRET`)
says to open it where you asked for it, and an expired or used link says to ask
for a new one. Both offer "Get a new link" to `/auth/forgot-password`.

The emailed link carries no `redirect_url`, so a reset always ends in
`/auth/callback`'s default target, the first workspace. Someone who came from an
invitation opens the invitation link again.

`completePasswordRecovery` mints a session, so it is on the `/auth/signin`
allowlist (see Session).

## Google

A Convex mode deployment with a Google OAuth client shows "Continue with
Google" on the sign-in and sign-up pages. The package's Google method does
the OAuth flow; we supply the user callback and the button.

### Configuration

`convex.config.ts` mounts the package's `authGoogle` component under
`httpPrefix: "/auth/google"` and binds its `CLIENT_ID` and `CLIENT_SECRET` to
the app's `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET`. The prefix
is not the package's `/oauth/google`, because `http.ts` already serves
`/oauth/register` and `/oauth/token` for MCP.

The component declares both credentials as required strings, and Convex
checks that at push time. Bound to optional app variables, the push fails
("env var CLIENT_ID is required, but parent env var AUTH_GOOGLE_CLIENT_ID is
optional"). Declared required, it fails while they are unset. So the app
declares them required, and every deployment sets both, Clerk and
local-demo included. A deployment without Google sets them to `none`.
`auth.getSettings` reports `googleEnabled` when both are set and neither is
`none`, and the button shows only then.

The OAuth client is a "Web application" client whose redirect URI is
`<CONVEX_SITE_URL>/auth/google/callback`. The redirect URI is per deployment,
so each worktree preview, with its own site URL, needs its own registered by
hand to test Google. `startSignInWithGoogle` accepts a return URL only on the
origin of `getAppUrlBase()`. Setup steps, preview testing and troubleshooting:
[docs/agents/google-sign-in.md](../agents/google-sign-in.md).

### Flow

`GoogleSignInButton` (`components/blocks/auth/google-sign-in-button.tsx`)
calls the package's `useSignInWithGoogle(api.auth).signIn()`, which runs
`startSignInWithGoogle` and leaves for Google. Google returns to the
component's callback, which redirects back to the page the flow started on,
`redirect_url` included. The package's client provider registers its OAuth
client by default; on that page load it redeems the code through
`/auth/signin` with `completeSignInWithGoogle`, which sets the session cookie.
`AuthPageWrapper` then forwards to `/auth/callback` as after a password
sign-in, so a new Google account gets its workspace there.

When the flow fails after the redirect, the button reads the package's
`useOauth().flowError` and shows one message per code through an exhaustive
`Record`. Cancelling on Google's consent screen shows "Sign-in was
cancelled." A backend refusal, such as sign-up with `AUTH_MODE` unset, shows
the `ConvexError` text.

### Accounts

`users.core.createAuthUser` gets the Google profile: `id` (Google's `sub`),
`email`, `emailVerified`, `name` and `picture`. The package looks the Google
account up by `sub` first and calls `createUser` only for a new one.

- It refuses without `AUTH_MODE=convex`, as for email sign-up.
- When Google marks the address verified and a Convex Auth user (one without
  `tokenIdentifier`) has that normalized address in `users.email` and a
  `users.emailVerifiedAt`, it returns that user. Signing up by email with
  verification required and later continuing with Google on the same address
  is one account. Clerk users are never matched, as under
  [Switching auth mode](#switching-auth-mode).
- Otherwise it inserts a user with Google's name and photo. The email is
  stored only when Google verified it, with `emailVerifiedAt` set, and an
  account without a name is named after the address's local part.

`users.emailVerifiedAt` records that a mailbox check proved the address.
`onAuthSignIn` sets it when it writes a new address with verification
required, and clears it when it writes one with verification off. It never
changes for an address already stored. The current setting is not enough: an
address registered while verification was off stays unproven after it is
turned on. Linking it would hand the Google account's owner an account whose
password someone else chose. The package's own verified-email record doesn't
help either, because the verification-off sign-up completes it without a
mailbox. Rows from before S6 have no `emailVerifiedAt` and are never linked.

The reverse is not linked: signing up by email on an address a Google account
already uses makes a second user. The email method calls `createUser` before
it knows the address.

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
- Two `users` rows can then share an address. `organizations.invitations.create`
  checks membership for each of them through `listUsersByEmail`.

## Deployment

A Convex mode deployment sets:

- `NEXT_PUBLIC_AUTH_MODE=convex` for the web build.
- `AUTH_MODE=convex` on the Convex deployment, to allow new accounts.
- `RESEND_API_KEY` on the Convex deployment, and `EMAIL_FROM` with an address
  on a domain verified in Resend. Without a verified domain Resend delivers
  only to the Resend account owner's address. Or `AUTH_EMAIL_VERIFICATION=off`
  to skip email, at the cost described under Invitations.
- Optionally `SUPPORT_EMAIL` on the Convex deployment, the help address at the
  bottom of every email ([email-templates.md](email-templates.md#support-address)).
- A placeholder `CLERK_JWT_ISSUER_DOMAIN`, as local-demo does, because
  `auth.config.ts` always lists the Clerk provider.
- `AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET` on the Convex
  deployment, from a Google OAuth client, or `none` for both to turn Google
  off. Every deployment needs them, whatever its mode: Convex refuses to
  deploy without them (see [Google](#google)).
- `NEXT_PUBLIC_APP_URL` on the Convex deployment, with a scheme, so the landing
  URLs point at the right host. Set it for the web build too: it decides
  whether the session cookie is `Secure`, and behind a proxy that rewrites
  `Host` the auth routes trust its origin.

The deployment signs its own tokens, so there are no auth secrets.

## Not covered yet

The self-hosted script (S7a, which also asks for the Resend key), password reset
with verification off, change password and change email while signed in,
resending a verification link, GitHub and Apple sign-in, and linking an email
sign-up to an existing Google account.

## Testing

`convex/auth.test.ts` runs the real components through `convex-test`. It covers
sign-up with verification off leaving one user and no pending code, the
normalized address in `users.email`, the workspace name, sign-in with right and
wrong passwords, a taken address, a weak password, sign-out, `store` on a Convex
Auth session, a token with a session's subject and another issuer, the stand-in
dropping recovery and change-email links, and sign-up failing without
`AUTH_MODE=convex`. It covers Google's `createAuthUser` too: a new user
with the Google name and photo, linking by verified address, no link for an
unverified address, to a user without `emailVerifiedAt`, to an account
registered with verification off and then turned on (whose password keeps
opening only that account), or to a Clerk user, linking to an account made
through the emailed link, and refusal
without `AUTH_MODE=convex`. The OAuth round trip itself is the package's and
is not run here. With verification required it covers the one-transaction
mutation answering `emailVerificationRequired`, the emailed link completing
the sign-up and sign-in, sign-in refused before the link is opened, an account
made with verification off still signing in, sign-up refused without
`RESEND_API_KEY`, and a recovery link that sets the new password, ends the old
session and refuses the old password. It also covers `getSettings`, including `googleEnabled` with `none`. It records email through the package's Resend stub
(`registerResendStub`, `sentEmails`). `convex/organizations/invitations.test.ts`
covers accepting an invitation as a Convex Auth session, the wrong-account
reply, and inviting an address two users share. `convex/users/localDemo.test.ts`
covers anonymous `onboard` in local-demo. `lib/auth/adapters/convex.test.tsx`
covers the client route gate and sign-out, `proxy.test.ts` the server route gate
and the matcher, `lib/auth/convex-auth-server.test.ts` the server and browser
Convex URLs,
`components/blocks/auth/email-password-sign-in-form.test.tsx` the
"Forgot password?" link, `forgot-password-form.test.tsx` and
`reset-password-form.test.tsx` the two recovery pages,
`google-sign-in-button.test.tsx` the Google button shown only when configured
and its error messages,
`components/blocks/auth/email-password-sign-up-form.test.tsx` covers the
form's messages and the "Check your email" card, and
`components/blocks/auth/verify-email-screen.test.tsx` covers the landing page.

`convex-testing/context.ts` registers the three components. `vitest.config.ts`
loads `.wasm` imports as `WebAssembly.Module`, as Convex's bundler does, for the
password hashing.
