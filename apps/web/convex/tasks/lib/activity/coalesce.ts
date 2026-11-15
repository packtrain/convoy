import type { Infer } from "convex/values";
import type { changeDetailsValidator, eventTypeValidator } from "./validators";

type EventType = Infer<typeof eventTypeValidator>;
type ChangeDetails = Infer<typeof changeDetailsValidator>;

/**
 * Editing burst window: a same-actor repeat on the same subject inside it reuses
 * the existing row (docs/specs/task-activity-log.md#coalescing).
 */
export const ACTIVITY_COALESCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * What a coalescible row is "about", or null if the event never coalesces. Two
 * rows collapse only when their subjects match, so edits to two different
 * artifacts stay separate rows even inside one burst.
 */
export function coalesceSubject(
  eventType: EventType,
  changeDetails: ChangeDetails | undefined
): string | null {
  switch (eventType) {
    // Whole-task fields: one subject each, and neither row renders a value.
    case "description_edited":
    case "name_edited":
      return eventType;
    // Per-file, and the row renders the name — so it keys the burst.
    case "artifact_updated":
      return changeDetails?.type === "artifact" ? `artifact_updated:${changeDetails.fileName}` : null;
    default:
      return null;
  }
}
