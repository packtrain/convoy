# CLI Agent SDK Raw Transport Specification

This spec defines the intended behavior for `playground/cli-agent-sdk` when
running subprocess-based CLIs and native agent SDK proofs of concept.

## Scope

- Applies only to `playground/cli-agent-sdk`.
- Does not change `apps/cli` production behavior.

## Core rule

The playground CLI SDK must manage subprocess execution and stream transport output, but must not normalize provider output into a canonical semantic schema.

The native Claude Agent SDK proof of concept follows the same raw-output rule:
it may render a human-friendly terminal view, but the provider payload available
for persistence is the original `SDKMessage` object emitted by
`@anthropic-ai/claude-agent-sdk`.

## Event contract

SDK event stream includes only transport events:

- `process_started`
- `stdout`
- `stderr`
- `spawn_error`
- `exit`
- `cancelled`
- `timeout`

Raw decoded frames remain available via `onRawFrame`.

## Claude command contract

Claude adapter must execute the real CLI with:

- `-p <prompt>`
- `--dangerously-skip-permissions`
- `--verbose`
- `--output-format stream-json`

Follow-up message processing must use:

- `--resume <previous-session-id>`
- `--fork-session`

## Claude Agent SDK PoC contract

`--agent claude-agent-sdk` uses `@anthropic-ai/claude-agent-sdk` directly rather
than invoking `claude -p`.

Default SDK options:

- `permissionMode: "bypassPermissions"`
- `allowDangerouslySkipPermissions: true`
- `settingSources: ["user", "project", "local"]`
- `systemPrompt: { type: "preset", preset: "claude_code" }`
- `tools: { type: "preset", preset: "claude_code" }`
- `includePartialMessages: true`

Follow-up message processing uses:

- `resume: <previous-session-id>`
- `forkSession: true`

The PoC installs a `canUseTool` callback so host-controlled permission requests
and `AskUserQuestion` can be observed without relying on `-p` mode behavior.
For the default `bypassPermissions` mode, regular tool requests are allowed by
the callback if the SDK still asks. `AskUserQuestion` is always routed through
the callback and returns answers in the SDK `updatedInput` shape.

## Continuation handling

- Each completed Claude response must produce a new session ID (`session_id` or `sessionId`) from stream-json output.
- That new session ID becomes the resume source for the next user message.

## Missing session ID policy

If a Claude run reports completed status but no session ID is observed in output, the run is treated as failed.

For the native SDK PoC, the current playground records the most recent observed
`session_id` and returns it to the interactive loop. Production integration must
preserve this value through the existing Convex assistant-message
`cliContext.continuationId` path.

## Out of scope

- Server-side conversion/parsing behavior.
- Production CLI (`apps/cli`) integration details.
- Provider-specific normalization; production must continue to normalize raw
  Claude payloads through the existing runtime-owned Convex/web pipeline.
