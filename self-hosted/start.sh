#!/usr/bin/env bash
# One-command self-hosted Convoy: Convex backend + dashboard + web app.
# Only prerequisite: Docker (with Compose). convex mode needs no other
# accounts; clerk mode needs a free Clerk application.
# Safe to re-run — every step is idempotent.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/get-docker/"; exit 1; }

# --- .env bootstrap -------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
fi

env_get() { sed -n "s/^$1=//p" .env | head -1; }
# Values may contain any character (the admin key has "|"), so replace by
# filtering the old line out and appending instead of sed substitution.
env_set() {
  grep -v "^$1=" .env > .env.tmp || true
  printf '%s=%s\n' "$1" "$2" >> .env.tmp
  mv .env.tmp .env
}

if [ -z "$(env_get INSTANCE_SECRET)" ]; then
  env_set INSTANCE_SECRET "$(openssl rand -hex 32)"
fi

# --- Auth mode --------------------------------------------------------------
AUTH_MODE="$(env_get AUTH_MODE)"
# The demo mode is gone (docs/specs/auth-adapters.md#former-demo-installs).
CLAIM_EMAIL=""
if [ "$AUTH_MODE" = "local-demo" ]; then
  say "Local demo mode has been removed. Switching this install to convex mode."
  AUTH_MODE=convex
  env_set AUTH_MODE "$AUTH_MODE"
  # Cleared once the claim succeeds or is skipped, so a run that fails first asks again.
  env_set DEMO_CLAIM_PENDING 1
fi
if [ -n "$(env_get DEMO_CLAIM_PENDING)" ]; then
  echo "Give the demo user an email and password: that account keeps its"
  echo "organizations, tasks, API keys and CLI logins. Leave the email empty to"
  echo "skip; self-hosted/README.md shows how to do it later."
  read -r -p "Email: " CLAIM_EMAIL
  if [ -n "$CLAIM_EMAIL" ]; then
    read -r -s -p "Password (at least 8 characters): " CLAIM_PASSWORD; echo
  else
    env_set DEMO_CLAIM_PENDING ""
  fi
fi
if [ -z "$AUTH_MODE" ]; then
  say "Choose an authentication mode:"
  echo "  convex — accounts with email and password, no outside service."
  echo "  clerk  — accounts through https://clerk.com (free tier is fine)."
  echo
  echo "Choose before the first user signs up: accounts do not move to another mode."
  while :; do
    read -r -p "Auth mode [convex/clerk] (convex): " AUTH_MODE
    case "${AUTH_MODE:=convex}" in
      convex | clerk) break ;;
      *) echo "Type convex or clerk." ;;
    esac
  done
  env_set AUTH_MODE "$AUTH_MODE"
fi
case "$AUTH_MODE" in
  convex | clerk) ;;
  *) echo "AUTH_MODE in .env must be convex or clerk, not \"$AUTH_MODE\"."; exit 1 ;;
esac

if [ "$AUTH_MODE" = "convex" ] && [ -z "$(env_get AUTH_EMAIL_VERIFICATION)" ]; then
  say "Convex Auth can email a link that confirms each new address (needs https://resend.com)."
  echo "Leave the key empty to skip email: sign-up then checks no mailbox, so keep"
  echo "the instance off the public internet."
  echo
  read -r -p "RESEND_API_KEY (re_..., empty for none): " RESEND_KEY
  if [ -n "$RESEND_KEY" ]; then
    read -r -p "EMAIL_FROM, on a domain verified in Resend (Convoy <noreply@example.com>): " FROM
    [ -n "$FROM" ] || { echo "EMAIL_FROM is required with a Resend key."; exit 1; }
    env_set RESEND_API_KEY "$RESEND_KEY"
    env_set EMAIL_FROM "$FROM"
    env_set AUTH_EMAIL_VERIFICATION required
  else
    env_set AUTH_EMAIL_VERIFICATION off
  fi
fi

ISSUER=""
if [ "$AUTH_MODE" = "clerk" ]; then
  if [ -z "$(env_get NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)" ] || [ -z "$(env_get CLERK_SECRET_KEY)" ]; then
    say "Convoy uses Clerk for authentication (free tier is fine)."
    echo "1. Create an application at https://dashboard.clerk.com"
    echo "2. In the app: Configure -> JWT templates -> New template -> Convex (name must stay \"convex\")"
    echo "3. Copy both API keys from Configure -> API keys"
    echo
    read -r -p "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (pk_...): " PK
    read -r -p "CLERK_SECRET_KEY (sk_...): " SK
    [ -n "$PK" ] && [ -n "$SK" ] || { echo "Both keys are required."; exit 1; }
    env_set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "$PK"
    env_set CLERK_SECRET_KEY "$SK"
  fi

  # Clerk's publishable key encodes the frontend API domain in base64.
  derive_issuer() {
    local body pad
    body=$(printf %s "$1" | sed -E 's/^pk_(test|live)_//')
    pad=$(( (4 - ${#body} % 4) % 4 ))
    while [ "$pad" -gt 0 ]; do body="$body="; pad=$((pad - 1)); done
    printf %s "$body" | base64 -d 2>/dev/null | tr -d '$' || true
  }

  ISSUER="$(env_get CLERK_JWT_ISSUER_DOMAIN)"
  if [ -z "$ISSUER" ]; then
    DOMAIN="$(derive_issuer "$(env_get NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)")"
    if [ -n "$DOMAIN" ]; then
      ISSUER="https://$DOMAIN"
    else
      read -r -p "Clerk JWT issuer domain (https://...clerk.accounts.dev): " ISSUER
    fi
    env_set CLERK_JWT_ISSUER_DOMAIN "$ISSUER"
  fi
fi

# Runs auth:claimDemoUser in the web image; values travel as env vars to avoid quoting.
claim_demo_user() {
  docker compose run --rm --no-deps \
    -e CONVEX_SELF_HOSTED_URL=http://backend:3210 \
    -e CONVEX_SELF_HOSTED_ADMIN_KEY="$(env_get CONVEX_SELF_HOSTED_ADMIN_KEY)" \
    -e CLAIM_EMAIL="$1" -e CLAIM_PASSWORD="$2" \
    -w /app/apps/web web sh -c 'npx convex run auth:claimDemoUser \
      "$(node -e "console.log(JSON.stringify({ email: process.env.CLAIM_EMAIL, password: process.env.CLAIM_PASSWORD }))")"'
}

# --- Convex backend + dashboard -------------------------------------------
say "Starting Convex backend and dashboard..."
docker compose up -d backend dashboard

if [ -z "$(env_get CONVEX_SELF_HOSTED_ADMIN_KEY)" ]; then
  ADMIN_KEY="$(docker compose exec backend ./generate_admin_key.sh | tail -1 | tr -d '[:space:]')"
  env_set CONVEX_SELF_HOSTED_ADMIN_KEY "$ADMIN_KEY"
fi
ADMIN_KEY="$(env_get CONVEX_SELF_HOSTED_ADMIN_KEY)"

# --- Build web image, deploy functions from inside it ---------------------
say "Building the web app image (first run takes a few minutes)..."
docker compose build web

say "Deploying Convoy functions and schema to your backend, then starting data migrations..."
# Convex mode sets a placeholder issuer: auth.config.ts always lists Clerk,
# and no Clerk JWT ever arrives. NEXT_PUBLIC_APP_URL comes from the image.
# Values travel as env vars to avoid quoting. Convex rejects empty values, so a
# cleared optional one is removed from the deployment instead.
[ "$AUTH_MODE" = "clerk" ] || ISSUER="https://convex.invalid"
docker compose run --rm --no-deps \
  -e CONVEX_SELF_HOSTED_URL=http://backend:3210 \
  -e CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" \
  -e AUTH_MODE="$AUTH_MODE" \
  -e CLERK_JWT_ISSUER_DOMAIN="$ISSUER" \
  -e AUTH_GOOGLE_CLIENT_ID="$(env_get AUTH_GOOGLE_CLIENT_ID)" \
  -e AUTH_GOOGLE_CLIENT_SECRET="$(env_get AUTH_GOOGLE_CLIENT_SECRET)" \
  -e AUTH_EMAIL_VERIFICATION="$(env_get AUTH_EMAIL_VERIFICATION)" \
  -e RESEND_API_KEY="$(env_get RESEND_API_KEY)" \
  -e EMAIL_FROM="$(env_get EMAIL_FROM)" \
  web sh -c 'cd apps/web && for k in AUTH_MODE CLERK_JWT_ISSUER_DOMAIN NEXT_PUBLIC_APP_URL \
      AUTH_GOOGLE_CLIENT_ID AUTH_GOOGLE_CLIENT_SECRET AUTH_EMAIL_VERIFICATION RESEND_API_KEY EMAIL_FROM; do
    v="$(printenv "$k")"
    if [ -n "$v" ]; then npx convex env set "$k" "$v"; else npx convex env remove "$k"; fi || exit 1
  done && node scripts/convexDeploy.mjs -y'

if [ -n "$CLAIM_EMAIL" ]; then
  say "Giving the demo user its account..."
  claim_demo_user "$CLAIM_EMAIL" "$CLAIM_PASSWORD" && env_set DEMO_CLAIM_PENDING "" ||
    echo "The claim failed. Fix the cause above, then see \"Installs from the removed local demo mode\" in self-hosted/README.md."
fi

say "Starting the web app..."
docker compose up -d web

APP_URL="$(env_get APP_URL)"
say "Convoy is running."
echo "  App:              ${APP_URL:-http://127.0.0.1:3000}"
echo "  Convex dashboard: http://127.0.0.1:6791 (log in with CONVEX_SELF_HOSTED_ADMIN_KEY from self-hosted/.env)"
if [ -n "$(env_get AUTH_GOOGLE_CLIENT_ID)" ] && [ "$(env_get AUTH_GOOGLE_CLIENT_ID)" != "none" ]; then
  echo "  Google redirect:  $(env_get CONVEX_SITE_ORIGIN)/auth/google/callback (register it on the OAuth client)"
fi
if [ "$AUTH_MODE" = "convex" ] && [ "$(env_get AUTH_EMAIL_VERIFICATION)" = "off" ]; then
  echo
  echo "  NOTE: email verification is off. Anyone who can reach the app can sign"
  echo "  up under any address, so keep it off the public internet."
fi
echo
echo "To stop: docker compose down (add -v to also delete all data)"
