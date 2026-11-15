import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { PERMISSION_DENIED } from "@/lib/authz/permissions";

/** Shown in place of the server's `Permission denied: <permission>` (docs/specs/read-only-viewer-ux.md, Soft failures). */
export const PERMISSION_DENIED_MESSAGE =
  "You don't have permission to do that in this project. Ask a project admin for access.";

const MUTATION_REJECTED_MESSAGE = "Couldn't save your change";

/**
 * Extracts a human-readable message from a caught error: the clean `data`
 * payload for ConvexError (never the "[CONVEX M(...)] Server Error ..." blob
 * in `message`), `message` for plain errors, the fallback otherwise.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    if (typeof error.data !== "string") return fallback;
    return error.data.startsWith(PERMISSION_DENIED) ? PERMISSION_DENIED_MESSAGE : error.data;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

/**
 * Extracts a human-readable message from a caught error (ConvexError or generic)
 * and shows it as a toast. Returns the extracted message.
 */
export function showConvexErrorToast(error: unknown, fallback: string): string {
  const message = getErrorMessage(error, fallback);
  toast.error(message);
  return message;
}

/** A rejected mutation's message: mapped ConvexError data, else the fallback, never a plain error's raw server text. */
export function getMutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ConvexError ? getErrorMessage(error, fallback) : fallback;
}

/**
 * `.catch` for fire-and-forget mutations whose optimistic update reverts on
 * failure. One toast id, so a bulk write that fails per row shows one toast.
 */
export function toastMutationRejection(error: unknown): void {
  toast.error(getMutationErrorMessage(error, MUTATION_REJECTED_MESSAGE), { id: "mutation-rejected" });
}
