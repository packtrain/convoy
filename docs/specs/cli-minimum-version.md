# CLI Minimum Supported Version (OS-1832)

The backend can refuse registration from `@useconvoy/cli` versions older than a
server-side minimum, forcing an update when a backend API change breaks older
CLIs.

## Behavior

- The minimum lives in `MIN_SUPPORTED_CLI_VERSION`
  (`apps/web/convex/lib/http/registerBody.ts`). It ships with the backend code,
  so bumping it is part of the same deploy that makes the breaking change.
- `POST /api/agent/register` checks the CLI's `appVersion` against the minimum
  (`checkMinSupportedCliVersion`, same file) before running the register
  mutation. Too old →

  ```json
  { "error": "Convoy CLI 0.49.0 is older than the minimum supported version 0.50.0. Update: npm install -g @useconvoy/cli@latest", "code": "CLI_UPDATE_REQUIRED", "minVersion": "0.50.0" }
  ```

  with HTTP status `426 Upgrade Required`.
- Comparison is numeric major/minor/patch on the first `x.y.z` in the string —
  the same semantics as the CLI's `compareVersions`
  (`apps/cli/src/agent/sdk/versioning/provider-version.ts`). A missing or
  malformed `appVersion` counts as `0.0.0`: CLIs older than 0.29.0 never sent a
  version, and they are exactly the ones a bump should reject.
- The check gates **registration only**. Heartbeats are not checked, so
  already-connected sessions keep running until they reconnect. That is
  deliberate: the bump lands with the breaking deploy, and long-lived sessions
  from before it die on their next restart, not mid-stream.

## Per-runtime minimum

A backend runtime definition may set `minAppVersion`. Registration then drops
that runtime from `availableClis` when the CLI is older, so the machine stays
connected but cannot be offered threads of that runtime. Use it when an older
CLI would run the runtime unsafely, not merely with fewer features.
Antigravity sets `0.152.0`: 0.151.0 ignores Ask to approve and skips every
permission (OS-2469).

## CLI handling

None — no version-specific code in the CLI. Registration failures other than
`SESSION_CONFLICT` already print the server's `error` message and exit fatal
(`runConnect` catch in `apps/cli/src/commands/connect/workflow.ts`), and the
message contains the update command. Under `--json` this is a `failed` event
and exit code `1` — respawn with backoff, same as a revoked API key
([cli-sidecar-contract.md](cli-sidecar-contract.md)). The supervisor's retries
keep failing until the user updates; the backoff keeps that cheap.

## Bumping the minimum

1. Set `MIN_SUPPORTED_CLI_VERSION` to the oldest CLI version that works with
   the new API, in the same change that breaks the old one.
2. Nothing else. Self-hosted deployments pick up whatever minimum their backend
   build carries.

## Deliberately not included

- No env-var override: the minimum changes exactly when the code changes, so a
  code constant is the right knob.
- No dedicated exit code for supervisors: exit `1` with backoff matches every
  other permanently-fatal registration error.
- No proactive warning band ("update soon"): the passive npm-registry banner
  already covers that ([cli-update-notice.md](cli-update-notice.md)).
