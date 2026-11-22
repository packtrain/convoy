# Verifying UI visually

Agents may visually verify protected UI through the local agent browser login
endpoint when it is configured. It signs in a dedicated preview user.

**Do not use a real human browser session, and do not copy raw Clerk cookies.**

## With the environment browser

Open a named session with the configuration from AGENTS.md, then navigate with
`playwright-cli -s=ui goto <url>`:

```text
https://app.convoy.localhost/api/agent/browser-login?secret=$CONVOY_AGENT_BROWSER_AUTH_SECRET&redirect_url=/
```

In Convex Auth mode (`NEXT_PUBLIC_AUTH_MODE=convex`) this is the only way: the
endpoint sets the session cookies on its redirect, so they must land in the
agent's browser. It answers 405 to POST. It also needs
`CONVOY_AGENT_BROWSER_USER_PASSWORD`, which worktree setup writes.

## With shell access (Clerk mode, preferred)

POST keeps the secret out of the URL:

```bash
set -a; source apps/web/.env.local; set +a
curl -sS -X POST "https://app.convoy.localhost/api/agent/browser-login" \
  -H "content-type: application/json" \
  -H "x-convoy-agent-browser-secret: $CONVOY_AGENT_BROWSER_AUTH_SECRET" \
  --data '{"redirectUrl":"/"}'
```

Open the returned `url` with `playwright-cli -s=ui goto <url>`.
Keep the same session for subsequent checks, then close it with
`playwright-cli -s=ui close`.

## When it is unavailable

If the endpoint is not configured, or the app is not already running, ask the
user to verify UI changes visually. Do not start the app in the primary checkout
to work around this — see [worktrees.md](worktrees.md).

In a linked worktree, the same login flow works against
`https://<branch-slug>.app.convoy.localhost`.

Spec: [`docs/specs/cli-browser-login.md`](../specs/cli-browser-login.md).
