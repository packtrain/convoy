import type { KeyboardEvent } from "react";

const SEARCHABLE_PICKER_ITEM_SELECTOR = "[data-searchable-picker-item]";

export function getSearchablePickerItemProps(enabled: boolean) {
  return enabled ? { "data-searchable-picker-item": "" } : {};
}

export function handleSearchablePickerKeyDown(event: KeyboardEvent<HTMLElement>, picker: HTMLElement | null) {
  if (!picker) {
    return false;
  }

  const items = Array.from(picker.querySelectorAll<HTMLElement>(SEARCHABLE_PICKER_ITEM_SELECTOR));
  const activeElement = document.activeElement;
  const activeIndex = activeElement instanceof HTMLElement ? items.indexOf(activeElement) : -1;
  const isTextInput =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement;

  if ((event.key === "Enter" || event.key === " ") && activeIndex >= 0) {
    event.preventDefault();
    event.stopPropagation();
    items[activeIndex]?.click();
    return true;
  }

  if (
    (event.key === "ArrowDown" || event.key === "ArrowUp") &&
    items.length > 0
  ) {
    // The search input is part of the focus cycle: input → first item → … →
    // last item → input (and the reverse for ArrowUp), so arrowing past
    // either end of the list returns focus to the search input.
    const searchInput = picker.querySelector<HTMLElement>("input");
    const cycle = searchInput ? [searchInput, ...items] : items;
    const cycleIndex =
      activeElement instanceof HTMLElement ? cycle.indexOf(activeElement) : -1;
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const fromIndex = cycleIndex >= 0 ? cycleIndex : 0;
    const nextIndex = (fromIndex + delta + cycle.length) % cycle.length;

    event.preventDefault();
    event.stopPropagation();
    cycle[nextIndex]?.focus();
    return true;
  }

  if (isTextInput && event.key !== "Escape" && event.key !== "Tab") {
    event.stopPropagation();
    return true;
  }

  return false;
}
