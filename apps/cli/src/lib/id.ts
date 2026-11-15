import type { Id, TableNames } from "../convex/_generated/dataModel.js";
import type { SystemTableNames } from "convex/server";

const CONVEX_ID_PATTERN = /^[A-Za-z0-9_]+$/;

export function parseId<T extends TableNames | SystemTableNames>(
  value: string,
  label: string
): Id<T> {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }

  // Convex IDs never contain a hyphen; production would redact the validator
  // error to a bare "Server Error" (OS-2267).
  if (trimmed.includes("-")) {
    throw new Error(`${label} "${trimmed}" looks like a ref, not a Convex ID. Pass the document ID.`);
  }

  if (!CONVEX_ID_PATTERN.test(trimmed)) {
    throw new Error(`${label} must be a valid Convex ID`);
  }

  // Convex performs the canonical ID validation at the API boundary. This
  // helper rejects obvious bad input before applying the branded ID type.
  return trimmed as Id<T>;
}
