/**
 * The group tab strip's overflow cut (OS-1478): how many leading tabs stay visible when
 * they don't all fit. The tail collapses into a dropdown, and the active tab is moved
 * to the end of the visible row instead of disappearing, so it needs a reserved width.
 *
 * The dropdown trigger takes no reserve — it rides inside the last visible tab, so its
 * width is already in that tab's measurement.
 */
export function computeVisibleTabCount({
  widths,
  available,
  activeIndex,
}: {
  /** Measured tab widths, one per tab, in strip order. */
  widths: readonly number[];
  /** Strip width left for tabs (the "+" affordance already subtracted). */
  available: number;
  /** Index of the active tab in `widths`; -1 when none is active. */
  activeIndex: number;
}): number {
  const total = widths.reduce((sum, width) => sum + width, 0);
  // Unmeasured (jsdom, or a strip narrower than nothing) reads as "everything
  // fits" — better to show the whole strip than to blink tabs into the
  // dropdown.
  if (total <= available) {
    return widths.length;
  }

  const fit = (budget: number) => {
    let used = 0;
    let count = 0;
    for (const width of widths) {
      used += width;
      if (used > budget) {
        break;
      }
      count += 1;
    }
    return count;
  };

  const count = fit(available);
  if (activeIndex < 0) {
    // No active tab to host the dropdown trigger, so one tab has to stay —
    // cutting all of them would strand the hidden ones.
    return Math.max(count, 1);
  }
  if (activeIndex < count) {
    return count;
  }
  // The active tab is cut, so it takes the slot at the end of the row and
  // hosts the trigger there; the row may legitimately show nothing else.
  return fit(available - (widths[activeIndex] ?? 0));
}
