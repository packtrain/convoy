import { toast } from "sonner";
import { appRoute } from "@/lib/navigation";

/**
 * Absolute URL of a thread's detail page — what "Copy link" hands to a
 * teammate after the thread is shared (OS-1575). Same shape as the task link
 * actions: the router's pathname prefixed with the current origin.
 */
export function buildThreadShareUrl(
  organizationSlug: string,
  projectAlias: string,
  threadId: string
): string {
  const { pathname } = appRoute.projectThreadDetail(
    organizationSlug,
    projectAlias,
    threadId
  );

  return `${window.location.origin}${pathname}`;
}

/**
 * Copy a thread's link and report the outcome. Every share surface goes through this:
 * the clipboard write fails in insecure contexts, on denied permission, and wherever
 * `navigator.clipboard` is absent, and each caller re-implementing the try/toast is how
 * the header badge came to claim success on failure.
 *
 * `errorMessage` exists because the copy is not always the whole action — after a
 * successful `share`, the failure notice must still say the thread *is* shared.
 *
 * Never throws: the caller has already done the part that matters.
 */
export async function copyThreadShareLink(
  organizationSlug: string,
  projectAlias: string,
  threadId: string,
  messages?: { success?: string; error?: string }
): Promise<void> {
  try {
    await navigator.clipboard.writeText(
      buildThreadShareUrl(organizationSlug, projectAlias, threadId)
    );
    toast.success(messages?.success ?? "Link copied to clipboard");
  } catch {
    toast.error(messages?.error ?? "Failed to copy link");
  }
}
