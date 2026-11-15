/**
 * Handling per formerly-unmapped Claude system subtype (OS-1598), as shipped. `shape` names
 * the established options from the ticket:
 *  - "metadata"        → silent; never rendered. Optionally also ephemeral.
 *  - "runtime-notice"  → inline collapsible card with a real title/message.
 *  - "first-class"     → a new normalized event kind, or reuse of an existing one.
 *  - "none"            → deliberately not mapped.
 */
export type ProposedShape = "metadata" | "runtime-notice" | "first-class" | "none";

export type SubtypeProposal = {
  fixtureId: string;
  shape: ProposedShape;
  /** Short label for the shape chip. */
  shapeLabel: string;
  /** The proposed normalized-event code, when the shape has one. */
  code?: string;
  /** Whether the stored chunk row should also be dropped at cleanup. */
  ephemeral: boolean;
  /** Why this shape, in the terms the ticket asks for. */
  rationale: string;
  /** Open question the reviewer should settle, when one exists. */
  question?: string;
  /** Review outcome, once settled. Supersedes `question`. */
  decision?: string;
  /** Follow-up task this subtype was split out into. */
  splitInto?: string;
};

export const SUBTYPE_PROPOSALS: SubtypeProposal[] = [
  {
    fixtureId: "notification",
    shape: "runtime-notice",
    shapeLabel: "Inline notice, priority-gated",
    code: "claude-notification",
    ephemeral: false,
    rationale:
      "The payload already contains a human-written sentence, so this is the one subtype where a card costs nothing to author: title \"Claude notification\", message = text. Gate on priority — render high and immediate, drop low and medium to silent metadata — because a timeout_ms means the SDK itself treats it as transient, and a thread transcript has no auto-dismiss.",
    decision:
      "Shipped with the threshold at high: high and immediate render, low and medium go silent and stay ephemeral. A rendered notification is carved out of ephemeral cleanup so the row cannot be deleted under a card still on screen. Raising or lowering the threshold later is a one-line change (RENDERED_NOTIFICATION_PRIORITIES).",
  },
  {
    fixtureId: "session_state_changed",
    shape: "metadata",
    shapeLabel: "Silent + ephemeral",
    ephemeral: true,
    rationale:
      "A textbook level signal: the full state, re-emitted on every transition, with no outcome to report. We already derive the same thing authoritatively from thread status and the result chunk, so a card would restate what the header shows. Same reasoning as background_tasks_changed (OS-1399).",
    decision: "Shipped as silent metadata, ephemeral in storage.",
  },
  {
    fixtureId: "memory_recall",
    shape: "first-class",
    shapeLabel: "New normalized event",
    code: "memory-recall",
    ephemeral: false,
    rationale:
      "The only one of the eight that earns dedicated UI. It changes how the answer was produced, the SDK explicitly asks renderers to show it inline, and it needs structure a flat title/message cannot hold: n memory paths with personal/team scope, or one synthesized paragraph. A separator-style marker (\"Recalled 2 memories\") expanding to the list matches how context-compaction already reads.",
    decision:
      "Shipped as a new provider-neutral memory-recall event kind (a cliNormalizedEventValidator addition, taken because no existing kind can carry n paths plus scope). The SDK's mode is renamed to describe the payload rather than the strategy: select → files, synthesize → synthesis. The <synthesis:DIR> sentinel path is dropped rather than shown, since it opens nothing, and a recall that matched nothing at all stays silent instead of rendering an empty marker.",
  },
  {
    fixtureId: "plugin_install",
    shape: "metadata",
    shapeLabel: "Silent + ephemeral, except failures",
    code: "claude-plugin-install-failed",
    ephemeral: true,
    rationale:
      "Mirror the hook_response rule exactly: started, installed, and completed are startup housekeeping superseded by the terminal event, so they go silent and ephemeral. status: \"failed\" is the only record that a plugin the user configured is not loaded, and it carries error text, so it surfaces as an inline notice and must outlive ephemeral cleanup — the same carve-out shape as a failed compaction status.",
    decision:
      "Shipped, with one correction to the assumption: this is not one row changing status. Because only failures render, a clean install shows nothing at all, and each failure is a separate plugin — so N failed plugins means N independent rows, not one row updating in place. There is no started → installed → completed progression on screen to update. The failure row is carved out of ephemeral cleanup.",
  },
  {
    fixtureId: "local_command_output",
    shape: "first-class",
    shapeLabel: "Reuse the text event",
    ephemeral: false,
    rationale:
      "The SDK's own instruction is \"displayed as assistant-style text in the transcript\", and the content is pre-formatted multi-line output. Normalizing to kind: \"text\" renders it as assistant prose with no new event kind, no new renderer, and no collapsed card hiding the very output the user asked for by typing the command.",
    decision:
      "Shipped as kind: \"text\". No new event kind, no new renderer. Blank content stays silent rather than pushing an empty text part. Note the consequence — /cost-style column-aligned output loses its alignment in a proportional font; if that reads badly in practice, the fix is a monospace treatment inside the text renderer, not a different event shape.",
  },
  {
    fixtureId: "post_turn_summary",
    shape: "metadata",
    shapeLabel: "Silent — unreachable today",
    ephemeral: false,
    rationale:
      "The SDK reader intercepts this before yielding it to consumers, so no chunk row can ever contain it: mapping it now would be dead code we could not test against real output. Worth a spec note instead, because if it is ever exposed it is a better Watch Tower status source than anything we compute — its status_category (blocked | completed | review_ready) is already our vocabulary.",
    decision:
      "Shipped as silent metadata (an explicit branch, not the generic fallback). Nothing in the app renders a model-authored per-turn summary today — every status surface we have is a mechanical projection (Watch Tower's watchStatus buckets, the task-level agentThreadWork mirror). This would be the first natural-language \"what happened / what is needed\" text, with three candidate homes: a Watch Tower row subtitle, enriched thread.* notification copy, or an end-of-thread card. Split out so that scope decision can be made during implementation. Still gated on reachability — the SDK intercepts it today, which the follow-up treats as a hard blocker to verify first.",
    splitInto: "OS-1610",
  },
  {
    fixtureId: "prompt_suggestion",
    shape: "metadata",
    shapeLabel: "Silent + ephemeral (not transcript UI)",
    ephemeral: true,
    rationale:
      "Composer affordance, not transcript content: a predicted next prompt belongs in the input as a dismissible chip, and rendering last turn's guess as permanent history is actively wrong. Note the separate bug this exposes — the top-level type is prompt_suggestion, not system, so it never reaches the system branch and today falls through to the louder \"Unsupported CLI event\" card.",
    decision:
      "OS-1598 shipped the silencing half: the chunk now normalizes to metadata carrying the suggestion under promptSuggestion, instead of the \"Unsupported CLI event\" card. The real UI — a clickable chip after the message or an affordance inside the composer — is split out, and it also has to pass promptSuggestions: true from apps/cli before any of it is reachable.",
    splitInto: "OS-1609",
  },
  {
    fixtureId: "elicitation_complete",
    shape: "metadata",
    shapeLabel: "Silent",
    ephemeral: true,
    rationale:
      "The payload is two identifiers with no outcome, value, or error, so a card can only ever say \"an elicitation finished\" — which is the exact content-free failure mode the ticket is about. The paired elicitation request is where any user-facing UI belongs.",
    decision:
      "Shipped as silent metadata, ephemeral in storage. Elicitation = an MCP server asking the *user* for input mid-run, rather than the model deciding on its own. The SDK models it as a control request (subtype: \"elicitation\", with mcp_server_name, a message, an optional requested_schema, and mode: \"form\" | \"url\") answered via the onElicitation callback — structurally the same channel as canUseTool tool approvals. In \"form\" mode the consumer collects fields inline; in \"url\" mode the user completes something in a browser instead, and this elicitation_complete message is the server saying \"they finished\" so the consumer can stop waiting. We do not implement onElicitation at all today, so no elicitation request is ever raised through Convoy — which is exactly why the completion carries nothing useful on its own.",
  },
];

export type FallbackOption = {
  id: string;
  title: string;
  behavior: string;
  tradeoff: string;
  recommended?: boolean;
};

/**
 * The ticket's "Also" item: what the generic fallback should do for subtypes we
 * have not mapped yet, so the next SDK release cannot regress the transcript.
 */
export const FALLBACK_OPTIONS: FallbackOption[] = [
  {
    id: "today",
    title: "Generic card (kept)",
    behavior:
      "Emits a runtime-notice with code claude-system-<subtype>, title \"Claude runtime notice\", message \"Claude reported <subtype>.\" and the raw payload behind the disclosure.",
    tradeoff:
      "Content-free by construction, and repeats once per emission. Every new SDK subtype regresses the transcript until someone maps it.",
  },
  {
    id: "silent",
    title: "Silent metadata",
    behavior:
      "Unmapped subtypes normalize to metadata, so nothing renders. The raw payload stays on the chunk row and read-time re-normalization upgrades it the moment we add a mapping.",
    tradeoff:
      "Rejected in review: the card is the discovery mechanism. Going silent means new SDK subtypes arrive invisibly and nobody learns there is something to map.",
  },
  {
    id: "debug-only",
    title: "Silent, plus a debug affordance",
    behavior:
      "Silent in the transcript, but surfaced under an existing debug view so unmapped traffic is discoverable without being in the reader's way.",
    tradeoff:
      "Keeps discoverability, but only for whoever thinks to open the debug view — and costs new UI for a case the existing card already covers.",
  },
];

/** Which fallback option review settled on, and why. */
export const FALLBACK_DECISION = {
  optionId: "today",
  summary:
    "Keep the generic card exactly as it is. Its noise is the point: it is the signal that Claude emitted something we do not handle yet, including subtypes added by future SDK releases.",
} as const;
