"use client";

import { useEffect, useMemo, useState } from "react";

import {
  IS_BOLD,
  IS_CODE,
  IS_HIGHLIGHT,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  IS_UNDERLINE,
  addTopAreaChild$,
  applyFormat$,
  applyListType$,
  convertSelectionToNode$,
  currentBlockType$,
  currentFormat$,
  currentListType$,
  editorInFocus$,
  insertMarkdown$,
  insertCodeBlock$,
  openLinkEditDialog$,
  realmPlugin,
  rootEditor$,
  lexical,
  useCellValue,
  usePublisher,
  viewMode$,
  type HEADING_LEVEL,
  type BlockType,
} from "@mdxeditor/editor";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createParagraphNode } from "lexical";
import {
  Bold,
  Code,
  FileCode2,
  FilePenLine,
  GitCompareArrows,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  Info,
  Italic,
  Lightbulb,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  ShieldAlert,
  SquareCode,
  Strikethrough,
  TriangleAlert,
  Underline,
  Undo2,
} from "lucide-react";

import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger } from "./ui/select";
import { Separator } from "./ui/separator";
import { cn } from "./lib/utils";

type ViewMode = "rich-text" | "source" | "diff";
type ListType = "" | "bullet" | "number";
type AdmonitionType = "note" | "tip" | "info" | "caution" | "danger";

const blockTypeOptions: Array<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: BlockType;
}> = [
  { icon: Pilcrow, label: "Paragraph", value: "paragraph" },
  { icon: Heading1, label: "Heading 1", value: "h1" },
  { icon: Heading2, label: "Heading 2", value: "h2" },
  { icon: Heading3, label: "Heading 3", value: "h3" },
  { icon: Heading4, label: "Heading 4", value: "h4" },
];

const viewModes: Array<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: ViewMode;
}> = [
  { icon: FilePenLine, label: "Rich text", value: "rich-text" },
  { icon: GitCompareArrows, label: "Diff", value: "diff" },
  { icon: FileCode2, label: "Source", value: "source" },
];

const admonitionOptions: Array<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: AdmonitionType;
}> = [
  { icon: Info, label: "Note", value: "note" },
  { icon: Lightbulb, label: "Tip", value: "tip" },
  { icon: Info, label: "Info", value: "info" },
  { icon: TriangleAlert, label: "Caution", value: "caution" },
  { icon: ShieldAlert, label: "Danger", value: "danger" },
];

function isActiveFormat(format: number, flag: number) {
  return (format & flag) !== 0;
}

function resolveBlockType(value: string): BlockType | null {
  const option = blockTypeOptions.find((item) => item.value === value);
  return option?.value ?? null;
}

function isHeadingBlockType(value: BlockType): value is `h${HEADING_LEVEL}` {
  return /^h[1-6]$/.test(value);
}

function buildAdmonitionMarkdown(value: AdmonitionType) {
  const label = admonitionOptions.find((option) => option.value === value)?.label.toLowerCase() ?? value;
  return `\n:::${value}\nAdd a ${label}.\n:::\n`;
}

function MdxEditorToolbar({ showDiffMode }: { showDiffMode: boolean }) {
  const [selectedAdmonition, setSelectedAdmonition] = useState<AdmonitionType>("note");
  const blockType = useCellValue(currentBlockType$);
  const format = useCellValue(currentFormat$);
  const listType = useCellValue(currentListType$) as ListType;
  const editorInFocus = useCellValue(editorInFocus$);
  const rootEditor = useCellValue(rootEditor$);
  const viewMode = useCellValue(viewMode$);

  const applyFormat = usePublisher(applyFormat$);
  const applyListType = usePublisher(applyListType$);
  const convertSelectionToNode = usePublisher(convertSelectionToNode$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const insertMarkdown = usePublisher(insertMarkdown$);
  const openLinkEditDialog = usePublisher(openLinkEditDialog$);
  const setViewMode = usePublisher(viewMode$);

  const isRichText = viewMode === "rich-text";
  const isCodeBlockEditor = editorInFocus?.editorType === "codeblock";
  const normalizedBlockType = blockType === "" ? "paragraph" : blockType;
  const currentBlockOption =
    blockTypeOptions.find((option) => option.value === normalizedBlockType) ?? blockTypeOptions[0];
  const quoteIsActive = normalizedBlockType === "quote";
  const currentAdmonitionOption =
    admonitionOptions.find((option) => option.value === selectedAdmonition) ?? admonitionOptions[0];
  const availableViewModes = useMemo(
    () => (showDiffMode ? viewModes : viewModes.filter((mode) => mode.value !== "diff")),
    [showDiffMode]
  );
  const currentViewMode =
    availableViewModes.find((mode) => mode.value === viewMode) ?? availableViewModes[0];
  const nextViewMode =
    availableViewModes[(availableViewModes.indexOf(currentViewMode) + 1) % availableViewModes.length];

  useEffect(() => {
    if (!showDiffMode && viewMode === "diff") {
      setViewMode("rich-text");
    }
  }, [setViewMode, showDiffMode, viewMode]);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border bg-card px-2 py-1 backdrop-blur-xl">
      <div className="flex items-center gap-1">
        <ToolbarButton
          aria-label="Undo"
          onClick={() => rootEditor?.dispatchCommand(lexical.UNDO_COMMAND, undefined)}
        >
          <Undo2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Redo"
          onClick={() => rootEditor?.dispatchCommand(lexical.REDO_COMMAND, undefined)}
        >
          <Redo2 className="size-4" />
        </ToolbarButton>
      </div>

      <Separator orientation="vertical" className="max-[640px]:hidden" />

      <Select
        disabled={!isRichText || isCodeBlockEditor}
        value={normalizedBlockType}
        onValueChange={(value) => {
          const nextValue = resolveBlockType(value);

          if (!nextValue) {
            return;
          }

          switch (nextValue) {
            case "paragraph":
              convertSelectionToNode(() => $createParagraphNode());
              break;
            default:
              if (isHeadingBlockType(nextValue)) {
                convertSelectionToNode(() => $createHeadingNode(nextValue));
              }
          }
        }}
      >
        <SelectTrigger
          aria-label={currentBlockOption.label}
          className="h-8 w-9 min-w-0 justify-center gap-0 px-0 text-[0px] max-[640px]:min-w-0"
        >
          <currentBlockOption.icon className="size-4" />
        </SelectTrigger>
        <SelectContent>
          {blockTypeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value} className="rounded-[10px]">
              <option.icon className="mr-2 size-4 shrink-0" />
              <SelectItemText>{option.label}</SelectItemText>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="max-[640px]:hidden" />

      <div className="flex items-center gap-1">
        <ToolbarButton
          aria-label="Bold"
          disabled={!isRichText}
          pressed={isActiveFormat(format, IS_BOLD)}
          onClick={() => applyFormat("bold")}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Italic"
          disabled={!isRichText}
          pressed={isActiveFormat(format, IS_ITALIC)}
          onClick={() => applyFormat("italic")}
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Strikethrough"
          disabled={!isRichText}
          pressed={isActiveFormat(format, IS_STRIKETHROUGH)}
          onClick={() => applyFormat("strikethrough")}
        >
          <Strikethrough className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Underline"
          disabled={!isRichText}
          pressed={isActiveFormat(format, IS_UNDERLINE)}
          onClick={() => applyFormat("underline")}
        >
          <Underline className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Inline code"
          disabled={!isRichText}
          pressed={isActiveFormat(format, IS_CODE)}
          onClick={() => applyFormat("code")}
        >
          <Code className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Highlight"
          disabled={!isRichText}
          pressed={isActiveFormat(format, IS_HIGHLIGHT)}
          onClick={() => applyFormat("highlight")}
        >
          <Highlighter className="size-4" />
        </ToolbarButton>
      </div>

      <Separator orientation="vertical" className="max-[640px]:hidden" />

      <div className="flex items-center gap-1">
        <ToolbarButton
          aria-label="Quote"
          disabled={!isRichText}
          pressed={quoteIsActive}
          onClick={() =>
            convertSelectionToNode(() =>
              quoteIsActive ? $createParagraphNode() : $createQuoteNode()
            )
          }
        >
          <Quote className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Bullet list"
          disabled={!isRichText}
          pressed={listType === "bullet"}
          onClick={() => applyListType(listType === "bullet" ? "" : "bullet")}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Numbered list"
          disabled={!isRichText}
          pressed={listType === "number"}
          onClick={() => applyListType(listType === "number" ? "" : "number")}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
      </div>

      <Separator orientation="vertical" className="max-[640px]:hidden" />

      <div className="flex items-center gap-1">
        <ToolbarButton
          aria-label="Add link"
          disabled={!isRichText}
          onClick={() => openLinkEditDialog(undefined)}
        >
          <Link2 className="size-4" />
        </ToolbarButton>
        <Select
          disabled={!isRichText || isCodeBlockEditor}
          value={selectedAdmonition}
          onValueChange={(value) => {
            const nextValue = admonitionOptions.find((option) => option.value === value)?.value;

            if (!nextValue) {
              return;
            }

            setSelectedAdmonition(nextValue);
            insertMarkdown(buildAdmonitionMarkdown(nextValue));
          }}
        >
          <SelectTrigger
            aria-label={`Insert ${currentAdmonitionOption.label} admonition`}
            className="h-8 w-9 min-w-0 justify-center gap-0 px-0 text-[0px] text-muted-foreground hover:text-foreground max-[640px]:min-w-0"
          >
            <currentAdmonitionOption.icon className="size-4" />
          </SelectTrigger>
          <SelectContent>
            {admonitionOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} className="rounded-[10px]">
                <option.icon className="mr-2 size-4 shrink-0" />
                <SelectItemText>{option.label}</SelectItemText>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToolbarButton
          aria-label="Insert code block"
          disabled={!isRichText}
          onClick={() => insertCodeBlock({ code: "", language: "txt", meta: "" })}
        >
          <SquareCode className="size-4" />
        </ToolbarButton>
      </div>

      <div className="ml-auto inline-flex items-center rounded-[10px] bg-muted p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Editor mode: ${currentViewMode.label}`}
          title={`Editor mode: ${currentViewMode.label}. Click to switch to ${nextViewMode.label}.`}
          className="rounded-[8px] text-primary hover:bg-background hover:text-primary"
          onClick={() => setViewMode(nextViewMode.value)}
        >
          <currentViewMode.icon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function ToolbarButton({
  className,
  pressed = false,
  ...props
}: React.ComponentProps<typeof Button> & {
  pressed?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground",
        pressed && "bg-muted text-foreground hover:bg-muted",
        className
      )}
      {...props}
    />
  );
}

export const kitToolbarPlugin = realmPlugin<{ showDiffMode?: boolean }>({
  init(realm, params) {
    const Toolbar = () => <MdxEditorToolbar showDiffMode={params?.showDiffMode ?? true} />;
    realm.pub(addTopAreaChild$, Toolbar);
  },
});
