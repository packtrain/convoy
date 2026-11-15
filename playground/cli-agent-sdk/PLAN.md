# CLI Agent SDK Simplification Plan (Implemented Baseline)

## Goals

- Keep the CLI layer focused on subprocess orchestration and raw transport streaming.
- Remove semantic normalization/parsing from `playground/cli-agent-sdk`.
- Run real Claude Code CLI with print mode + stream-json output.
- Support multi-turn Claude follow-ups via `--resume <sessionId> --fork-session`.

## Current design choices

1. SDK emits transport events only (`stdout`, `stderr`, lifecycle events).
2. Raw decoded frames are available via `onRawFrame`.
3. No parser registry and no semantic schema in the SDK.
4. Claude adapter arguments:
   - `-p <prompt>`
   - `--dangerously-skip-permissions`
   - `--verbose`
   - `--output-format stream-json`
   - plus `--resume <id> --fork-session` on follow-ups
5. Claude runs that do not return `session_id`/`sessionId` are treated as failed in the playground CLI.

## Claude Agent SDK PoC update

The playground now also has `--agent claude-agent-sdk`, which uses
`@anthropic-ai/claude-agent-sdk` directly instead of `claude -p`.

Relevant production findings:

1. The SDK still spawns Claude Code internally, but it exposes a typed
   `SDKMessage` stream instead of CLI stdout lines.
2. Full-access mode must set both `permissionMode: "bypassPermissions"` and
   `allowDangerouslySkipPermissions: true`.
3. `settingSources: ["user", "project", "local"]` is needed to keep parity
   with the user's Claude configuration, plugins, hooks, MCP servers, and
   project/local settings.
4. Follow-up turns can use `resume` plus `forkSession: true`, which maps cleanly
   to the existing Convoy `cliContext.continuationId` contract.
5. `canUseTool` is the SDK-native bridge for host-controlled permission
   decisions and `AskUserQuestion`; production should route those events through
   Convex so the web frontend can ask/answer instead of using a local prompt.
6. Production should persist raw `SDKMessage` objects as Claude chunks and keep
   normalization in the existing Convex/web runtime layer.

This differs from t3code's desktop architecture: Convoy must keep the CLI as a
remote worker connected to Convex, with raw provider events streamed to the
backend and rendered by the web app. The useful t3code pattern is the SDK option
shape and `canUseTool` bridge, not its local desktop event loop.

## Remaining extension points

- Add new subprocess providers by implementing a `ProviderAdapter`.
- Build any provider-specific normalization on the server side (outside this playground SDK).
- Port the Claude Agent SDK PoC into `apps/cli` behind the existing
  `cliMessages.startRunResponse` / `appendRunContent` / `complete` lifecycle.
