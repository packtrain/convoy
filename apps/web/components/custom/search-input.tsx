import { Search, X } from "lucide-react";
import * as React from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

interface SearchInputProps
  extends Omit<React.ComponentProps<typeof InputGroupInput>, "type"> {
  clearLabel?: string;
  inputClassName?: string;
  onClear?: () => void;
  showClearButton?: boolean;
}

export function SearchInput({
  className,
  clearLabel = "Clear search",
  inputClassName,
  onClear,
  showClearButton = false,
  ...props
}: SearchInputProps) {
  return (
    <InputGroup className={cn("w-full min-w-0", className)}>
      <InputGroupInput
        type="text"
        role="searchbox"
        className={cn("text-sm", inputClassName)}
        {...props}
      />
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
  );
}
