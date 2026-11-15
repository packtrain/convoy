"use client";

import { useCallback, useState } from "react";
import { XIcon } from "lucide-react";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
} from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

interface TaskTagsEditorProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  className?: string;
  /** Chips only: no input and no remove buttons. */
  readOnly?: boolean;
}

function normalizeTag(value: string) {
  return value.trim();
}

function hasTag(tags: string[], candidate: string) {
  const normalizedCandidate = candidate.toLocaleLowerCase();
  return tags.some((tag) => tag.toLocaleLowerCase() === normalizedCandidate);
}

export function TaskTagsEditor({
  tags,
  onTagsChange,
  className,
  readOnly = false,
}: TaskTagsEditorProps) {
  const [inputValue, setInputValue] = useState("");

  const commitTag = useCallback(
    (rawValue: string) => {
      const nextTag = normalizeTag(rawValue);
      setInputValue("");

      if (nextTag.length === 0 || hasTag(tags, nextTag)) {
        return;
      }

      onTagsChange([...tags, nextTag]);
    },
    [onTagsChange, tags]
  );

  const removeTagAtIndex = useCallback(
    (index: number) => {
      onTagsChange(tags.filter((_, currentIndex) => currentIndex !== index));
    },
    [onTagsChange, tags]
  );

  return (
    <Combobox<string, true>
      multiple
      value={tags}
      onValueChange={onTagsChange}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      // Base UI chips handle Delete/Backspace themselves unless the root is read-only.
      readOnly={readOnly}
    >
      <ComboboxChips
        className={cn(
          "min-h-5 w-full gap-1.5 rounded-none border-0 bg-transparent px-0 py-0 shadow-none dark:bg-transparent focus-within:border-0 focus-within:ring-0",
          className
        )}
      >
        {tags.map((tag, index) => (
          <ComboboxChip
            key={tag}
            showRemove={false}
            className="text-muted-foreground gap-0.5"
          >
            <span>{tag}</span>
            {readOnly ? null : (
              <button
                type="button"
                aria-label={`Remove ${tag} tag`}
                className="cursor-pointer text-muted-foreground/70 transition-opacity hover:text-muted-foreground"
                onClick={() => removeTagAtIndex(index)}
              >
                <XIcon className="size-3" />
              </button>
            )}
          </ComboboxChip>
        ))}
        {readOnly ? (
          tags.length === 0 && <span className="text-sm text-muted-foreground">No tags</span>
        ) : (
          <ComboboxChipsInput
            aria-label="Task tags"
            placeholder={tags.length === 0 ? "Add a tag" : undefined}
            className="h-5 bg-transparent py-0 placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }

              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commitTag(inputValue);
                return;
              }

              if (
                event.key === "Backspace" &&
                inputValue.length === 0 &&
                tags.length > 0
              ) {
                event.preventDefault();
                removeTagAtIndex(tags.length - 1);
              }
            }}
          />
        )}
      </ComboboxChips>
    </Combobox>
  );
}
