/**
 * Shared layout for the "type trigger + title" row on both task-create surfaces.
 *
 * Top-aligned so the type trigger stays on the title's first line when a long title
 * wraps; the trigger slot height must match the input's first line box (`py-2` +
 * `text-sm/6` = `h-10`). The line height rides in the font-size class because
 * `cn()` drops a separate `leading-6` next to `text-sm` (OS-1913).
 */
export const TASK_CREATE_TITLE_ROW_CLASS_NAME = "flex items-start gap-2";

export const TASK_CREATE_TYPE_SLOT_CLASS_NAME =
  "flex h-10 shrink-0 items-center";

/**
 * `field-sizing-content`, not a measured height: the browser re-sizes on every
 * re-wrap, so a viewport change can't leave a cropped title (OS-1874). Each
 * surface adds its own `max-h-*` ceiling.
 */
export const TASK_CREATE_TITLE_INPUT_CLASS_NAME =
  "ml-1 w-full field-sizing-content min-h-10 resize-none overflow-y-auto bg-transparent px-0 py-2 text-sm/6 text-foreground outline-none placeholder:text-muted-foreground";
