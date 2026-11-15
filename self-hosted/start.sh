#!/usr/bin/env bash
# One-command self-hosted Convoy: Convex backend + dashboard + web app.
# Only prerequisite: Docker (with Compose). The default local-demo mode
# needs no other accounts; opt into Clerk mode for real multi-user auth
# (free Clerk application with a JWT template named "convex").
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
if [ -z "$AUTH_MODE" ]; then
  say "Choose an authentication mode:"
  echo "  local-demo — no accounts or sign-in; one demo user. Great for trying Convoy."
  echo "  clerk      — real multi-user authentication via https://clerk.com (free tier is fine)."
  echo
  read -r -p "Run in local demo mode without accounts? [Y/n]: " DEMO_ANSWER
  case "${DEMO_ANSWER:-Y}" in
    [Nn]*) AUTH_MODE=clerk ;;
    *) AUTH_MODE=local-demo ;;
  esac
  env_set AUTH_MODE "$AUTH_MODE"
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

say "Deploying Convoy functions and schema to your backend..."
if [ "$AUTH_MODE" = "local-demo" ]; then
  # The placeholder issuer keeps auth.config.ts satisfied; it is never used
  # because local-demo issues no JWTs.
  DEPLOY_ENV_CMD="npx convex env set AUTH_MODE local-demo && npx convex env set CLERK_JWT_ISSUER_DOMAIN https://local-demo.invalid"
else
  DEPLOY_ENV_CMD="npx convex env set CLERK_JWT_ISSUER_DOMAIN '$ISSUER'"
fi
docker compose run --rm --no-deps \
  -e CONVEX_SELF_HOSTED_URL=http://backend:3210 \
  -e CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY" \
  web sh -c "cd apps/web && $DEPLOY_ENV_CMD && npx convex deploy -y"

say "Starting the web app..."
docker compose up -d web

APP_URL="$(env_get APP_URL)"
say "Convoy is running."
echo "  App:              ${APP_URL:-http://127.0.0.1:3000}"
echo "  Convex dashboard: http://127.0.0.1:6791 (log in with CONVEX_SELF_HOSTED_ADMIN_KEY from self-hosted/.env)"
if [ "$AUTH_MODE" = "local-demo" ]; then
  echo
  echo "  NOTE: local demo mode has NO authentication — anyone who can reach"
  echo "  these ports has full access. Ports are bound to 127.0.0.1 by default;"
  echo "  do not expose them to a network or use this mode for sensitive data."
fi
echo
echo "To stop: docker compose down (add -v to also delete all data)"
