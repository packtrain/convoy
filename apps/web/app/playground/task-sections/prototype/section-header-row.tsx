"use client";

import { useRef, useState, type CSSProperties, type DragEvent, type Ref } from "react";
import { ChevronRight, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { ColorPicker } from "@/components/custom/color-picker";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { NO_SECTION_NAME, type TaskSection } from "./sections";

export const SECTION_DRAG_TYPE = "application/x-task-section";
const TASK_DRAG_TYPE = "application/x-multi-select";

export type SectionDrop = { kind: "task"; clientId: string; isMultiSelect: boolean } | { kind: "section"; sectionId: string };

/** The three color treatments the prototype compares. */
export type SectionColorStyle = "dot" | "stripe" | "tint";

export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export function readSectionDrop(event: DragEvent): SectionDrop | null {
  const sectionId = event.dataTransfer.getData(SECTION_DRAG_TYPE);
  if (sectionId) return { kind: "section", sectionId };
  const clientId = event.dataTransfer.getData("text/plain");
  return clientId ? { kind: "task", clientId, isMultiSelect: event.dataTransfer.getData(TASK_DRAG_TYPE) === "true" } : null;
}

export function startSectionDrag(event: DragEvent, sectionId: string, dragImage?: Element | null) {
  event.dataTransfer.setData(SECTION_DRAG_TYPE, sectionId);
  event.dataTransfer.effectAllowed = "move";
  if (dragImage) event.dataTransfer.setDragImage(dragImage, 16, 16);
}

/** Drop-target props for anything that accepts task rows and, optionally, section headers. */
export function useSectionDropTarget(acceptsSections: boolean, onDrop: (drop: SectionDrop) => void) {
  const [isOver, setIsOver] = useState(false);
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(TASK_DRAG_TYPE) || (acceptsSections && event.dataTransfer.types.includes(SECTION_DRAG_TYPE));
  return {
    isOver,
    dropProps: {
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setIsOver(true);
      },
      onDragLeave: () => setIsOver(false),
      onDrop: (event: DragEvent) => {
        setIsOver(false);
        if (!accepts(event)) return;
        // Keep the table's container and document drop handlers from re-applying this drop.
        event.preventDefault();
        event.stopPropagation();
        const drop = readSectionDrop(event);
        if (drop) onDrop(drop);
      },
    },
  };
}

interface SectionNameFieldProps {
  value: string;
  label: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  style?: CSSProperties;
  className?: string;
  /** Called on every blur: the new name, or null when unchanged, empty or cancelled. */
  onDone: (name: string | null) => void;
}

/** Always-editable name, sized to its text like the task table's name cell. */
export function SectionNameField({ value, label, autoFocus, inputRef, style, className, onDone }: SectionNameFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = draft ?? value;
  return (
    <div className={cn("relative inline-flex min-w-16 max-w-full", className)}>
      <span className="invisible whitespace-pre px-1.5 py-1">{shown || " "}</span>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        aria-label={label}
        value={shown}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => autoFocus && event.currentTarget.select()}
        onBlur={() => {
          const next = shown.trim();
          onDone(!cancelled.current && next && next !== value ? next : null);
          cancelled.current = false;
          setDraft(null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
        style={style}
        className="absolute inset-0 w-full rounded-sm bg-transparent px-1.5 py-1 outline-none focus:bg-background focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

export function SectionColorPicker({ section, onChange }: { section: TaskSection; onChange: (color: string | null) => void }) {
  return (
    <ColorPicker
      value={section.color}
      onChange={onChange}
      palette="extended"
      align="end"
      triggerAriaLabel={`${section.name} color`}
      triggerClassName="size-6 border-0 bg-transparent shadow-none hover:bg-muted dark:bg-transparent [&>div]:size-3"
    />
  );
}

/** Dot style's color marker; keeps its slot when there is no color so names line up. */
export function SectionDot({ color }: { color: string | null | undefined }) {
  return <span aria-hidden className="mx-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? undefined }} />;
}

interface SectionHeaderRowProps {
  section: TaskSection | null;
  colorStyle: SectionColorStyle;
  /** Taller row with a bigger title at its bottom. */
  spacious: boolean;
  isFirst: boolean;
  isLast: boolean;
  autoFocusName: boolean;
  onToggle: () => void;
  onRename: (name: string | null) => void;
  onColorChange: (color: string | null) => void;
  onAddTask?: () => void;
  onMove: (offset: -1 | 1) => void;
  onDelete: () => void;
  onDrop: (drop: SectionDrop) => void;
}

export function SectionHeaderRow({ section, colorStyle, spacious, isFirst, isLast, autoFocusName, onToggle, onRename, onColorChange, onAddTask, onMove, onDelete, onDrop }: SectionHeaderRowProps) {
  const name = section?.name ?? NO_SECTION_NAME;
  const color = section?.color;
  const { isOver, dropProps } = useSectionDropTarget(Boolean(section), onDrop);
  const nameRef = useRef<HTMLInputElement>(null);
  // Radix refocuses the trigger on close; Rename sends focus to the name instead.
  const renameChosen = useRef(false);
  return (
    <div
      role="row"
      aria-label={`Section ${name}`}
      data-section-row={section?.id ?? "none"}
      {...dropProps}
      style={{
        backgroundColor: color && colorStyle === "tint" ? tint(color, 8) : undefined,
        boxShadow: color && colorStyle === "stripe" ? `inset 3px 0 0 ${color}` : undefined,
      }}
      className={cn(
        "group/section flex h-full flex-col justify-end border-b border-border bg-muted/40",
        isOver && "bg-blue-500/10 ring-1 ring-inset ring-blue-500"
      )}
    >
      {/* Spacious keeps the content in the row's bottom 48px; the space above shares the background. */}
      <div className={cn("flex items-center gap-1 pl-1 pr-3", spacious ? "h-12" : "h-full")}>
        <span
          draggable={Boolean(section)}
          aria-hidden
          onDragStart={(event) => section && startSectionDrag(event, section.id, event.currentTarget.closest("[data-section-row]"))}
          className={cn("flex h-6 w-4 items-center justify-center text-muted-foreground opacity-0", section && "cursor-grab group-hover/section:opacity-100")}
        >
          <GripVertical className="size-3.5" />
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${section?.collapsed ? "Expand" : "Collapse"} ${name}`}
          aria-expanded={!section?.collapsed}
          disabled={!section}
          onClick={onToggle}
        >
          <ChevronRight className={cn("transition-transform", !section?.collapsed && "rotate-90")} />
        </Button>
        {colorStyle === "dot" && <SectionDot color={color} />}
        {section ? (
          <SectionNameField
            key={section.id}
            value={section.name}
            label="Section name"
            autoFocus={autoFocusName}
            inputRef={nameRef}
            style={{ color: color && colorStyle === "stripe" ? color : undefined }}
            className={cn("min-w-48 font-semibold", spacious ? "text-base" : "text-sm")}
            onDone={onRename}
          />
        ) : (
          <span className={cn("px-1.5 font-semibold text-muted-foreground", spacious ? "text-base" : "text-sm")}>{name}</span>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover/section:opacity-100 group-focus-within/section:opacity-100 has-[[data-state=open]]:opacity-100">
          {onAddTask && (
            <Button variant="ghost" size="icon-xs" aria-label={`Add task to ${name}`} onClick={onAddTask}>
              <Plus />
            </Button>
          )}
          {section && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={`${name} actions`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  if (!renameChosen.current) return;
                  renameChosen.current = false;
                  event.preventDefault();
                  nameRef.current?.focus();
                  nameRef.current?.select();
                }}
              >
                <DropdownMenuItem onSelect={() => (renameChosen.current = true)}>Rename section</DropdownMenuItem>
                <DropdownMenuItem disabled={isFirst} onSelect={() => onMove(-1)}>Move up</DropdownMenuItem>
                <DropdownMenuItem disabled={isLast} onSelect={() => onMove(1)}>Move down</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>Delete section</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {section && <SectionColorPicker section={section} onChange={onColorChange} />}
        </div>
      </div>
    </div>
  );
}

export function AddSectionRow({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full items-center border-b border-border pl-7">
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onAdd}>
        <Plus />
        Add section
      </Button>
    </div>
  );
}
