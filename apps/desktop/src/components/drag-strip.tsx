/**
 * Draggable strip under the hidden-title overlay titlebar. Every screen must
 * render one at the top or the window cannot be moved.
 */
export function DragStrip() {
  return <div data-tauri-drag-region className="h-9 shrink-0" />;
}
