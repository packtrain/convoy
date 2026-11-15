/**
* The timeline's one alignment fact: where the activity rail's icon column centers, measured
* from the stream's content edge (inside its `px-4`).
*
* Every row lines up on it — rail glyphs, the thread card's status dot, the composer triggers —
* and each sits behind different padding, so each needs its own offset over some other
* component's internals. As literals in three files, changing one padding silently misaligned
* two unrelated components with no test failure. So each consumer states which box it corrects
* from, and Tailwind's arbitrary values are written out with their derivation asserted in
* `rail-geometry.test.ts`.
*/

/** `left-1` (4px) plus half of the glyph's `size-5` (20px) box. */
export const RAIL_GLYPH_LEFT_PX = 4;
export const RAIL_GLYPH_BOX_PX = 20;

/** Where a rail glyph's center falls. Every other offset targets this. */
export const RAIL_CENTER_PX = RAIL_GLYPH_LEFT_PX + RAIL_GLYPH_BOX_PX / 2;

/**
 * `CompactThreadRowContent`'s status indicator: 1px card border, then the row's
 * `pl-2` (8px), then half of the indicator's `size-4` (16px) box.
 */
const THREAD_CARD_BORDER_PX = 1;
const THREAD_CARD_ROW_PADDING_PX = 8;
const THREAD_CARD_INDICATOR_BOX_PX = 16;

export const THREAD_CARD_INDICATOR_CENTER_PX =
  THREAD_CARD_BORDER_PX + THREAD_CARD_ROW_PADDING_PX + THREAD_CARD_INDICATOR_BOX_PX / 2;

/**
 * How far the thread card must shift to seat its dot on the rail column.
 * Positive means the card sits right of the rail and pulls back.
 */
export const THREAD_CARD_RAIL_OFFSET_PX = THREAD_CARD_INDICATOR_CENTER_PX - RAIL_CENTER_PX;

/** A composer trigger's `size-4` icon, centered in its own box at 8px. */
const COMPOSER_TRIGGER_ICON_BOX_PX = 16;

export const COMPOSER_TRIGGER_ICON_CENTER_PX = COMPOSER_TRIGGER_ICON_BOX_PX / 2;

/** Left padding that carries a trigger icon out to the rail column. */
export const COMPOSER_TRIGGER_RAIL_PADDING_PX = RAIL_CENTER_PX - COMPOSER_TRIGGER_ICON_CENTER_PX;

/**
 * The classes, written literally because Tailwind needs them so. Paired with the
 * constants above by `rail-geometry.test.ts`, which fails if the arithmetic and
 * the class stop agreeing.
 */
export const THREAD_CARD_RAIL_OFFSET_CLASS = "-mx-[3px]";
export const COMPOSER_TRIGGER_RAIL_PADDING_CLASS = "pl-1.5";
