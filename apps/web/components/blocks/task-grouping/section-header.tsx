"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  SectionColorStyle,
  SectionHeaderStyle,
} from "@/convex/lib/contracts/validators";
import { ColorPicker } from "@/components/custom/color-picker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showConvexErrorToast } from "@/lib/errors";
import { calculateRankBetween } from "@/lib/tasks/rank";
import type { TaskSection } from "@/lib/tasks/hooks/use-task-sections";
import { ROW_HEIGHT } from "@/lib/tasks/constants";
import { parseSectionTitleForCreate } from "@/lib/tasks/create-title";
import { cn } from "@/lib/utils";

const SECTION_DRAG_TYPE = "application/x-task-section";
// dragover can't read drag data, so the dragged section lives here.
let draggedSectionId: Id<"taskSections"> | null = null;
const DROP_LINE =
  "relative before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-0.5 before:bg-blue-500";

/** Drop target that moves the dragged section before `sections[index]`, or last at the end. */
function useSectionDropLine(
  sections: readonly TaskSection[],
  actions: SectionActions | undefined,
  index: number,
) {
  const [isOver, setIsOver] = useState(false);
  const from = () =>
    sections.findIndex((section) => section._id === draggedSectionId);
  // Section drags stop here so the table's task-drop handlers never see them.
  const accepts = (event: DragEvent) => {
    if (!actions || index < 0) return false;
    if (!event.dataTransfer.types.includes(SECTION_DRAG_TYPE)) return false;
    const at = from();
    return at >= 0 && at !== index && at !== index - 1;
  };
  return {
    isOver,
    dropProps: {
      "data-drop-line": isOver ? "before" : undefined,
      onDragOver: (event: DragEvent) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setIsOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setIsOver(false);
      },
      onDrop: (event: DragEvent) => {
        setIsOver(false);
        if (!accepts(event) || !draggedSectionId) return;
        event.preventDefault();
        event.stopPropagation();
        const at = from();
        void actions?.moveTo(draggedSectionId, at < index ? index - 1 : index);
      },
    },
  };
}

/** Spacious header height; content sits in the bottom 48px. See task-sections.md. */
export const SPACIOUS_SECTION_HEADER_HEIGHT = 68;

function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** Background/stripe for a section's header (`header`) or its task rows. */
export function sectionStyle(
  color: string | null | undefined,
  colorStyle: SectionColorStyle,
  header = false,
): CSSProperties | undefined {
  if (!color) return undefined;
  if (colorStyle === "tint")
    return { backgroundColor: tint(color, header ? 8 : 4) };
  if (colorStyle === "stripe") return { boxShadow: `inset 3px 0 0 ${color}` };
  return undefined;
}

export function SectionDot({ color }: { color: string | null | undefined }) {
  return (
    <span
      aria-hidden
      className="mx-1 size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? undefined }}
    />
  );
}

const PREVIEW_COLOR = "#3b82f6";

/** Miniature section (header and two rows) for the appearance picker. */
export function SectionStylePreview({
  headerStyle,
  colorStyle,
}: {
  headerStyle: SectionHeaderStyle;
  colorStyle: SectionColorStyle;
}) {
  const spacious = headerStyle === "spacious";
  return (
    <div
      aria-hidden
      className="w-full overflow-hidden rounded-md border bg-background text-left"
    >
      <div
        style={sectionStyle(PREVIEW_COLOR, colorStyle, true)}
        className={cn(
          "flex items-center gap-1 border-b bg-muted/40 px-1.5",
          spacious ? "h-10 items-end pb-1.5" : "h-6",
        )}
      >
        <ChevronRight className="size-3 rotate-90 text-muted-foreground" />
        {colorStyle === "dot" && (
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: PREVIEW_COLOR }}
          />
        )}
        <span
          className={cn("font-semibold", spacious ? "text-xs" : "text-[10px]")}
          style={{ color: colorStyle === "stripe" ? PREVIEW_COLOR : undefined }}
        >
          Design
        </span>
      </div>
      {["w-3/5", "w-2/5"].map((width) => (
        <div
          key={width}
          style={sectionStyle(PREVIEW_COLOR, colorStyle)}
          className="flex h-5 items-center gap-1.5 border-b px-2 last:border-b-0"
        >
          <span className="size-2 shrink-0 rounded-full border border-muted-foreground/50" />
          <span className={cn("h-1.5 rounded-full bg-muted-foreground/25", width)} />
        </div>
      ))}
    </div>
  );
}

export function useSectionActions(
  projectId: Id<"projects">,
  listRef: string | null,
  sections: readonly TaskSection[],
) {
  const create = useMutation(api.tasks.sections.create);
  const update = useMutation(api.tasks.sections.update);
  const reorder = useMutation(api.tasks.sections.reorder);
  const remove = useMutation(api.tasks.sections.remove);
  return useMemo(() => {
    const queryArgs = { projectId, ...(listRef ? { listRef } : {}) };
    const patchList =
      (change: (current: TaskSection[]) => TaskSection[]) =>
      (store: OptimisticLocalStore) => {
        const current = store.getQuery(api.tasks.sections.list, queryArgs);
        if (current)
          store.setQuery(api.tasks.sections.list, queryArgs, change(current));
      };
    const fail = (message: string) => (error: unknown) =>
      showConvexErrorToast(error, message);
    const setRank = (sectionId: Id<"taskSections">, rank: string) =>
      reorder
        .withOptimisticUpdate(
          patchList((current) =>
            current
              .map((section) =>
                section._id === sectionId ? { ...section, rank } : section,
              )
              .sort((a, b) => a.rank.localeCompare(b.rank)),
          ),
        )({ sectionId, rank })
        .catch(fail("Failed to reorder section"));
    return {
      create: (name: string) =>
        create
          .withOptimisticUpdate(
            patchList((current) => [
              ...current,
              {
                _id: crypto.randomUUID() as Id<"taskSections">,
                name,
                color: null,
                rank: calculateRankBetween(current.at(-1)?.rank, undefined),
              },
            ]),
          )({ ...queryArgs, name })
          .catch(fail("Failed to create section")),
      update: (
        sectionId: Id<"taskSections">,
        patch: { name?: string; color?: string | null },
      ) =>
        update
          .withOptimisticUpdate(
            patchList((current) =>
              current.map((section) =>
                section._id === sectionId
                  ? {
                      ...section,
                      ...(patch.name !== undefined && { name: patch.name }),
                      ...(patch.color !== undefined && { color: patch.color }),
                    }
                  : section,
              ),
            ),
          )({ sectionId, ...patch })
          .catch(fail("Failed to update section")),
      /** Moves a section to `index` in the current order. */
      moveTo: (sectionId: Id<"taskSections">, index: number) => {
        const rest = sections.filter((section) => section._id !== sectionId);
        return setRank(
          sectionId,
          calculateRankBetween(rest[index - 1]?.rank, rest[index]?.rank),
        );
      },
      remove: (sectionId: Id<"taskSections">) =>
        remove
          .withOptimisticUpdate(
            patchList((current) =>
              current.filter((section) => section._id !== sectionId),
            ),
          )({ sectionId })
          .catch(fail("Failed to delete section")),
    };
  }, [create, update, reorder, remove, projectId, listRef, sections]);
}

export type SectionActions = ReturnType<typeof useSectionActions>;

/** Always-editable name sized to its text, like the task name cell. */
export function SectionNameField({
  value,
  style,
  className,
  onRename,
}: {
  value: string;
  style?: CSSProperties;
  className?: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const shown = draft ?? value;
  return (
    <div className={cn("relative inline-flex min-w-16 max-w-full", className)}>
      <span className="invisible whitespace-pre px-1.5 py-1">
        {shown || " "}
      </span>
      <input
        aria-label="Section name"
        value={shown}
        onChange={(event) => setDraft(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        onBlur={() => {
          const next = shown.trim();
          if (!cancelled.current && next && next !== value) onRename(next);
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
        className="absolute inset-0 w-full truncate bg-transparent px-1.5 py-1 outline-none"
      />
    </div>
  );
}

/** Actions menu + color swatch shown on hover after the section name. */
export function SectionControls({
  section,
  sections,
  actions,
}: {
  section: TaskSection;
  sections: readonly TaskSection[];
  actions: SectionActions;
}) {
  const index = sections.findIndex((item) => item._id === section._id);
  return (
    <div
      // Board column headers double as drag handles.
      onPointerDown={(event) => event.stopPropagation()}
      className="flex items-center gap-0.5 opacity-0 group-hover/section:opacity-100 group-focus-within/section:opacity-100 has-[[data-state=open]]:opacity-100 [@media(pointer:coarse)]:opacity-100"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${section.name} actions`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            disabled={index === 0}
            onSelect={() => actions.moveTo(section._id, index - 1)}
          >
            <ArrowUp />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === sections.length - 1}
            onSelect={() => actions.moveTo(section._id, index + 1)}
          >
            <ArrowDown />
            Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => actions.remove(section._id)}
          >
            <Trash2 />
            Delete section
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ColorPicker
        value={section.color}
        onChange={(color) => actions.update(section._id, { color })}
        allowEmpty
        palette="extended"
        align="end"
        triggerAriaLabel={`${section.name} color`}
        triggerClassName="size-6 border-0 bg-transparent shadow-none hover:bg-muted dark:bg-transparent [&>div]:size-3"
      />
    </div>
  );
}

/** List header for one section, or "No section" when `section` is null. */
export function SectionHeader({
  section,
  colorStyle,
  spacious,
  collapsed,
  toggle,
  sections,
  actions,
  mobile = false,
  onNavigate,
}: {
  section: TaskSection | null;
  colorStyle: SectionColorStyle;
  spacious: boolean;
  collapsed: boolean;
  toggle: () => void;
  sections: readonly TaskSection[];
  /** Omitted for viewers and archived pages. */
  actions?: SectionActions;
  mobile?: boolean;
  onNavigate?: (direction: "prev" | "next") => void;
}) {
  const name = section?.name ?? "No section";
  const color = section?.color;
  const draggable = Boolean(section && actions && !mobile);
  const { isOver, dropProps } = useSectionDropLine(
    sections,
    actions,
    section ? sections.findIndex((item) => item._id === section._id) : -1,
  );
  return (
    <div
      aria-label={`Section ${name}`}
      style={{
        ...sectionStyle(color, colorStyle, true),
        height: spacious ? SPACIOUS_SECTION_HEADER_HEIGHT : ROW_HEIGHT,
      }}
      className={cn(
        "group/section flex flex-col justify-end border-b bg-muted/40",
        isOver && DROP_LINE,
      )}
      {...dropProps}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          if ((event.key === "ArrowRight") === collapsed) toggle();
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          onNavigate?.(event.key === "ArrowUp" ? "prev" : "next");
        }
      }}
    >
      <div
        className={cn(
          "flex items-center gap-1",
          mobile ? "px-3" : "pl-1 pr-3",
          spacious ? "h-12" : "h-full",
        )}
      >
        {/* pl-1 + w-4 grip + gap-1 keeps the chevron at 24px. */}
        {!mobile && (
          <span
            draggable={draggable}
            aria-label={draggable ? `Drag ${name}` : undefined}
            aria-hidden={!draggable}
            onDragEnd={() => (draggedSectionId = null)}
            onDragStart={(event) => {
              if (!section) return;
              draggedSectionId = section._id;
              event.dataTransfer.setData(SECTION_DRAG_TYPE, section._id);
              event.dataTransfer.effectAllowed = "move";
              const row = event.currentTarget.closest(
                "[aria-label^='Section ']",
              );
              if (row) event.dataTransfer.setDragImage(row, 16, 16);
            }}
            className={cn(
              "flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground opacity-0",
              draggable && "cursor-grab group-hover/section:opacity-100",
            )}
          >
            {draggable && <GripVertical className="size-3.5" />}
          </span>
        )}
        <button
          type="button"
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-muted"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${name}`}
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          <ChevronRight
            className={cn(
              "pointer-events-none size-4 text-muted-foreground transition-transform duration-150",
              !collapsed && "rotate-90",
            )}
          />
        </button>
        {colorStyle === "dot" && <SectionDot color={color} />}
        {section && actions ? (
          <ManagedSectionName
            section={section}
            sections={sections}
            actions={actions}
            stripe={colorStyle === "stripe"}
            spacious={spacious}
          />
        ) : (
          <span
            className={cn(
              "truncate px-1.5 font-semibold",
              !section && "text-muted-foreground",
              spacious ? "text-base" : "text-sm",
            )}
            style={{
              color: color && colorStyle === "stripe" ? color : undefined,
            }}
          >
            {name}
          </span>
        )}
      </div>
    </div>
  );
}

function ManagedSectionName({
  section,
  sections,
  actions,
  stripe,
  spacious,
}: {
  section: TaskSection;
  sections: readonly TaskSection[];
  actions: SectionActions;
  stripe: boolean;
  spacious: boolean;
}) {
  return (
    <>
      <SectionNameField
        key={section._id}
        value={section.name}
        onRename={(next) => actions.update(section._id, { name: next })}
        style={{ color: stripe && section.color ? section.color : undefined }}
        className={cn(
          "min-w-48 font-semibold",
          spacious ? "text-base" : "text-sm",
        )}
      />
      <SectionControls
        section={section}
        sections={sections}
        actions={actions}
      />
    </>
  );
}

/** "Add section..." input; Enter or blur creates, Escape discards. */
export function AddSectionInput({
  create,
  className,
  style,
  sections = [],
  actions,
}: {
  create: (name: string) => void;
  className?: string;
  style?: CSSProperties;
  /** Pass to make the row the "move last" target for section drags. */
  sections?: readonly TaskSection[];
  actions?: SectionActions;
}) {
  const { isOver, dropProps } = useSectionDropLine(
    sections,
    actions,
    sections.length,
  );
  const [value, setValue] = useState("");
  // Escape blurs before the cleared value renders, so blur would still see the old text.
  const cancelled = useRef(false);
  const commit = () => {
    const name = value.trim();
    if (name) create(parseSectionTitleForCreate(name) ?? name);
    setValue("");
  };
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-sm",
        className,
        isOver && DROP_LINE,
      )}
      style={style}
      {...dropProps}
    >
      <Plus className="size-4 shrink-0 text-muted-foreground" />
      <input
        aria-label="Add section"
        placeholder="Add section..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (cancelled.current) setValue("");
          else commit();
          cancelled.current = false;
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
        className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}
