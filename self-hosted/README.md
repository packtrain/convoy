# Self-hosted Convoy (Docker Compose)

Runs the whole stack locally: self-hosted Convex backend + Convex dashboard +
the Convoy web app. By default it runs in **local demo mode** with no
external dependencies at all — no accounts, no sign-in, one demo user. For
real accounts choose **convex mode** (email and password, no outside service)
or **clerk mode** (free Clerk account; Clerk cannot be self-hosted).

## Quick start

Prerequisite: Docker (with Compose).

```bash
./start.sh
```

That's it. On the first run the script asks which auth mode to use. Choose
before the first user signs up; see [Switching auth modes](#switching-auth-modes).

- **local-demo** (default) — no accounts or sign-in. The app boots straight
  into a demo workspace owned by one synthetic demo user. Ports are bound to
  `127.0.0.1`. **There is no authentication: anyone who can reach the ports
  has full access. Never expose this mode to a network or put sensitive data
  in it.**
- **convex** — real accounts with email and password, kept in your own Convex
  backend. Each person signs up, gets a personal workspace, and sees another
  organization only after accepting an invitation. The script asks for an
  optional [Resend](https://resend.com) API key; see
  [Email verification](#email-verification).
- **clerk** — real accounts through Clerk. The script asks for your two
  Clerk API keys (Clerk dashboard → Configure → API keys) from an application
  with a JWT template named `convex` (Configure → JWT templates → New
  template → Convex).

Then it handles everything else: writes `.env`, generates the instance secret
and admin key, starts the backend and dashboard, builds the web image, deploys
Convoy's functions and schema (from inside Docker — no Node.js needed on the
host), and starts the web app. Re-running it is always safe; it skips what is
already done.

Open http://127.0.0.1:3000 (app) and http://127.0.0.1:6791 (Convex dashboard,
log in with `CONVEX_SELF_HOSTED_ADMIN_KEY` from `.env`).

Stop with `docker compose down` (add `-v` to also delete all data).

## Email verification

Convex mode confirms each new address by email unless
`AUTH_EMAIL_VERIFICATION` is `off`. The script sets it from your answer:

- With a Resend API key and an `EMAIL_FROM` on a domain verified in Resend,
  it is `required`. Sign-up emails a link, and "Forgot password?" works.
  Invitations are emailed too.
- With no key, it is `off`. Sign-up checks no mailbox, so anyone who can
  reach the app can sign up under any address, including one you invited.
  There is no password reset and no invitation email; share the invitation
  link yourself. This suits an instance that is not open to the internet.

Sign-up is open to anyone who can reach the app either way. A new account
gets an empty personal workspace and sees nothing else without an invitation.

To turn verification on later, set `RESEND_API_KEY`, `EMAIL_FROM` and
`AUTH_EMAIL_VERIFICATION=required` in `.env` and re-run `./start.sh`.
Accounts made while it was off keep signing in.

## Switching auth modes

The auth mode is baked into the web image at build time and mirrored as the
`AUTH_MODE` env var on the Convex deployment. To switch, edit `AUTH_MODE` in
`.env` (and add Clerk keys when switching to `clerk`), then re-run
`./start.sh` — it rebuilds the image and re-syncs the deployment env.

Accounts do not move between modes. After a switch:

- A person who signs up again with the same address gets a new, empty user.
- Nothing is deleted. The old users, organizations, tasks, API keys and CLI
  logins stay in the database, and switching back restores access.
- API keys and CLI logins keep working as the old user.

## Manual steps (what the script does)

```bash
cp .env.example .env            # fill INSTANCE_SECRET + AUTH_MODE (+ Clerk keys in clerk mode)

# 1. Start Convex backend + dashboard
docker compose up -d backend dashboard

# 2. Generate an admin key and put it in .env
docker compose exec backend ./generate_admin_key.sh

# 3. Deploy Convoy's functions and schema to your backend (from repo root)
cd ../apps/web
set -a; source ../../self-hosted/.env; set +a
export CONVEX_DEPLOYMENT=   # a dev .env.local's CONVEX_DEPLOYMENT conflicts otherwise
npx convex env set AUTH_MODE "$AUTH_MODE"
npx convex env set NEXT_PUBLIC_APP_URL "$APP_URL"   # for links the backend builds
# local-demo and convex modes (a placeholder; no Clerk token ever arrives):
npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://$AUTH_MODE.invalid"
# clerk mode instead:
# npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://<your-clerk-domain>"
# convex mode, either no email:
# npx convex env set AUTH_EMAIL_VERIFICATION off
# or email through Resend:
# npx convex env set AUTH_EMAIL_VERIFICATION required
# npx convex env set RESEND_API_KEY "$RESEND_API_KEY"
# npx convex env set EMAIL_FROM "$EMAIL_FROM"
# Required on every install; `none` turns Google sign-in off (see below):
npx convex env set AUTH_GOOGLE_CLIENT_ID none
npx convex env set AUTH_GOOGLE_CLIENT_SECRET none
npx convex deploy

# 4. Build and start the web app
cd ../../self-hosted
docker compose up -d --build web
```

## GitHub integration

To let projects browse pull requests, register a GitHub App and set its six
`GITHUB_APP_*` variables on the backend with `npx convex env set`, as in
step 3 above. GitHub must reach the backend's HTTP actions URL for webhooks,
so this needs a clerk or convex install on a reachable host; local-demo
mode shows GitHub as unavailable. Steps:
[GitHub integration](https://docs.convoy.build/docs/deployment/github-integration).

## Google sign-in

Convex Auth mode can show "Continue with Google" on the sign-in and sign-up
pages. Create a "Web application" OAuth client in the
[Google Cloud console](https://console.cloud.google.com/apis/credentials),
register `<CONVEX_SITE_ORIGIN>/auth/google/callback` as its redirect URI, and
put the client ID and secret in `.env` as `AUTH_GOOGLE_CLIENT_ID` and
`AUTH_GOOGLE_CLIENT_SECRET`. Re-run `./start.sh`. Convex refuses to deploy
without the two variables, so an install without Google keeps both at `none`,
which hides the button.

## Cost estimation

Missing runtime costs are estimated automatically when the model has catalog
pricing and all required token counts are available. The UI labels these as
API-equivalent estimates. Unknown models or incomplete counts remain unpriced.
No environment setting is required. Existing unpriced or legacy rows are not
recalculated.

## Notes

- `NEXT_PUBLIC_*` values (including the auth mode) are baked into the web
  bundle at build time — rerun `docker compose up -d --build web` after
  changing `.env`.
- Published ports bind to `127.0.0.1` by default (`BIND_HOST` in `.env`).
  Only set `BIND_HOST=0.0.0.0` for clerk or convex installs that must be
  reachable on a network — never for local-demo mode, and for convex mode
  only with email verification on if the network is the internet.
- Optional backend flags (`DATABASE_URL`, `DO_NOT_REQUIRE_SSL`,
  `REDACT_LOGS_TO_CLIENT`) are commented out in `docker-compose.yml`; the
  backend rejects empty values, so uncomment them only together with a value
  in `.env`.
- Attachments are capped at 50 MB per file by the backend
  (`MAX_ATTACHMENT_SIZE` in `apps/web/convex/lib/constants.ts`). The former
  `NEXT_PUBLIC_MAX_ATTACHMENT_SIZE_MB` setting is ignored.

Full walkthrough, environment matrix, serving beyond localhost, and the
managed-vs-self-hosted feature comparison:
`apps/docs/content/docs/deployment/self-hosting-convex.mdx`
(published at `/docs/deployment/self-hosting-convex`).
