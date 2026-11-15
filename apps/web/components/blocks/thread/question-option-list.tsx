"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { RadioIndicator } from "@/components/ui/radio-indicator";
import { cn } from "@/lib/utils";

export type QuestionOptionItem = {
  label: string;
  description?: string;
};

/**
 * Namespaces one question's DOM ids and radio-group name by prompt identity, so
 * clicking an option in a later prompt never targets an identically-named
 * control in an earlier one (see `docs/specs/cli-ask-user-question-ui.md` →
 * Multi-Prompt Isolation).
 */
export function buildQuestionKey(
  promptId: string,
  questionIndex: number
): string {
  const safePromptId = promptId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${safePromptId}-question-${questionIndex}`;
}

/**
 * One selectable option row: control, label, and the description that makes the choice
 * decidable. Exported so the free-text "Other" row can reuse the row shell.
 *
 * `children` render *below* the label but *inside* the row's surface: nesting them in
 * the `<label>` would re-toggle the option on every click into the field, while putting
 * them outside leaves the field hanging off the highlighted box. Hence the
 * selected/hover background on the wrapper, not the label.
 */
export function QuestionOptionRow({
  id,
  name,
  label,
  description,
  multiSelect,
  checked,
  disabled = false,
  onToggle,
  children,
}: {
  id: string;
  name: string;
  label: string;
  description?: string;
  multiSelect: boolean;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md transition-colors",
        checked ? "bg-muted" : "hover:bg-muted/50",
        disabled && "opacity-70"
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          "flex items-start gap-2.5 px-2.5 py-2",
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        )}
      >
        {multiSelect ? (
          <Checkbox
            id={id}
            aria-label={label}
            checked={checked}
            disabled={disabled}
            className="mt-0.5"
            onCheckedChange={() => onToggle()}
          />
        ) : (
          <>
            <input
              type="radio"
              id={id}
              name={name}
              aria-label={label}
              checked={checked}
              disabled={disabled}
              className="sr-only"
              onChange={() => onToggle()}
            />
            <RadioIndicator checked={checked} disabled={disabled} className="mt-0.5" />
          </>
        )}
        <span className="min-w-0">
          <span className="block text-sm leading-5 font-medium text-foreground">
            {label}
          </span>
          {description && (
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
              {description}
            </span>
          )}
        </span>
      </label>
      {/* Indented to the label text: px-2.5 + control size-4 + gap-2.5 = 2.25rem. */}
      {children ? <div className="px-2.5 pb-2 pl-9">{children}</div> : null}
    </div>
  );
}

/**
 * Agent question options as a radio group or checkbox list, one row per option with its
 * label above its description (OS-1602). Chips were the earlier layout, but a chip can
 * only carry the deciding `description` in a `title` tooltip. Both question surfaces
 * render through this so they can't drift.
 *
 * `name` namespaces option ids and the radio group by prompt identity: without it,
 * clicking an option in a later prompt targets the identically-named control in an
 * earlier one.
 */
export function QuestionOptionList({
  name,
  options,
  multiSelect,
  selectedLabels,
  disabled = false,
  onToggle,
  className,
  children,
}: {
  name: string;
  options: QuestionOptionItem[];
  multiSelect: boolean;
  selectedLabels: string[];
  disabled?: boolean;
  onToggle: (label: string) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("flex flex-col gap-0.5", className)}
      {...(!multiSelect && { role: "radiogroup" })}
    >
      {options.map((option, optionIndex) => (
        <QuestionOptionRow
          key={`${name}-option-${optionIndex}`}
          id={`${name}-option-${optionIndex}`}
          name={name}
          label={option.label}
          description={option.description}
          multiSelect={multiSelect}
          checked={selectedLabels.includes(option.label)}
          disabled={disabled}
          onToggle={() => onToggle(option.label)}
        />
      ))}
      {children}
    </div>
  );
}
