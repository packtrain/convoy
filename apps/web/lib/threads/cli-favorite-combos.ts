import {
  MAX_CLI_FAVORITE_COMBOS,
  type CliFavoriteCombo,
} from "@/convex/lib/contracts/validators";
import { isCliType, isSupportedCliEffort, isSupportedCliModel } from "@/lib/cli-runtime-ui/registry";

export type { CliFavoriteCombo };

/**
 * A favorite as rendered in the selector: `isAvailable` is false when the
 * runtime registry no longer supports the model — the row renders disabled
 * (with an explanatory tooltip) but keeps its unpin star.
 */
export interface CliFavoriteComboView extends CliFavoriteCombo {
  isAvailable: boolean;
}

/** Model + effort match, with a missing effort treated as "default". */
export function isSameCliFavoriteCombo(
  a: CliFavoriteCombo,
  b: CliFavoriteCombo,
): boolean {
  return (
    a.cliType === b.cliType &&
    a.cliModel === b.cliModel &&
    (a.cliEffort ?? "default") === (b.cliEffort ?? "default")
  );
}

/**
 * Prepare persisted favorites for rendering, deduped. Favorites are never silently
 * dropped for a stale model — they render disabled until unpinned — except for unknown
 * cliType slugs (retired runtimes), which have nothing to render. Supported models get
 * the recents effort rule; unsupported ones keep their values verbatim.
 */
export function sanitizeCliFavoriteCombos(
  combos: readonly CliFavoriteCombo[],
): CliFavoriteComboView[] {
  const sanitized: CliFavoriteComboView[] = [];
  for (const combo of combos) {
    if (!isCliType(combo.cliType)) {
      continue;
    }
    const isAvailable = isSupportedCliModel(combo.cliType, combo.cliModel);
    const cliEffort =
      !isAvailable ||
      isSupportedCliEffort(combo.cliType, combo.cliEffort, {
        cliModel: combo.cliModel,
      })
        ? combo.cliEffort
        : undefined;
    const candidate: CliFavoriteComboView = {
      cliType: combo.cliType,
      cliModel: combo.cliModel,
      cliEffort,
      isAvailable,
    };
    if (!sanitized.some((entry) => isSameCliFavoriteCombo(entry, candidate))) {
      sanitized.push(candidate);
    }
  }
  return sanitized.slice(0, MAX_CLI_FAVORITE_COMBOS);
}

/** Strip view-only fields (`isAvailable`) so persisted combos stay schema-clean. */
function toPlainCliFavoriteCombo(combo: CliFavoriteCombo): CliFavoriteCombo {
  return {
    cliType: combo.cliType,
    cliModel: combo.cliModel,
    cliEffort: combo.cliEffort,
  };
}

/** Add the combo if absent, remove it if present. Oldest drops past the cap. */
export function toggleCliFavoriteCombo(
  current: readonly CliFavoriteCombo[],
  combo: CliFavoriteCombo,
): CliFavoriteCombo[] {
  const without = current
    .filter((entry) => !isSameCliFavoriteCombo(entry, combo))
    .map(toPlainCliFavoriteCombo);
  if (without.length < current.length) {
    return without;
  }
  return [...without, toPlainCliFavoriteCombo(combo)].slice(
    -MAX_CLI_FAVORITE_COMBOS,
  );
}
