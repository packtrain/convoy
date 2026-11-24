import type { CliThreadLastUsedCli } from "../../lib/contracts/validators";

/**
 * The runtime selection carried by a single user message, in storage form
 * (already run through the runtime's normalizers).
 */
export type CliMessageSelection = {
  cliModel?: string;
  cliEffort?: string;
  cliMode?: string;
};

/**
* Fold a user message's selection into the thread's denormalized `metadata.cli` (OS-1454).
* `undefined` when nothing is known yet, so callers can skip writing an empty bag.
*
* Model and effort move together — effort is only meaningful against the model it was picked
* with — so a message naming a model replaces both, clearing effort when it names none. An
* effort alone replaces just the effort, as `messages.send` does (OS-2556).
*
* Mode is independent and sticky, so an omitted `cliMode` must not blank it. A *blank* mode is
* dropped rather than stored: it is the one field kept unnormalized, so `"   "` would pin the
* composer to the runtime default forever. Unknown non-blank values fall through at read time.
*/
export function mergeLastUsedCli(
  current: CliThreadLastUsedCli | undefined,
  selection: CliMessageSelection
): CliThreadLastUsedCli | undefined {
  const hasModel = selection.cliModel !== undefined;
  const lastUsedModel = hasModel ? selection.cliModel : current?.lastUsedModel;
  const lastUsedEffort = hasModel ? selection.cliEffort : (selection.cliEffort ?? current?.lastUsedEffort);
  const mode = selection.cliMode?.trim();
  const lastUsedMode = mode !== undefined && mode.length > 0 ? mode : current?.lastUsedMode;

  if (lastUsedModel === undefined && lastUsedEffort === undefined && lastUsedMode === undefined) {
    return undefined;
  }

  return { lastUsedModel, lastUsedEffort, lastUsedMode };
}
