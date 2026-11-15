"use client";

import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

/** The `/` is a display addon, so typing or pasting one never reaches the value. */
function normalizeName(value: string): string {
  return value.replace(/\//g, "").toLowerCase();
}

/**
 * The `/name` field Skills and Prompts share — one `/` addon and one error
 * contract instead of a hand-rolled copy per form. `onValueChange` receives the
 * normalized value; the caller owns when to revalidate.
 */
export function SettingsCatalogNameField({
  id,
  label,
  placeholder,
  value,
  error,
  disabled,
  onValueChange,
  onBlur,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  error?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onBlur: () => void;
}) {
  const errorId = `${id}-error`;

  return (
    // self-start: a validation error grows the row, and a stretched field would
    // center its label against the taller neighbour.
    <div className="grid gap-2 self-start sm:col-span-8">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium leading-none select-none">
        {label}
      </label>
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>/</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          disabled={disabled}
          value={value}
          onBlur={onBlur}
          onChange={(event) => onValueChange(normalizeName(event.target.value))}
          placeholder={placeholder}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? errorId : undefined}
        />
      </InputGroup>
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
