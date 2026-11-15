"use client";

import type { ComponentProps, ComponentType, MouseEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { DropdownSearchInput } from "@/components/custom/dropdown-search-input";
import {
  getSearchablePickerItemProps,
  handleSearchablePickerKeyDown,
} from "@/components/custom/searchable-picker-keyboard";
import { cn } from "@/lib/utils";

/**
 * Shared search + list frame for field picker dropdowns. Owns the unified keyboard
 * behavior: the input auto-focuses on mount, ArrowUp/ArrowDown cycle real focus through
 * input → items → input, Enter/Space activate, and Escape/Tab pass through so the owning
 * Radix overlay closes as usual.
 *
 * Items must be focusable elements marked with `getSearchablePickerItemProps(true)`.
 */
export function SearchablePicker({
  query,
  onQueryChange,
  placeholder,
  clearLabel = "Clear search",
  listClassName,
  children,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  clearLabel?: string;
  listClassName?: string;
  children: ReactNode;
}) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus after the owning Radix overlay finishes its own focus management.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <div
      ref={pickerRef}
      onKeyDownCapture={(event) =>
        handleSearchablePickerKeyDown(event, pickerRef.current)
      }
    >
      <DropdownSearchInput
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={placeholder}
        clearLabel={clearLabel}
        onClear={() => onQueryChange("")}
        showClearButton={query.length > 0}
      />
      <div
        data-slot="searchable-picker-list"
        className={cn("max-h-[260px] overflow-y-auto p-1 pt-0", listClassName)}
      >
        {children}
      </div>
    </div>
  );
}

/** A Radix menu item (e.g. `ContextMenuItem`) a picker row can render as, so picking closes that menu. */
export type SearchablePickerItemComponent = ComponentType<{
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  className?: string;
  disabled?: boolean;
  "data-checked"?: boolean;
  "data-searchable-picker-item"?: string;
}>;

/**
 * Focusable picker row styled like a menu item. Works inside both
 * DropdownMenuContent and PopoverContent (no Radix menu context required).
 * `checked` renders a trailing check icon and the `data-checked` attribute.
 * `as` renders the row as a menu item instead (context-menu submenus).
 */
export function SearchablePickerItem({
  checked,
  className,
  children,
  as: Item,
  ...props
}: ComponentProps<"button"> & { checked?: boolean; as?: SearchablePickerItemComponent }) {
  if (Item) {
    return (
      <Item
        data-checked={checked}
        {...getSearchablePickerItemProps(true)}
        className={className}
        onClick={props.onClick as ((event: MouseEvent<HTMLDivElement>) => void) | undefined}
      >
        {children}
        {checked ? <Check className="ml-auto size-4 shrink-0" /> : null}
      </Item>
    );
  }

  return (
    <button
      type="button"
      data-interactive
      data-checked={checked}
      {...getSearchablePickerItemProps(true)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      {checked ? <Check className="ml-auto size-4 shrink-0" /> : null}
    </button>
  );
}
