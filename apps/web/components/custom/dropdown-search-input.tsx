"use client";

import { Command as CommandPrimitive } from "cmdk";
import { Search, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

interface DropdownSearchInputBaseProps {
  className?: string;
  clearLabel?: string;
  inputClassName?: string;
  onClear?: () => void;
  showClearButton?: boolean;
  /** Overrides the wrapper's `p-1 pb-0` inset, e.g. inside an already padded menu. */
  wrapperClassName?: string;
}

type NativeDropdownSearchInputProps = DropdownSearchInputBaseProps &
  Omit<
    ComponentProps<typeof InputGroupInput>,
    keyof DropdownSearchInputBaseProps | "role" | "type"
  > & {
    mode?: "native";
  };

type CommandDropdownSearchInputProps = DropdownSearchInputBaseProps &
  Omit<
    ComponentProps<typeof CommandPrimitive.Input>,
    keyof DropdownSearchInputBaseProps
  > & {
    mode: "command";
  };

type DropdownSearchInputProps =
  | NativeDropdownSearchInputProps
  | CommandDropdownSearchInputProps;

function DropdownSearchInputFrame({
  children,
  className,
  clearLabel,
  onClear,
  showClearButton,
  wrapperClassName,
}: DropdownSearchInputBaseProps & { children: ReactNode }) {
  return (
    <div data-slot="dropdown-search-input-wrapper" className={cn("p-1 pb-0", wrapperClassName)}>
      <InputGroup
        className={cn(
          "rounded-none border-0 bg-transparent shadow-none transition-none dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0",
          className
        )}
      >
        {children}
        <InputGroupAddon>
          <Search className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
        {showClearButton ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={clearLabel}
              className="text-muted-foreground hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onClear?.();
              }}
            >
              <X className="size-3.5" />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}

export function DropdownSearchInput(props: DropdownSearchInputProps) {
  if (props.mode === "command") {
    const {
      className,
      clearLabel = "Clear search",
      inputClassName,
      mode,
      onClear,
      showClearButton = false,
      wrapperClassName,
      ...inputProps
    } = props;

    return (
      <DropdownSearchInputFrame
        className={className}
        clearLabel={clearLabel}
        onClear={onClear}
        showClearButton={showClearButton}
        wrapperClassName={wrapperClassName}
      >
        <CommandPrimitive.Input
          data-slot="input-group-control"
          data-search-mode={mode}
          className={cn(
            "h-full min-w-0 flex-1 bg-transparent px-2.5 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
            inputClassName
          )}
          {...inputProps}
        />
      </DropdownSearchInputFrame>
    );
  }

  const {
    className,
    clearLabel = "Clear search",
    inputClassName,
    mode,
    onClear,
    showClearButton = false,
    wrapperClassName,
    ...inputProps
  } = props;

  return (
    <DropdownSearchInputFrame
      className={className}
      clearLabel={clearLabel}
      onClear={onClear}
      showClearButton={showClearButton}
      wrapperClassName={wrapperClassName}
    >
      <InputGroupInput
        type="text"
        role="searchbox"
        data-search-mode={mode ?? "native"}
        className={cn("h-full text-sm", inputClassName)}
        {...inputProps}
      />
    </DropdownSearchInputFrame>
  );
}
