# Google sign-in setup

How to turn on "Continue with Google" for a Convex Auth deployment, and how
to test it on a worktree preview. The behavior and the reasons behind it are
in [the spec](../specs/auth-adapters.md#google). This page is the steps.

## Without Google, set nothing

`AUTH_GOOGLE_CLIENT_ID` and `AUTH_GOOGLE_CLIENT_SECRET` are optional. With
either unset, the button is hidden. A deployment that set both to `none`
while they were required can keep them or remove them:

```bash
npx convex env remove AUTH_GOOGLE_CLIENT_ID
npx convex env remove AUTH_GOOGLE_CLIENT_SECRET
```

The package's `authGoogle` component declares them required, and Convex
refuses an optional app variable bound to a required component one.
`patches/@convex-dev__auth@2.1.0.patch` makes them optional in the component.
Upgrading `@convex-dev/auth` means re-checking that patch; `auth.test.ts`
fails if it is lost.

## Create the OAuth client

In the [Google Cloud console](https://console.cloud.google.com/), in the
project that should own the client:

1. Under Google Auth Platform, fill in Branding (app name, support email) and
   Audience. "External" lets any Google account sign in. The app asks for
   `openid email profile` only, so publishing needs no Google review.
   The "Testing" publishing status does not limit sign-in to the listed test
   users either. Google exempts apps that ask only for these basic scopes
   ([Manage App Audience](https://support.google.com/cloud/answer/15549945)).
   To keep a preview to a few people, restrict it some other way, such as an
   "Internal" audience inside a Workspace organization.
2. Under Clients, create a client of type "Web application".
3. Add one authorized redirect URI per deployment it serves:
   `<CONVEX_SITE_URL>/auth/google/callback`. That is the deployment's
   `.convex.site` URL, not the app URL and not the `.convex.cloud` URL. It
   is `NEXT_PUBLIC_CONVEX_SITE_URL` in `apps/web/.env.local`, or "HTTP
   Actions URL" in the Convex dashboard. Authorized JavaScript origins can
   stay empty. The flow is a full-page redirect, not Google's JavaScript SDK.
4. Copy the client ID and secret.

Google can take a few minutes to apply a new redirect URI. A
`redirect_uri_mismatch` right after adding one usually goes away on its own.

One client can list many redirect URIs. Use one client for dev and the
previews you test on, and a separate one for prod, so a dev change can't
break prod sign-in.

## Set the variables

On the Convex deployment, never on the web build. The secret is only read by
the component's callback.

```bash
npx convex env set AUTH_GOOGLE_CLIENT_ID 1234-abc.apps.googleusercontent.com
npx convex env set AUTH_GOOGLE_CLIENT_SECRET GOCSPX-...
```

No redeploy is needed. `auth.getSettings` reads the variables on each call,
so the button appears on the next page load.

The deployment also needs `AUTH_MODE=convex` (or the Google sign-up fails
with "Convex Auth sign-up is not enabled on this deployment") and a
`NEXT_PUBLIC_APP_URL` whose origin is the app's. `startSignInWithGoogle`
refuses to return anywhere else.

Self-hosted installs put both values in `self-hosted/.env`, and `start.sh`
sets them on the backend. See `self-hosted/README.md`.

## Test on a worktree preview

Each preview has its own `.convex.site` URL, so its redirect URI must be
added to the dev client by hand.

1. Run `pnpm worktree:setup` with `NEXT_PUBLIC_AUTH_MODE=convex` in
   `apps/web/.env.local` (see [worktrees.md](worktrees.md)).
2. Add `<NEXT_PUBLIC_CONVEX_SITE_URL>/auth/google/callback` to the dev OAuth
   client.
3. Set the dev client's credentials on the preview. In the devcontainer that
   needs the preview deploy key:

   ```bash
   cd apps/web
   CONVEX_DEPLOY_KEY=<CONVEX_PREVIEW_DEPLOY_KEY from .env.local> \
     npx convex env set --deployment <preview name> AUTH_GOOGLE_CLIENT_ID <id>
   ```

   and the same for `AUTH_GOOGLE_CLIENT_SECRET`.
4. Run `pnpm worktree:dev` and open `/auth/sign-in`.

Remove the redirect URI from the client when the worktree goes away.

### Without a Google client

A fake client ID is enough to see the button and check the redirect.
Set `AUTH_GOOGLE_CLIENT_ID=fake.apps.googleusercontent.com` and any secret.
Clicking the button leaves for Google, which answers `invalid_client`. The
authorize URL it was given carries
`redirect_uri=<site url>/auth/google/callback`.

The cancel path needs no Google either. Click the button once so the
browser saves a pending flow. Read its `state` from the
`__convexAuthProvider_oauth_flow_*` key in `localStorage`, then open:

```
<CONVEX_SITE_URL>/auth/google/callback?error=access_denied&state=<state>
```

The component redirects back to the sign-in page, which shows "Sign-in was
cancelled." Remove the variables afterwards.

## Troubleshooting

| What you see | Cause |
| --- | --- |
| No button | One of the variables is unset or `none`, or the page loaded before you set them. Reload. |
| `redirect_uri_mismatch` at Google | The client lacks this deployment's `/auth/google/callback` URI, or Google hasn't applied it yet. |
| `invalid_client` at Google | Wrong client ID, or a client deleted in the console. |
| `redirectTo origin ... is not in allowedRedirectOrigins` | `NEXT_PUBLIC_APP_URL` on the Convex deployment doesn't match the app's origin. |
| "Convex Auth sign-up is not enabled on this deployment" | `AUTH_MODE=convex` is not set on the Convex deployment. |
| Signing in with Google makes a second account | Expected when the email account's address was never proven: it signed up with `AUTH_EMAIL_VERIFICATION=off`, or before S6. Also when the email account was made after the Google one. See [Accounts](../specs/auth-adapters.md#accounts). |
