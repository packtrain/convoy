# MCP OAuth (OS-1192)

OAuth 2.1 authorization for the MCP server, so MCP clients authenticate the
Notion way:

```bash
claude mcp add --transport http convoy "https://<DEPLOYMENT>.convex.site/api/mcp?project=<ORG>/<ALIAS>"
# then /mcp in Claude Code → browser → Approve → connected
```

Header-based `sk_user_…` keys keep working unchanged (`mcp-server.md`); OAuth
is a second front door over the same auth. Built on the OS-1137 internals
(`cli-browser-login.md`): shared consent UI, shared key minting, same
TTL/janitor pattern — PKCE's `code_verifier`/`code_challenge` is the same
verifier-hash idea.

## The core trick

**The issued access token IS an `sk_user_…` API key — but audience-bound.**
Tokens minted here carry `kind: "mcp-oauth"` (`apiKeys.kind`): `/api/mcp`
accepts them like any key, while the agent-bridge HTTP endpoints
(`withAgentAuth`) reject them with 403 — the consent screen grants API/data
access, not agent-bridge control. A daily cron deletes
expired ones (permissions-system.md#api-key-lifecycle).

`/api/mcp` validates the bearer up front: missing, malformed, **invalid, or
expired** keys all return HTTP 401 carrying

```
WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"
```

which is what triggers a client's OAuth discovery (RFC 9728) and — for
expired tokens — re-authentication. All `/api/mcp` responses also carry
`Access-Control-Allow-Origin: *` and expose `WWW-Authenticate`, so browser
MCP clients can actually read them.

No refresh tokens: the minted key gets a **30-day** expiry (named
`MCP (<client name>)`). On expiry the client 401s and re-runs the flow —
one browser click.

## Endpoints

On the Convex origin (`*.convex.site`, `convex/oauth/httpHandlers.ts`; all
CORS-permissive because browser-based MCP clients preflight):

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource[/api/mcp]` | RFC 9728: points at the authorization server (same origin) |
| `GET /.well-known/oauth-authorization-server[/api/mcp]` | RFC 8414 metadata: authorize on the **app** origin, token/register here; `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]` |
| `POST /oauth/register` | RFC 7591 dynamic client registration; public clients, no secret. 201 → `{client_id, …}`. Idempotent for identical registrations (same name + URI set reuses the client) |
| `POST /oauth/token` | authorization_code + PKCE exchange (form-encoded or JSON) → `{access_token, token_type: "Bearer", expires_in}`; RFC 6749 error JSON otherwise. Responses are `Cache-Control: no-store`. If the client sends `resource` (RFC 8707) it must equal `<origin>/api/mcp`, else `invalid_target` |

On the app origin (signed-in Next.js, Clerk or Convex Auth):

- `GET /oauth/authorize?client_id&redirect_uri&state&code_challenge&code_challenge_method=S256`
  — consent page (`app/oauth/authorize/page.tsx`), rendering the shared
  `ApprovalRequestCard`. Approve calls `api.oauth.core.approve` → one-time
  code → `window.location.assign(redirect_uri?code=…&state=…)`. Deny
  redirects with `error=access_denied` — but only to a registered URI (open
  redirects are refused). Cross-origin authorize/token endpoints are legal
  per RFC 8414 (Notion does the same).

## Data model

- `oauthClients` — `clientId` (256-bit hex), `clientName?`, `redirectUris[]`,
  `lastApprovedAt?`. Registration is unauthenticated, so clients that never
  receive an approval are janitor-deleted after 14 days (kept under Node's
  ~24.8-day setTimeout cap so convex-test timers behave); identical
  re-registrations are deduplicated.
- `oauthAuthRequests` — `code` (256-bit hex, single-use), `clientId`,
  `redirectUri`, `codeChallenge` (S256), `approvedByUserId`, `expiresAt`
  (10 min). Janitor deletes at TTL + grace, like `cliLoginRequests`.

**The access token is never stored** — minted inside the PKCE-gated `token`
mutation, row deleted in the same transaction (single-use structurally).

## Redirect URI rules

`apps/web/lib/oauth/redirect-uris.ts`, shared by backend (authoritative) and
the consent page (early validation + safe deny):

- Registrable: `https:` URIs, or `http:` on a loopback host
  (`localhost`, `127.0.0.1`, `[::1]`); max 2000 chars; fragments and
  embedded credentials are rejected (RFC 6749 §3.1.2).
- Matching: exact, except loopback URIs match on every component (host,
  path, query) with only the port ignored (RFC 8252 §7.3 — CLI clients bind
  a random port per run).

## Validation & failure cases

- `register`: 1–10 redirect URIs, each registrable; name capped at 100 chars.
- `approve` (signed-in): `response_type=code` required, known client,
  registered redirect URI, valid S256 challenge (43 base64url chars),
  state ≤ 2000 chars. Approving stamps `lastApprovedAt` on the client.
- Authorize page: protocol errors for a valid client + registered redirect
  URI (bad `response_type`, bad PKCE) are redirected to the callback as
  `error=unsupported_response_type` / `error=invalid_request` with `state`
  preserved (RFC 6749); only unverifiable requests render a local error.
- `token`: malformed `code_verifier` → `invalid_request`; unknown/used code,
  expired code, client/redirect mismatch, PKCE failure → `invalid_grant`
  (uniform, nothing leaks); non-`authorization_code` grant →
  `unsupported_grant_type`; key-limit reached at mint → `invalid_grant` with
  the ConvexError message.

## Out of scope

- Refresh tokens / rotation (expiry + one-click re-auth covers it).
- Scoped consent (org/project picking at approve time) — minted keys are
  unscoped like manual defaults; `?project=` on the MCP URL keeps doing
  project scoping.
- Confidential clients / client secrets — MCP clients are public + PKCE.
- Codex: still header-based (`mcp-server.md` config); revisit when Codex
  supports OAuth MCP.

## Tests

`convex/oauth/core.test.ts`: register validation, full
register→approve→token happy path (key owner/name/hash, single-use), loopback
port flexibility, unregistered redirect at approve, PKCE failure, redirect
mismatch at token, expired code, malformed verifier, consent-page query.

## Cross-links

- `mcp-server.md` — MCP endpoint, tools, header auth.
- `cli-browser-login.md` — the sibling flow for the Convoy CLI itself.
