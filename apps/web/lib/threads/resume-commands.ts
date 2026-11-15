import { buildResumeCommand as buildResumeCommandFromRegistry } from "@/convex/cli/lib/runtimes/registry";
import type { CliType } from "@/convex/lib/contracts/validators";

/** Positional form of the registry builder, which takes an object. */
export function buildResumeCommand(
  cliType: CliType,
  continuationId: string
): string | null {
  return buildResumeCommandFromRegistry({
    cliType,
    continuationId,
  });
}
