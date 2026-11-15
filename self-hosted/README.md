# Self-hosted Convoy (Docker Compose)

Runs the whole stack locally: self-hosted Convex backend + Convex dashboard +
the Convoy web app. By default it runs in **local demo mode** with no
external dependencies at all — no accounts, no sign-in, one demo user. For
real multi-user auth, opt into **Clerk mode** (free Clerk account; Clerk
cannot be self-hosted).

## Quick start

Prerequisite: Docker (with Compose).

```bash
./start.sh
```

That's it. On the first run the script asks which auth mode to use:

- **local-demo** (default) — no accounts or sign-in. The app boots straight
  into a demo workspace owned by one synthetic demo user. Ports are bound to
  `127.0.0.1`. **There is no authentication: anyone who can reach the ports
  has full access. Never expose this mode to a network or put sensitive data
  in it.**
- **clerk** — real multi-user authentication. The script asks for your two
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

## Switching auth modes

The auth mode is baked into the web image at build time and mirrored as the
`AUTH_MODE` env var on the Convex deployment. To switch, edit `AUTH_MODE` in
`.env` (and add Clerk keys when switching to `clerk`), then re-run
`./start.sh` — it rebuilds the image and re-syncs the deployment env.

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
# local-demo mode (the placeholder issuer satisfies auth.config.ts; it is never used):
npx convex env set AUTH_MODE local-demo
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://local-demo.invalid
# clerk mode instead:
# npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://<your-clerk-domain>"
npx convex deploy

# 4. Build and start the web app
cd ../../self-hosted
docker compose up -d --build web
```

## GitHub integration

To let projects browse pull requests, register a GitHub App and set its six
`GITHUB_APP_*` variables on the backend with `npx convex env set`, as in
step 3 above. GitHub must reach the backend's HTTP actions URL for webhooks,
so this needs a Clerk-authenticated install on a reachable host; local-demo
mode shows GitHub as unavailable. Steps:
[GitHub integration](https://docs.convoy.build/docs/deployment/github-integration).

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
  Only set `BIND_HOST=0.0.0.0` for Clerk-authenticated installs that must be
  reachable on a network — never for local-demo mode.
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
