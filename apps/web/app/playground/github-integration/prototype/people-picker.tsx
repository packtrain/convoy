import { useState } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectBadgeTriggerClassName } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// GitHub users; those with a name have linked their Convoy account.
const people: { value: string; name?: string; initials: string; color: string }[] = [
  { value: "robin", name: "Robin Hale", initials: "RH", color: "#6750a4" },
  { value: "maya", name: "Maya Singh", initials: "MS", color: "#b04b67" },
  { value: "alex", name: "Alex Morgan", initials: "AM", color: "#287e80" },
  { value: "sam-oss", initials: "S", color: "#8b949e" },
];

// Linked users show their Convoy name; others keep their GitHub login or git name.
export const displayName = (id: string) => people.find((person) => person.value === id)?.name ?? id;

export function avatarUrl(id: string) {
  const person = people.find((person) => person.value === id);
  if (!person) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${person.color}"/><circle cx="20" cy="15" r="7" fill="#ffffff" fill-opacity=".85"/><path d="M7 40v-6a13 13 0 0126 0v6" fill="#ffffff" fill-opacity=".85"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// `gitAuthor` draws initials for commit authors whose email isn't on GitHub.
export function PersonAvatar({ id, compact = false, gitAuthor = false }: { id: string; compact?: boolean; gitAuthor?: boolean }) {
  const person = people.find((person) => person.value === id);
  if (!person && gitAuthor) {
    return (
      <Avatar size="default" className="size-4">
        <AvatarFallback className="text-[7px]">{id.split(" ").map((word) => word[0]).join("").slice(0, 2)}</AvatarFallback>
      </Avatar>
    );
  }
  if (!person) return null;
  return (
    <Avatar size={compact ? "default" : "sm"} className={compact ? "size-4" : undefined}>
      <AvatarImage src={avatarUrl(id) ?? undefined} alt={person.name} />
      <AvatarFallback className={compact ? "text-[8px]" : undefined}>{person.initials}</AvatarFallback>
    </Avatar>
  );
}

export function SearchPicker({
  label,
  title,
  value,
  onChange,
  options,
  avatars = false,
  showValue = false,
  badge = false,
}: {
  label: string;
  title: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; name?: string }[];
  avatars?: boolean;
  showValue?: boolean;
  badge?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={badge ? "ghost" : "outline"}
          size={badge ? "xs" : "settings"}
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className={badge ? cn(selectBadgeTriggerClassName, "h-auto max-w-full font-normal") : undefined}
        >
          {avatars ? <PersonAvatar id={value} compact /> : null}
          <span className="min-w-0 truncate">{value === "all" && !showValue ? label : current?.label}</span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command label={title} className="p-0">
          <CommandInput
            autoFocus
            placeholder={`Filter ${label.toLowerCase()}s…`}
            aria-label={`Filter ${label.toLowerCase()}s`}
          />
          <CommandList className="p-1">
            <CommandEmpty>No matches.</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                aria-label={`${option.label} ${option.name ?? ""}`.trim()}
                value={`${option.label} ${option.name ?? ""}`}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Check className={value === option.value ? "size-3.5" : "size-3.5 opacity-0"} />
                {avatars ? <PersonAvatar id={option.value} compact /> : null}
                <span className="font-medium">{option.label}</span>
                <span className="truncate text-xs text-muted-foreground">{option.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function PeopleFilter({
  kind,
  value,
  onChange,
  showValue = false,
  badge = false,
  you = true,
}: {
  kind: "Author" | "Assignee";
  you?: boolean;
  showValue?: boolean;
  badge?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SearchPicker
      showValue={showValue}
      badge={badge}
      avatars
      label={kind}
      title={`Filter by ${kind.toLowerCase()}`}
      value={value}
      onChange={onChange}
      options={[
        { value: "all", label: `All ${kind.toLowerCase()}s` },
        ...(you ? [{ value: "me", label: "You" }] : []),
        ...(kind === "Assignee" ? [{ value: "none", label: "Assigned to nobody" }] : []),
        ...people.map((person) => ({
          value: person.value,
          label: person.value,
          name: person.name,
        })),
      ]}
    />
  );
}

export function AssignPicker({
  assignments,
  onToggle,
  onClear,
}: {
  assignments: string[][];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Assign selected PRs">
          Assign
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command label="Apply assignees" className="p-0">
          <CommandInput
            autoFocus
            placeholder="Filter assignees…"
            aria-label="Filter assignees to apply"
          />
          <CommandList className="p-1">
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandItem onSelect={onClear}>
              <span className="flex size-4 items-center justify-center rounded border">
                {assignments.every((ids) => ids.length === 0) ? <Check className="size-3" /> : null}
              </span>
              Assign to nobody
            </CommandItem>
            {people.map((person) => {
              const count = assignments.filter((ids) => ids.includes(person.value)).length;
              return (
                <CommandItem
                  key={person.value}
                  value={`${person.value} ${person.name}`}
                  onSelect={() => onToggle(person.value)}
                  aria-label={`${person.value}, ${count === assignments.length ? "assigned to all selected" : count ? "assigned to some selected" : "not assigned"}`}
                >
                  <span
                    aria-hidden
                    className="flex size-4 items-center justify-center rounded border"
                  >
                    {count === assignments.length ? (
                      <Check className="size-3" />
                    ) : count ? (
                      <Minus className="size-3" />
                    ) : null}
                  </span>
                  <PersonAvatar id={person.value} compact />
                  <span className="font-medium">{person.value}</span>
                  <span className="truncate text-xs text-muted-foreground">{person.name}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
