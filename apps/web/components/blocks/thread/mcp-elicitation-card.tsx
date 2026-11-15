"use client";

import { z } from "zod";
import { useId } from "react";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isRecord } from "@/lib/type-guards";

type Choice = { value: string; label: string };
const BOOLEAN_CHOICES: Choice[] = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];

function choicesFor(field: Record<string, unknown>): Choice[] | null {
  if (Array.isArray(field.enum) && field.enum.every((value) => typeof value === "string")) {
    const names = Array.isArray(field.enumNames) ? field.enumNames : [];
    return field.enum.map((value, index) => ({ value, label: typeof names[index] === "string" ? names[index] : value }));
  }
  const options = field.oneOf ?? field.anyOf;
  if (!Array.isArray(options)) return null;
  return options
    .filter(isRecord)
    .flatMap((option) =>
      typeof option.const === "string"
        ? [{ value: option.const, label: typeof option.title === "string" ? option.title : option.const }]
        : []
    );
}

function supportedField(field: Record<string, unknown>): boolean {
  if (field.type === "array") return isRecord(field.items) && choicesFor(field.items) !== null;
  return ["string", "number", "integer", "boolean"].includes(String(field.type));
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function ElicitationField({
  name,
  field,
  required,
  disabled,
  prefix,
}: {
  name: string;
  field: Record<string, unknown>;
  required: boolean;
  disabled: boolean;
  prefix: string;
}) {
  const id = `${prefix}-${name}`;
  const choices = choicesFor(field.type === "array" && isRecord(field.items) ? field.items : field);
  const common = { id, name, required, disabled };
  const initial = field.default;
  const singleChoices = field.type === "boolean" ? BOOLEAN_CHOICES : field.type !== "array" ? choices : null;
  const initialValue = typeof initial === "string" || typeof initial === "boolean" ? String(initial) : undefined;
  const initialIndex = singleChoices?.findIndex((choice) => choice.value === initialValue);
  const selectClass = "w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm">
        {typeof field.title === "string" ? field.title : name}
      </label>
      {typeof field.description === "string" ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
      {singleChoices ? (
        <Select name={name} required={required} disabled={disabled}
          defaultValue={initialIndex !== undefined && initialIndex >= 0 ? `choice-${initialIndex}` : undefined}>
          <SelectTrigger id={id} className="w-full cursor-pointer">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {!required ? <SelectItem value="unset">Select an option</SelectItem> : null}
            {singleChoices.map((choice, index) => (
              <SelectItem key={index} value={`choice-${index}`}>{choice.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : choices ? (
        <select
          {...common}
          multiple={field.type === "array"}
          className={selectClass}
          defaultValue={
            Array.isArray(initial)
              ? initial.filter((v): v is string => typeof v === "string")
              : typeof initial === "string"
                ? initial
                : field.type === "array"
                  ? []
                  : ""
          }
        >
          {field.type !== "array" ? <option value="">Select an option</option> : null}
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : (
        <Input
          {...common}
          autoComplete="off"
          type={
            field.type === "number" || field.type === "integer"
              ? "number"
              : field.format === "email"
                ? "email"
                : field.format === "uri"
                  ? "url"
                  : field.format === "date"
                    ? "date"
                    : "text"
          }
          step={field.type === "integer" ? 1 : "any"}
          min={typeof field.minimum === "number" ? field.minimum : undefined}
          max={typeof field.maximum === "number" ? field.maximum : undefined}
          minLength={typeof field.minLength === "number" ? field.minLength : undefined}
          maxLength={typeof field.maxLength === "number" ? field.maxLength : undefined}
          defaultValue={typeof initial === "string" || typeof initial === "number" ? initial : ""}
        />
      )}
    </div>
  );
}

export function McpElicitationCard({
  payload,
  disabled,
  onRespond,
}: {
  payload: Record<string, unknown>;
  disabled: boolean;
  onRespond: (response: string) => void;
}) {
  const prefix = useId();
  const schema = isRecord(payload.requestedSchema) ? payload.requestedSchema : {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const fields = Object.entries(properties).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
  const required = Array.isArray(schema.required) ? schema.required : [];
  const urlMode = payload.mode === "url";
  const url = safeUrl(payload.url);
  const supported = urlMode
    ? url !== null
    : payload.mode === "form" &&
      schema.type === "object" &&
      fields.length === Object.keys(properties).length &&
      fields.every(([, field]) => supportedField(field));
  const respond = (action: string, content: unknown = null) => onRespond(JSON.stringify({ action, content }));

  return (
    <form
      className="min-w-0 rounded-lg border border-border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !supported || !event.currentTarget.reportValidity()) return;
        if (urlMode) {
          respond("accept");
          return;
        }
        const data = new FormData(event.currentTarget);
        const content: Record<string, unknown> = {};
        for (const [name, field] of fields) {
          const rawValue = data.get(name);
          const singleChoices = field.type === "boolean" ? BOOLEAN_CHOICES : field.type !== "array" ? choicesFor(field) : null;
          const value = singleChoices
            ? singleChoices.find((_, index) => rawValue === `choice-${index}`)?.value
            : rawValue;
          if (field.type === "array") {
            const values = data.getAll(name);
            const input = event.currentTarget.elements.namedItem(name);
            const invalid =
              (typeof field.minItems === "number" && values.length < field.minItems) ||
              (typeof field.maxItems === "number" && values.length > field.maxItems);
            if (input instanceof HTMLSelectElement) {
              input.setCustomValidity(invalid ? "Choose the requested number of options." : "");
              if (invalid) {
                input.reportValidity();
                return;
              }
            }
            if (values.length || required.includes(name)) Object.defineProperty(content, name, { value: values, enumerable: true });
          } else if (typeof value === "string" && value !== "") {
            if (field.format === "date-time" && !z.iso.datetime({ offset: true }).safeParse(value).success) {
              const input = event.currentTarget.elements.namedItem(name);
              if (input instanceof HTMLInputElement) {
                input.setCustomValidity("Enter a date and time with a timezone, such as 2026-09-23T12:00:00Z.");
                input.reportValidity();
              }
              return;
            }
            const typed =
              field.type === "boolean" ? value === "true" : field.type === "integer" || field.type === "number" ? Number(value) : value;
            Object.defineProperty(content, name, { value: typed, enumerable: true });
          }
        }
        respond("accept", content);
      }}
      onChange={(event) => {
        if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) event.target.setCustomValidity("");
      }}
    >
      <p className="mb-2 flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
        <Plug className="size-4 shrink-0" />
        <span className="truncate">
          {typeof payload.serverName === "string" ? payload.serverName : "MCP server"} requests input
        </span>
      </p>
      {typeof payload.message === "string" ? <p className="mb-2 text-sm">{payload.message}</p> : null}
      <div className="-m-1 max-h-[min(32vh,13.125rem)] space-y-3 overflow-y-auto p-1">
        {urlMode && url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm underline">
            Open in browser
          </a>
        ) : null}
        {!urlMode && supported
          ? fields.map(([name, field]) => (
              <ElicitationField
                key={name}
                name={name}
                field={field}
                required={required.includes(name)}
                disabled={disabled}
                prefix={prefix}
              />
            ))
          : null}
        {!supported ? (
          <p className="text-sm text-muted-foreground">This request format is not supported. Decline or cancel to continue.</p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" size="sm" className="cursor-pointer" disabled={disabled || !supported}>
          {urlMode ? "Continue" : "Submit"}
        </Button>
        <Button type="button" size="sm" variant="outline" className="cursor-pointer" disabled={disabled} onClick={() => respond("decline")}>
          Decline
        </Button>
        <Button type="button" size="sm" variant="outline" className="cursor-pointer" disabled={disabled} onClick={() => respond("cancel")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
