# CLI Agent SDK

A playground CLI for testing subprocess-based agent execution (Claude, Codex, generic commands).

## Usage

### From repo root

```bash
pnpm cli-agent-sdk:dev
pnpm cli-agent-sdk:build
```

### From this folder

```bash
# Interactive mode
npx tsx bin/cli-agent-sdk.ts

# One prompt then exit
npx tsx bin/cli-agent-sdk.ts --once

# Single prompt (non-interactive)
npx tsx bin/cli-agent-sdk.ts -p "List TypeScript files"

# Claude CLI subprocess (stream-json)
npx tsx bin/cli-agent-sdk.ts --agent claude-cli-json -p "List TypeScript files"

# Claude Agent SDK PoC (no `claude -p`)
npx tsx bin/cli-agent-sdk.ts --agent claude-agent-sdk -p "List TypeScript files"

# Codex CLI subprocess
npx tsx bin/cli-agent-sdk.ts --agent codex-cli-json -p "List TypeScript files"

# Generic subprocess adapter
npx tsx bin/cli-agent-sdk.ts --agent generic-cli -p "Hello"

# Mock subprocess providers
npx tsx bin/cli-agent-sdk.ts --agent mock-cli-json -p "Hello"
npx tsx bin/cli-agent-sdk.ts --agent mock-cli-line -p "Hello"

# Print raw transport payloads
npx tsx bin/cli-agent-sdk.ts --agent claude-cli-json --raw-json -p "Hello"
```

### From this folder (pnpm)

```bash
pnpm -C playground/cli-agent-sdk dev --once --agent claude-cli-json -p "Hello"
```

## Options

| Option | Description | Default |
|---|---|---|
| `--agent <agent>` | `claude-agent-sdk`, `claude-cli-json`, `codex-cli-json`, `generic-cli`, `mock-cli-json`, `mock-cli-line` | `claude-cli-json` |
| `-p, --prompt <text>` | Run single prompt (non-interactive) | - |
| `--once` | Ask for a single prompt then exit | `false` |
| `--cwd <path>` | Working directory for the agent | Current directory |
| `--raw-json` | Print raw provider payloads | `false` |
| `--permission-mode <mode>` | Claude SDK permission mode | `bypassPermissions` |
| `--model <model>` | Claude SDK model override | - |
| `--claude-executable <path>` | Claude Code executable path for the SDK | SDK default |

## Claude behavior

`claude-cli-json` runs use the real CLI with:

```bash
claude -p "<prompt>" \
  --dangerously-skip-permissions \
  --verbose \
  --output-format stream-json
```

Follow-up turns add:

```bash
--resume <previous-session-id> --fork-session
```

If a Claude run completes without returning `session_id`/`sessionId` in stream-json output, the run is treated as failed.

`claude-agent-sdk` uses `@anthropic-ai/claude-agent-sdk` directly with the
Claude Code preset system prompt/tools. It defaults to:

- `permissionMode: "bypassPermissions"`
- `allowDangerouslySkipPermissions: true`
- `settingSources: ["user", "project", "local"]`
- `includePartialMessages: true`

Follow-up turns use SDK `resume` with `forkSession: true`. Raw SDK messages can
be printed with `--raw-json`, which is the shape production should persist to
Convex before the existing Claude runtime normalizer renders it in the frontend.

## SDK behavior (`src/sdk`)

The SDK is transport-first:

- process lifecycle management
- per-run isolation (`HOME`, `XDG_*`)
- timeout policies (startup, idle, max run)
- process-group termination and escalation
- transport envelopes (`process_started`, `stdout`, `stderr`, `spawn_error`, `exit`, `cancelled`, `timeout`)
- raw frame callback for persistence/replay

No semantic normalization is done in the playground CLI layer.

## Testing

```bash
pnpm -C playground/cli-agent-sdk test
pnpm -C playground/cli-agent-sdk test:watch
pnpm -C playground/cli-agent-sdk typecheck
```

## References

- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference)
