import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { parseClaudeUsage, readClaudeAccount } from "./parsers.js";
import type { ClaudeUsageReport } from "./validators.js";
import { ClaudeUsageUnavailableError } from "./errors.js";

/** No model turn; the experimental API stays inside this adapter. */
export async function readClaudeUsage(run: Query, signal: AbortSignal): Promise<ClaudeUsageReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      (async () => {
        if (typeof run.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== "function") {
          throw new ClaudeUsageUnavailableError("Update Claude Code on the runner to read account quota.");
        }
        const before = readClaudeAccount(await run.accountInfo());
        const value = await run.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
        const after = readClaudeAccount(await run.accountInfo());
        if (signal.aborted) throw new ClaudeUsageUnavailableError("Usage lookup cancelled.");
        if (before.identity !== after.identity) throw new ClaudeUsageUnavailableError("The Claude account changed during lookup. Run /usage again.");
        return parseClaudeUsage(value, after.label);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ClaudeUsageUnavailableError("Claude usage lookup timed out. Try /usage again.")), 15_000);
        onAbort = () => reject(new ClaudeUsageUnavailableError("Usage lookup cancelled."));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } catch (error) {
    // Provider errors can contain credentials; expose only our own known messages.
    const detail = error instanceof ClaudeUsageUnavailableError
      ? error.message : "Claude quota lookup is unavailable. Update Claude Code and check the runner's login.";
    return { provider: "claude-code", source: "unavailable", account: "Account unavailable", refreshedAt: Date.now(), buckets: [], detail };
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
