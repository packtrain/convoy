/** Makes a jsdom element scrollable (no Tailwind, no layout) so scroll-lock libraries treat it as such. */
export function mockScrollable(element: HTMLElement): HTMLElement {
  element.style.overflowY = "auto";
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: 500 });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: 200 });
  return element;
}
