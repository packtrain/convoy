/**
 * Raw Claude Agent SDK chunk fixtures for every system subtype OS-1598 lists as unmapped,
 * plus the two reachable only under a non-`system` top-level type. Shapes are copied
 * field-for-field from `@anthropic-ai/claude-agent-sdk` 0.2.112 `sdk.d.ts` (and for
 * `post_turn_summary`, the zod schema in the bundled `cli.js`, its only declaration).
 *
 * These feed the real normalizer, so the playground's "today" column is actual current
 * output, not a mock-up.
 */
import type { RawCliChunk } from "@/convex/cli/lib/runtimes/contracts";

export type SubtypeFixture = {
  /** Stable key for React and for the proposal lookup. */
  id: string;
  /** SDK subtype (or top-level type for the two non-`system` messages). */
  subtype: string;
  /** SDK type name backing the payload. */
  sdkType: string;
  /** Short statement of what the event actually means in the SDK. */
  meaning: string;
  /** How often it fires, and what gates it — drives the noise judgement. */
  cadence: string;
  /** Present tense note when the event cannot reach us as shipped today. */
  reachability?: string;
  /** One or more chunks; multi-chunk fixtures show a start/end bracket. */
  chunks: RawCliChunk[];
};

const SESSION_ID = "4f8a1c2e-9b7d-4a3f-8e21-6c5d0b1a9f34";

function systemChunk(payload: Record<string, unknown>): RawCliChunk {
  return {
    type: "system",
    data: JSON.stringify({
      type: "system",
      uuid: "b1e2c3d4-5f60-4718-9a2b-3c4d5e6f7081",
      session_id: SESSION_ID,
      ...payload,
    }),
  };
}

export const SUBTYPE_FIXTURES: SubtypeFixture[] = [
  {
    id: "notification",
    subtype: "notification",
    sdkType: "SDKNotificationMessage",
    meaning:
      "Loop-side text notification mirroring the interactive REPL notification queue. The text is already written for a human — it is the only unmapped subtype whose payload is a finished user-facing string.",
    cadence:
      "Ad hoc, priority-ranked (low → immediate), with an optional auto-dismiss timeout_ms. The timeout is the SDK telling us it is transient.",
    chunks: [
      systemChunk({
        subtype: "notification",
        key: "tool_permission_reminder",
        text: "Claude needs your approval to run Bash. Switch to the thread to respond.",
        priority: "high",
        timeout_ms: 8000,
      }),
    ],
  },
  {
    id: "session_state_changed",
    subtype: "session_state_changed",
    sdkType: "SDKSessionStateChangedMessage",
    meaning:
      "Authoritative turn-over signal: state is idle | running | requires_action. 'idle' fires after the held-back result flushes.",
    cadence:
      "Every transition, several per run. Pure level state we already track ourselves from thread status and the result chunk.",
    reachability:
      "Only emitted when CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS is set, which apps/cli never sets — unreachable as shipped.",
    chunks: [
      systemChunk({ subtype: "session_state_changed", state: "running" }),
      systemChunk({ subtype: "session_state_changed", state: "requires_action" }),
      systemChunk({ subtype: "session_state_changed", state: "idle" }),
    ],
  },
  {
    id: "memory_recall",
    subtype: "memory_recall",
    sdkType: "SDKMemoryRecallMessage",
    meaning:
      "The memory supervisor surfaced memories into the turn. mode: 'select' returns chosen file paths (bodies lazy-loaded by the renderer); 'synthesize' returns one authored paragraph. The SDK explicitly asks renderers to show \"Recalled from memory\" inline.",
    cadence:
      "At most once per turn, and only when memory is configured and something matched. Low volume, high signal — it changes how the answer was produced.",
    chunks: [
      systemChunk({
        subtype: "memory_recall",
        mode: "select",
        memories: [
          {
            path: "/home/node/.claude/projects/-workspace/memory/os-1360-desktop-memory.md",
            scope: "personal",
          },
          {
            path: "/workspace/.claude/memory/chunk-normalization-rules.md",
            scope: "team",
          },
        ],
      }),
      systemChunk({
        subtype: "memory_recall",
        mode: "synthesize",
        memories: [
          {
            path: "<synthesis:/workspace/.claude/memory>",
            scope: "team",
            content:
              "The reviewer prefers normalized events over inline conditionals, wants specs updated in the same change, and treats transcript noise as a correctness bug rather than a polish item.",
          },
        ],
      }),
    ],
  },
  {
    id: "plugin_install",
    subtype: "plugin_install",
    sdkType: "SDKPluginInstallMessage",
    meaning:
      "Headless plugin installation progress. started/completed bracket the whole install; installed/failed carry a per-marketplace name, and failed carries error.",
    cadence:
      "A burst of 3-6 events at session start, only when plugin sync is on. Every event except a failure is superseded by the terminal completed.",
    reachability:
      "Gated on CLAUDE_CODE_SYNC_PLUGIN_INSTALL, which apps/cli never sets — unreachable as shipped.",
    chunks: [
      systemChunk({ subtype: "plugin_install", status: "started" }),
      systemChunk({ subtype: "plugin_install", status: "installed", name: "anthropic/dataviz" }),
      systemChunk({
        subtype: "plugin_install",
        status: "failed",
        name: "acme/legacy-linter",
        error: "marketplace manifest not found (404)",
      }),
      systemChunk({ subtype: "plugin_install", status: "completed" }),
    ],
  },
  {
    id: "local_command_output",
    subtype: "local_command_output",
    sdkType: "SDKLocalCommandOutputMessage",
    meaning:
      "Output from a local slash command (/cost, /voice, /context). The SDK's own guidance: \"Displayed as assistant-style text in the transcript\" — it is conversation content, not telemetry.",
    cadence:
      "Once per local slash command the user ran. Rare, deliberate, and always the direct answer to something the user just typed.",
    chunks: [
      systemChunk({
        subtype: "local_command_output",
        content:
          "Total cost:            $0.4231\nTotal duration (API):  3m 12.4s\nTotal duration (wall): 7m 51.9s\nTotal code changes:    412 lines added, 96 lines removed",
      }),
    ],
  },
  {
    id: "post_turn_summary",
    subtype: "post_turn_summary",
    sdkType: "(zod schema in cli.js — not in the public SDKMessage union)",
    meaning:
      "Background per-turn summary: title, description, recent_action, needs_action, and a status_category of blocked | completed | review_ready. summarizes_uuid points at the assistant message it summarizes.",
    cadence:
      "At most one per assistant turn. Would be the single richest status signal available — it is exactly the Watch Tower vocabulary, authored by the model.",
    reachability:
      "Marked @internal and intercepted by the SDK's own reader (enqueued to the input stream, never yielded to consumers), so it cannot reach a chunk row through query(). Mapping it is speculative until the SDK exposes it.",
    chunks: [
      systemChunk({
        subtype: "post_turn_summary",
        summarizes_uuid: "9c8b7a65-4d3e-42f1-b0a9-8e7d6c5b4a39",
        status_category: "review_ready",
        title: "Normalize unmapped Claude system subtypes",
        description:
          "Mapped eight SDK system subtypes to silent metadata, inline notices, or first-class events, and updated the integration spec to match.",
        recent_action: "Ran the Convex test suite; all 412 tests pass.",
        needs_action: "Review the notification priority threshold before merge.",
      }),
    ],
  },
  {
    id: "prompt_suggestion",
    subtype: "prompt_suggestion",
    sdkType: "SDKPromptSuggestionMessage",
    meaning:
      "Predicted next user prompt, one per turn, arriving after the result message. Piggybacks on the parent prompt cache, so it is nearly free.",
    cadence:
      "At most one per turn, suppressed on the first turn, after API errors, and in plan mode. This is composer affordance, not transcript content.",
    reachability:
      "Top-level type is 'prompt_suggestion', not 'system' — so it never reaches normalizeClaudeSystemNotice at all, and before OS-1598 it fell through to the unsupported-type branch and rendered the louder \"Unsupported CLI event\" card. It now has its own top-level branch. Still requires promptSuggestions: true, which apps/cli does not pass today.",
    chunks: [
      {
        type: "prompt_suggestion",
        data: JSON.stringify({
          type: "prompt_suggestion",
          suggestion: "Now update docs/specs/cli-sdk-integration.md to cover the new mappings.",
          uuid: "7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918",
          session_id: SESSION_ID,
        }),
      },
    ],
  },
  {
    id: "elicitation_complete",
    subtype: "elicitation_complete",
    sdkType: "SDKElicitationCompleteMessage",
    meaning:
      "An MCP server confirmed that a URL-mode elicitation finished. Carries mcp_server_name and elicitation_id — and nothing else: no outcome, no value, no error.",
    cadence:
      "Once per URL-mode MCP elicitation. The payload has no renderable content, so any card for one can only restate the id.",
    chunks: [
      systemChunk({
        subtype: "elicitation_complete",
        mcp_server_name: "contoso",
        elicitation_id: "elc_01H9Z4K7Q2",
      }),
    ],
  },
];

/**
 * A subtype the SDK has not shipped yet, used to demo the generic fallback
 * itself — the "next SDK version regresses the transcript" case in the ticket.
 */
export const FUTURE_SUBTYPE_FIXTURE: SubtypeFixture = {
  id: "future_unmapped",
  subtype: "sandbox_policy_changed",
  sdkType: "(hypothetical future SDK subtype)",
  meaning:
    "Stand-in for whatever subtype the next SDK version adds. Nothing in this repo knows the field names, so nothing can build a sentence from it.",
  cadence:
    "Unknown — that is the point. Today it renders a content-free card at whatever frequency the SDK chooses to emit it.",
  chunks: [
    systemChunk({
      subtype: "sandbox_policy_changed",
      policy: "workspace-write",
      previous_policy: "read-only",
      reason: "user_approved",
    }),
  ],
};
