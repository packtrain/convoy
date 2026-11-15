"use client";

import { AlertTriangle, Bell, EyeOff, PackagePlus, Terminal } from "lucide-react";
import { useMemo } from "react";
import { MemoryRecallPart } from "@/components/blocks/thread/message-parts/memory-recall-part";
import { CollapsibleToolPart } from "@/components/blocks/thread/message-parts/components/collapsible-tool-part";
import { ToolSurface } from "@/components/blocks/thread/message-parts/components/tool-surface";
import {
  expandCliNormalizedEvent,
  normalizeCliChunkToEvent,
} from "@/convex/cli/lib/chunks/normalizedEvents";
import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { formatJsonString } from "@/lib/cli-stream-ui/runtime-notices";
import { isRecord } from "@/lib/type-guards";
import type { SubtypeFixture } from "./fixtures";

/**
 * Renders what a runtime-notice event produces, by reusing the shipped
 * RuntimeNoticePart's structure (CollapsibleToolPart + ToolSurface). Kept local
 * rather than importing RuntimeNoticePart so the "Before" column can render the
 * old generic card, which the normalizer no longer produces.
 */
function NoticeCard({
  icon,
  title,
  message,
  detailsJson,
}: {
  icon: typeof AlertTriangle;
  title: string;
  message: string;
  detailsJson?: string;
}) {
  const rendered = detailsJson ? formatJsonString(detailsJson) : undefined;

  return (
    <CollapsibleToolPart
      icon={icon}
      title={`${title}: ${message}`}
      renderChildren={() =>
        rendered ? (
          <ToolSurface>
            <pre className="overflow-x-auto font-mono text-xs text-foreground">
              <code>{rendered}</code>
            </pre>
          </ToolSurface>
        ) : null
      }
    />
  );
}

/**
 * Marks an absence, not a part. Nothing is rendered in the real transcript for
 * these events — the dashed frame and the caption are playground annotation, so
 * they must not look like real UI. `count` is the number of suppressed events,
 * which is the only thing a reviewer cannot otherwise see.
 */
function NothingRendered({ count, reason }: { count: number; reason: string }) {
  return (
    <div className="rounded-md border border-dashed border-border/70 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <EyeOff className="size-3.5 shrink-0" />
        <span>
          Nothing rendered
          <span className="text-muted-foreground/70">
            {" — "}
            {count} {count === 1 ? "event" : "events"} suppressed
          </span>
        </span>
      </div>
      <p className="pt-1 pl-[22px] text-[11px] leading-4 text-muted-foreground/70">{reason}</p>
    </div>
  );
}

/**
 * One suppressed event inside a sequence that also renders real parts (the
 * priority/status-gated subtypes). Deliberately reads as a gap in the stream
 * rather than a row of content.
 */
function SuppressedGap({ reason }: { reason: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-[11px] text-muted-foreground/60">
      <span className="h-px w-4 shrink-0 border-t border-dashed border-border" />
      <span>not rendered — {reason}</span>
    </div>
  );
}

/**
 * What these subtypes rendered before OS-1598: the content-free generic card,
 * once per emission. Reconstructed rather than generated, because the normalizer
 * no longer produces it for these payloads — which is the point of the change.
 * `prompt_suggestion` never reached the system branch at all and got the louder
 * unsupported-event card instead.
 */
export function BeforePreview({ fixture }: { fixture: SubtypeFixture }) {
  const isSystem = fixture.chunks.every((chunk) => chunk.type === "system");

  return (
    <div className="space-y-2">
      {fixture.chunks.map((chunk, index) =>
        isSystem ? (
          <NoticeCard
            key={index}
            icon={AlertTriangle}
            title="Claude runtime notice"
            message={`Claude reported ${fixture.subtype}.`}
            detailsJson={JSON.stringify({
              subtype: fixture.subtype,
              payload: JSON.parse(chunk.data) as unknown,
            })}
          />
        ) : (
          <NoticeCard
            key={index}
            icon={AlertTriangle}
            title="Unsupported CLI event"
            message={`Received unsupported-type (${chunk.type}).`}
            detailsJson={chunk.data}
          />
        )
      )}
    </div>
  );
}

/**
 * Shipped behavior, driven through the real normalizer so this column cannot
 * drift from production.
 */
export function ShippedPreview({ fixture }: { fixture: SubtypeFixture }) {
  const events = useMemo(
    () =>
      fixture.chunks.flatMap((chunk) =>
        expandCliNormalizedEvent(normalizeCliChunkToEvent(chunk, "claude-code"))
      ),
    [fixture]
  );

  const renderedCount = events.filter((event) => event.kind !== "metadata").length;

  // A fully-silent subtype reads as one absence, not one row per event.
  if (renderedCount === 0) {
    return (
      <NothingRendered
        count={events.length}
        reason="Every event normalizes to silent `metadata`, which the assistant UI never renders."
      />
    );
  }

  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <ShippedEvent key={index} event={event} />
      ))}
    </div>
  );
}

function noticeIconFor(code: string): typeof AlertTriangle {
  if (code === "claude-notification") {
    return Bell;
  }
  if (code === "claude-plugin-install-failed") {
    return PackagePlus;
  }
  return AlertTriangle;
}

function ShippedEvent({ event }: { event: CliNormalizedEvent }) {
  if (event.kind === "runtime-notice") {
    return (
      <NoticeCard
        icon={noticeIconFor(event.code)}
        title={event.title}
        message={event.message}
        detailsJson={event.detailsJson}
      />
    );
  }

  if (event.kind === "memory-recall") {
    return (
      <MemoryRecallPart
        part={{
          type: "memory-recall",
          mode: event.mode,
          memories: event.memories,
          detailsJson: event.detailsJson,
        }}
      />
    );
  }

  if (event.kind === "text") {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground/70">
          Assistant text (<code className="text-[11px]">kind: &quot;text&quot;</code>):
        </p>
        <div className="text-sm whitespace-pre-wrap text-foreground">{event.text}</div>
      </div>
    );
  }

  if (event.kind === "unknown") {
    return (
      <NoticeCard
        icon={AlertTriangle}
        title="Unsupported CLI event"
        message={`Received ${event.reason} (${event.rawType}).`}
        detailsJson={event.rawData}
      />
    );
  }

  return <SuppressedGap reason={`normalizes to \`${event.kind}\``} />;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The one sketch left on this page. `prompt_suggestion` renders nothing today —
 * OS-1598 only stopped it showing an unsupported-event card — and the clickable
 * affordance below is OS-1609's scope, not shipped code.
 */
export function PromptSuggestionSketch({ fixture }: { fixture: SubtypeFixture }) {
  const suggestion = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(fixture.chunks[0]?.data ?? "{}");
      return isRecord(parsed) ? (str(parsed.suggestion) ?? "") : "";
    } catch {
      return "";
    }
  }, [fixture]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Sketch of the OS-1609 affordance — a chip after the message that loads the text into the
        composer. Not implemented:
      </p>
      <div className="rounded-lg border border-border bg-muted/20 p-2">
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Terminal className="size-3.5 shrink-0" />
          <span className="truncate">{suggestion}</span>
        </button>
      </div>
    </div>
  );
}
