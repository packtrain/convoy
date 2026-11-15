const TASK_TABLE_INTERACTIVE_TARGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[data-interactive]",
  "[data-drag-handle]",
  "[data-add-task-input]",
].join(",");

/**
 * Overlays rendered from inside a row are portalled to `document.body`, but React still
 * bubbles their events through the React tree to the row, so row-level handlers must
 * ignore them. Stopping propagation in the overlay instead would also stop the native
 * event before Radix's document-level dismiss listeners see it — which is how
 * tap-outside closing works on touch.
 */
export function isEventInsideCurrentTarget(event: {
  currentTarget: EventTarget | null;
  target: EventTarget | null;
}): boolean {
  return (
    event.currentTarget instanceof Node &&
    event.target instanceof Node &&
    event.currentTarget.contains(event.target)
  );
}

/**
 * Keeps task-row behaviors from treating controls, including portalled menu
 * items, as clicks or long presses on the row itself.
 */
export function isTaskTableInteractiveTarget(
  target: EventTarget | null,
  options: { allowTaskNameInputDrag?: boolean; allowTaskCardBodyDrag?: boolean } = {}
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (
    options.allowTaskNameInputDrag &&
    target.closest("input[data-task-input]")
  ) {
    return false;
  }

  const control = target.closest(TASK_TABLE_INTERACTIVE_TARGET_SELECTOR);
  if (options.allowTaskCardBodyDrag && control?.hasAttribute("data-task-card-body")) {
    return false;
  }
  return Boolean(control);
}
