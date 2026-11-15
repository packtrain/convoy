"use client";

import { AlertTriangle, Check, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FUTURE_SUBTYPE_FIXTURE, SUBTYPE_FIXTURES, type SubtypeFixture } from "./fixtures";
import {
  FALLBACK_DECISION,
  FALLBACK_OPTIONS,
  SUBTYPE_PROPOSALS,
  type ProposedShape,
  type SubtypeProposal,
} from "./proposals";
import {
  BeforePreview,
  PromptSuggestionSketch,
  ShippedPreview,
} from "./subtype-previews";

const SHAPE_VARIANT: Record<ProposedShape, "secondary" | "outline" | "default" | "ghost"> = {
  metadata: "outline",
  "runtime-notice": "secondary",
  "first-class": "default",
  none: "ghost",
};

function Column({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "before" | "shipped";
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div
        className={cn(
          "text-[11px] font-medium tracking-wide uppercase",
          tone === "before" ? "text-muted-foreground" : "text-blue-400"
        )}
      >
        {label}
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-card/40 p-3">{children}</div>
    </div>
  );
}

function SubtypeSection({
  fixture,
  proposal,
}: {
  fixture: SubtypeFixture;
  proposal: SubtypeProposal;
}) {
  return (
    <section className="space-y-4 border-t border-border pt-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-base font-medium text-foreground">{fixture.subtype}</h2>
          <Badge variant={SHAPE_VARIANT[proposal.shape]} shape="rounded">
            {proposal.shapeLabel}
          </Badge>
          {proposal.ephemeral && (
            <Badge variant="outline" shape="rounded">
              ephemeral row
            </Badge>
          )}
          {proposal.code && (
            <code className="text-xs text-muted-foreground">{proposal.code}</code>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{fixture.sdkType}</p>
      </div>

      <div className="space-y-2 text-sm leading-6">
        <p className="text-foreground">{fixture.meaning}</p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Cadence. </span>
          {fixture.cadence}
        </p>
        {fixture.reachability && (
          <p className="flex gap-2 rounded-md border border-border bg-muted/30 p-2 text-xs leading-5 text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-medium text-foreground">Reachability. </span>
              {fixture.reachability}
            </span>
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Column label="Before" tone="before">
          <BeforePreview fixture={fixture} />
        </Column>
        <Column label="Now (shipped)" tone="shipped">
          <ShippedPreview fixture={fixture} />
        </Column>
      </div>

      {fixture.id === "prompt_suggestion" && (
        <div className="rounded-lg border border-dashed border-blue-400/30 bg-blue-400/5 p-3">
          <PromptSuggestionSketch fixture={fixture} />
        </div>
      )}

      <div className="space-y-2 text-sm leading-6">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Why. </span>
          {proposal.rationale}
        </p>
        {proposal.decision && (
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs leading-5 text-foreground">
            <Check className="mr-1 inline size-3.5 shrink-0 text-emerald-500" />
            <span className="font-medium">Decided. </span>
            {proposal.decision}
            {proposal.splitInto && (
              <>
                {" Split into "}
                <code className="text-xs font-medium">{proposal.splitInto}</code>.
              </>
            )}
          </p>
        )}
        {proposal.question && !proposal.decision && (
          <p className="rounded-md border border-blue-400/30 bg-blue-400/5 p-2 text-xs leading-5 text-foreground">
            <span className="font-medium">Still open. </span>
            {proposal.question}
          </p>
        )}
      </div>
    </section>
  );
}

export default function ClaudeSystemSubtypesPlaygroundPage() {
  const proposalById = new Map(SUBTYPE_PROPOSALS.map((p) => [p.fixtureId, p]));

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Claude SDK system subtypes — shipped handling (OS-1598)
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            How every Claude Agent SDK <code className="text-xs">system</code> subtype that once
            had no explicit mapping is handled now that OS-1598 has landed. The{" "}
            <span className="font-medium">Now</span> column is generated by running each fixture
            through the real normalizer (
            <code className="text-xs">normalizeCliChunkToEvent</code>), so it is live behavior
            rather than a mock-up; <span className="font-medium">Before</span> is a reconstruction
            of the content-free generic card these payloads used to produce. Payload shapes are
            copied from <code className="text-xs">@anthropic-ai/claude-agent-sdk</code> 0.2.112.
            Nothing here is wired to a thread — this is a review surface only.
          </p>
          <p className="flex gap-2 rounded-md border border-dashed border-border/70 p-2.5 text-xs leading-5 text-muted-foreground">
            <EyeOff className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-medium text-foreground">Reading the previews. </span>
              Anything in a dashed frame or after a dashed dash is a note about an{" "}
              <em>absence</em> — those events render nothing at all in the transcript, and the
              text is this page describing that, never real UI. Counts are shown only so you can
              see how many events were suppressed.
            </span>
          </p>
        </header>

        <section className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
          <h2 className="text-sm font-medium text-foreground">
            Summary — reviewed, settled, and implemented
          </h2>
          <ul className="space-y-1.5 text-sm leading-6 text-muted-foreground">
            <li>
              <span className="text-foreground">Two got real UI.</span>{" "}
              <code className="text-xs">memory_recall</code> is now a first-class{" "}
              <code className="text-xs">memory-recall</code> event with a recall marker over a
              collapsed memory list, and <code className="text-xs">local_command_output</code>{" "}
              normalizes to <code className="text-xs">text</code> and renders as assistant prose,
              as the SDK instructs.
            </li>
            <li>
              <span className="text-foreground">Two got failure-only notices.</span>{" "}
              <code className="text-xs">notification</code> (
              <code className="text-xs">high</code>/<code className="text-xs">immediate</code>{" "}
              only) and <code className="text-xs">plugin_install</code> (
              <code className="text-xs">status: &quot;failed&quot;</code> only), following the
              existing <code className="text-xs">hook_response</code> rule. Both rendered
              variants are carved out of ephemeral cleanup so the row cannot be deleted under a
              visible card.
            </li>
            <li>
              <span className="text-foreground">Three went silent.</span>{" "}
              <code className="text-xs">session_state_changed</code> (level state we already
              track), <code className="text-xs">elicitation_complete</code> (two bare
              identifiers, nothing renderable), and{" "}
              <code className="text-xs">post_turn_summary</code> (the SDK intercepts it before
              consumers ever see it).
            </li>
            <li>
              <span className="text-foreground">Two have follow-up tasks for real UI.</span>{" "}
              <code className="text-xs">prompt_suggestion</code> earns a clickable next-prompt
              affordance (<code className="text-xs">OS-1609</code>), and{" "}
              <code className="text-xs">post_turn_summary</code> earns run summaries across Watch
              Tower / notifications / end-of-thread (<code className="text-xs">OS-1610</code>).
              Both are gated on reachability. OS-1598 only had to stop them rendering as
              content-free cards, which it does —{" "}
              <code className="text-xs">prompt_suggestion</code> in particular was hitting the
              louder &quot;Unsupported CLI event&quot; card, not the generic one.
            </li>
            <li>
              <span className="text-foreground">The generic fallback stayed as-is.</span> Its
              noise is the signal that an unhandled event exists, including subtypes future SDK
              releases add.
            </li>
            <li>
              <span className="text-foreground">Three of the eight are unreachable today</span>{" "}
              because of env-var or option gating — flagged per section, and worth confirming
              before writing code against them.
            </li>
          </ul>
        </section>

        {SUBTYPE_FIXTURES.map((fixture) => {
          const proposal = proposalById.get(fixture.id);
          if (!proposal) {
            return null;
          }
          return (
            <SubtypeSection key={fixture.id} fixture={fixture} proposal={proposal} />
          );
        })}

        <section className="space-y-4 border-t border-border pt-8">
          <div className="space-y-2">
            <h2 className="text-base font-medium text-foreground">
              The generic fallback itself
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              The ticket&apos;s &quot;Also&quot; item — and the one place review went the other
              way from my original recommendation. Below is a hypothetical future subtype rendered
              through the fallback, which is unchanged.
            </p>
          </div>

          <p className="flex gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs leading-5 text-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
            <span>
              <span className="font-medium">Decided — kept exactly as it was. </span>
              {FALLBACK_DECISION.summary} I had recommended silencing it; the counter-argument
              wins: the card is the discovery mechanism, and a silent fallback means new SDK
              subtypes land invisibly with nobody to notice them. That does mean unmapped events
              stay noisy until mapped, which is the accepted cost.
            </span>
          </p>

          <div className="max-w-xl">
            <Column label="Unchanged — generated by the live normalizer" tone="shipped">
              <ShippedPreview fixture={FUTURE_SUBTYPE_FIXTURE} />
            </Column>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {FALLBACK_OPTIONS.map((option) => {
              const chosen = option.id === FALLBACK_DECISION.optionId;
              return (
                <div
                  key={option.id}
                  className={cn(
                    "space-y-2 rounded-lg border p-3",
                    chosen
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-border bg-card/40 opacity-70"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {chosen && <Check className="size-3.5 shrink-0 text-emerald-500" />}
                    <h3 className="text-sm font-medium text-foreground">{option.title}</h3>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{option.behavior}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    <span className="font-medium text-foreground">Trade-off. </span>
                    {option.tradeoff}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
