# CLI Browser Login (OS-1137)

`convoy login` (and the interactive default of `convoy setup`) replaces
manual API-key pasting with a browser-approve flow: the CLI prints an approve
link **and** a short backup code, the signed-in web app shows an Approve
button, and on approval the CLI receives a freshly minted API key and stores
it in the profile. Manual paste remains the non-interactive/CI fallback (see
`cli-setup-non-interactive.md`).

Related: `mcp-oauth.md` mounts an OAuth 2.1 facade on the same internals for
MCP clients (shared approve/deny UI, shared key minting, same TTL/janitor
pattern).

## UX

```
$ convoy login

Opening browser to authorize this device (host: devcontainer-web)

  1. Open:  https://app.convoy.build/cli-login?challenge=deaed942-…
     (opened automatically if a browser is available)

  2. Or go to https://app.convoy.build/device and enter code:

         WDJB-MJHT

Waiting for approval...
✓ Logged in as user@example.com
```

- **Link path** (host has a browser): click, land on the pre-filled approve
  page, click Approve.
- **Code path** (devcontainer / headless / browser on another machine): open
  `/device` anywhere you're signed in, type the code, Approve. `/device`
  redirects to the same `/cli-login?challenge=…` approve page.
- The CLI never hard-fails when no browser opens; it always prints the link +
  code and polls. After login it continues with the standard setup steps
  (project select → profile save → connect).

## Flow

```
CLI                          Backend (Convex HTTP)              Web app (signed-in)
 │ gen verifier (32 random bytes, hex)
 │ POST /api/cli/login/start {verifierHash, hostname} ──▶ create cliLoginRequests row
 │ ◀── {challengeId, userCode, loginUrl, deviceUrl, expiresAt}
 │ print link + code; open loginUrl if possible ────────────────▶ /cli-login?challenge=… (link)
 │                                                       OR /device → type code (redirects there)
 │ poll /api/cli/login/poll {challengeId, verifier} every 2s     user clicks Approve/Deny
 │                                    approve: status=approved, approvedByUserId (mints nothing)
 │ ◀── {status:"approved", apiKey, email} ── poll hashes verifier, compares,
 │                                            mints key for approvedByUserId,
 │                                            deletes row, returns plaintext once
```

## Data model

`cliLoginRequests` (see `convex/schema.ts`):

| Field | Notes |
|---|---|
| `challengeId` | `crypto.randomUUID()`, carried by the approve link (public) |
| `userCode` | 8 chars, alphabet `BCDFGHJKMNPQRSTVWXZ23456789`, stored as `XXXX-XXXX` |
| `verifierHash` | SHA-256 hex of the CLI-held verifier; the plaintext verifier never reaches the server except inside `poll` |
| `status` | `pending` → `approved` \| `denied` |
| `hostname` | shown on the approve page |
| `approvedByUserId` | set at approve; poll mints the key for this user |
| `expiresAt` | createdAt + 10 min (single TTL constant everywhere) |

**The plaintext API key is never stored.** `poll` mints it inside the
verifier-gated mutation and returns it in the HTTP response only; the row is
deleted in the same transaction, so retrieval is single-use structurally.

Lifecycle: on creation a scheduled janitor (`internal.cli.login.cleanup`,
TTL + 1 min grace) deletes the row. This covers abandoned, denied, expired,
and completed paths alike. All reads additionally guard `expiresAt` — the
scheduler is a janitor, not the enforcement.

## Endpoints & functions

HTTP (Convex router, unauthenticated by design — the CLI has no key yet):

- `POST /api/cli/login/start` `{verifierHash, hostname?}` →
  `{challengeId, userCode, loginUrl, deviceUrl, expiresAt}`.
  Rejects malformed `verifierHash` (must be 64 hex chars) with 400.
- `POST /api/cli/login/poll` `{challengeId, verifier}` → 200 with
  `{status: "pending" | "denied" | "expired" | "not_found"}` or
  `{status: "approved", apiKey, email}`. A verifier mismatch always reads as
  `not_found` (no state leaks). Mint failures (e.g. active-key limit) → 400
  `{error}`.

Convex functions (`convex/cli/login.ts`):

- `getByChallenge` (query, signed-in) — approve page data; returns `null`
  when missing/expired.
- `lookupByUserCode` (mutation, signed-in) — /device lookup. A mutation so
  failed lookups can be recorded (see Throttling).
- `approve` / `deny` (mutations, signed-in) — require `pending` and
  unexpired; approve records `approvedByUserId`. **Approve mints nothing.**

## Web pages

- `/cli-login?challenge=…` — approve page (link path). Sign-in protected by
  default via `proxy.ts`; signing in preserves the query string.
- `/device` — code entry; on match redirects to `/cli-login?challenge=…`.
  Segmented OTP-style input (4+4 slots, shadcn `input-otp`): uppercases,
  rejects invalid characters, strips dashes/spaces on paste, and submits
  automatically when all 8 characters are entered.
- Both render `components/blocks/auth/approval-request-card.tsx`, shared with
  the OAuth authorize page (`mcp-oauth.md`), and show which account will
  approve (`signed-in-as-note.tsx`: "Approving as <name>", email on hover,
  with an inline "Wrong account? Sign out to switch." link that signs out and
  returns to the same URL so the challenge survives re-login).
- The API Keys settings section links here via an "Authorize device via
  code" button next to "Create key".

## CLI

- `convoy login` — browser flow, then the standard setup continuation
  (thin alias for `runSetup` with browser auth forced).
- `convoy setup` (interactive) — asks "How do you want to authenticate?"
  with **Log in with browser (recommended)** and **Paste an API key**.
  `--api-key` (and the fully non-interactive path) bypasses the prompt.
- Poll cadence 2s; overall timeout = server-provided `expiresAt` (10 min).
- If the start request fails (wrong/unreachable Convex URL), the wizard does
  not exit: it prints the error and re-prompts for the URL (prefilled with
  the failed value) until start succeeds.
- Browser open is best-effort (`open` / `xdg-open` / `start`), never fatal.
- Implementation: `apps/cli/src/lib/browser-login.ts`.

## Security model

- The challenge id and user code only *select* a request; neither can
  retrieve a key. Retrieval requires the verifier, held only by the
  initiating CLI process; the server stores only its hash.
- Approve requires a signed-in session; the key is minted for the
  approving user (unscoped, 1-year expiry, named `CLI login (<hostname>)`,
  `kind: "cli-login"`). A re-login from the same hostname replaces the
  previous key, so repeated logins do not pile up. Expired keys are swept by
  cron (permissions-system.md#api-key-lifecycle).
- Minted-at-poll + row deletion ⇒ one successful poll max per request.
- A leaked user code lets someone approve/deny a login, never collect a key.

## Throttling (fail closed)

- `/device` lookups: per-user failure counter (`cliLoginDeviceAttempts`);
  after 10 failed lookups within a 10-min window, lookups are rejected with
  "Too many failed code attempts. Try again later." until the window rolls.
- `/start`: global cap of 500 unexpired live requests (expired rows awaiting
  their janitor don't count). When reached, start returns
  "Too many pending login requests. Try again in a few minutes."
  (`ponytail:` global cap — move to per-IP buckets only if login-flow DoS
  ever matters; the janitor keeps the live set tiny in normal operation.)
- `/poll` has no security throttle: the verifier is a 256-bit secret and the
  row disappears after one success.

## Error catalog

See `convex/cli/errors.ts` (`LOGIN_*`, `DEVICE_LOOKUP_LOCKED`). Tests assert
on these strings (`convex/cli/login.test.ts`).
