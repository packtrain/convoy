import type { Id } from "@/convex/_generated/dataModel";

export function taskIdsToStrings(ids: Id<"tasks">[]): string[] {
  // Id<"tasks"> is a string-branded type; spread removes the brand for UI APIs.
  return [...ids];
}
