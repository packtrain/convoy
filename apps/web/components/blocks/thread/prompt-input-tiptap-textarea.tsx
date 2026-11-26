"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEventHandler,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { RemoveScroll } from "react-remove-scroll";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Placeholder } from "@tiptap/extension-placeholder";
import { StarterKit } from "@tiptap/starter-kit";
import { File as FileIcon, Pencil, Sparkles, TerminalSquare } from "lucide-react";
import { POPOVER_SURFACE_CLASS } from "@/components/ui/popover";
import { usePromptInputAttachments, usePromptInputController } from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";
import { AppLink, type RouteTarget } from "@/lib/navigation";
import { serializeAttachmentReference, splitAttachmentReferences } from "@/lib/threads/message-attachments";
import { getFileIcon } from "@/lib/tasks/files";
import type {
  ComposerSlashCommandItem,
  SkillCatalogItem,
  SlashCommandCatalogItem,
  SlashCommandNodeAttrs,
  ThreadComposerDocument,
  ThreadComposerCommandRef,
} from "@/lib/slash-commands/composer";
import {
  buildSlashCommandMarkdownLink,
  createEmptyThreadComposerDocument,
  getSlashCommandMenuDescription,
  getSlashCommandMenuTitle,
  matchComposerSlashCommands,
} from "@/lib/slash-commands/composer";
import { useFileMentionSearch, type FileMentionContext } from "@/lib/threads/hooks/use-file-mention-search";
import { isRecord } from "@/lib/type-guards";
import { PromptInputSlashCommand } from "./prompt-input-slash-command-extension";
import { AttachmentFileMention, AttachmentReferenceProvider, AttachmentReferencePreview } from "./attachment-references";
import { SlashCommandPreview, useSlashCommandPreview } from "./slash-command-preview";

interface SuggestionState {
  /** Which trigger is active: `/` commands or `@` file mentions (OS-1144). */
  kind: "slash" | "file" | "attachment";
  anchor: {
    left: number;
    /** Caret line top (used when the menu flips above the caret). */
    top: number;
    /** Caret line bottom (used when the menu opens below the caret). */
    bottom: number;
  };
  range: {
    from: number;
    to: number;
  };
  query: string;
}

/** Imperative editor access for callers outside the component (OS-1159). */
export interface PromptInputMentionApi {
  /** Append an `@path` mention pill to the end of the draft and focus. */
  insertFileMention: (path: string) => void;
  focus: () => void;
}

export interface PromptInputTiptapTextareaProps {
  pendingAttachments?: readonly { filePartId?: string; status: "uploading" | "uploaded" | "error"; error?: string }[];
  placeholder?: string;
  disabled?: boolean;
  /** Take focus on mount and each time the editor becomes enabled. */
  autoFocus?: boolean;
  className?: string;
  slashCommands?: ComposerSlashCommandItem[];
  /** Settings page of a Prompt the viewer can edit, or null (OS-2428). */
  getPromptEditHref?: (item: SlashCommandCatalogItem) => RouteTarget | null;
  /** Enables @-file-mention autocomplete against this profile/path (OS-1144). */
  fileMention?: FileMentionContext | null;
  /** Receives the imperative mention API while mounted (OS-1159). */
  mentionApiRef?: RefObject<PromptInputMentionApi | null>;
  onChange?: (value: string) => void;
  onComposerDocumentChange?: (document: ThreadComposerDocument) => void;
  initialContent?: JSONContent | string;
  onEditorContentChange?: (content: JSONContent) => void;
  onAutoSubmit?: () => void;
}

/** Menu items carry `scope`, stored refs carry `type`; this is where the two meet. */
function attrsFromCommand(command: SlashCommandCatalogItem | SkillCatalogItem): SlashCommandNodeAttrs {
  const { key, canonicalKey, displayLabel } = command;

  if (command.scope === "skill") {
    return { type: "skill", id: command.id, scope: "skill", key, canonicalKey, displayLabel };
  }

  return { type: "slash-command", id: command.id, scope: command.scope, key, canonicalKey, displayLabel };
}

function isSlashCommandAttrs(attrs: unknown): attrs is SlashCommandNodeAttrs {
  if (!attrs || typeof attrs !== "object") {
    return false;
  }

  const record = attrs as Record<string, unknown>;
  const scope = record.scope;
  const isKnownKind =
    record.type === "skill"
      ? scope === "skill"
      : record.type === "slash-command" && (scope === "organization" || scope === "project" || scope === "personal");

  return (
    isKnownKind &&
    typeof record.id === "string" &&
    typeof record.key === "string" &&
    typeof record.canonicalKey === "string" &&
    typeof record.displayLabel === "string"
  );
}

function serializeNode(node: JSONContent, refs: ThreadComposerCommandRef[]): string {
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "slashCommand": {
      if (isSlashCommandAttrs(node.attrs)) {
        refs.push(node.attrs);
        return buildSlashCommandMarkdownLink(node.attrs);
      }
      return "";
    }
    case "fileMention": {
      // Inline `@path` text — Claude Code / Codex resolve it natively.
      const path = isRecord(node.attrs) && typeof node.attrs.path === "string" ? node.attrs.path : "";
      return path ? node.attrs?.kind === "attachment" ? serializeAttachmentReference(path) : `@${path}` : "";
    }
    case "paragraph":
      return (node.content ?? []).map((child) => serializeNode(child, refs)).join("");
    case "doc":
      return (node.content ?? []).map((child) => serializeNode(child, refs)).join("\n");
    default:
      return (node.content ?? []).map((child) => serializeNode(child, refs)).join("");
  }
}

/**
 * Tiptap parses plain strings as HTML, which collapses "\n" into spaces —
 * build an explicit paragraph-per-line doc so multiline text (persisted
 * drafts, the artifact-comments handoff) keeps its line structure. Inverse
 * of serializeNode's doc-level "\n" join, so text round-trips.
 */
function plainTextToDoc(text: string, files: readonly { id: string; filename?: string }[] = []): JSONContent {
  const filenames = files.flatMap(file => file.filename ? [file.filename] : []);
  return {
    type: "doc",
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? {
        content: splitAttachmentReferences(line, filenames).map(part => {
          if (part.type === "text") return { type: "text", text: part.value };
          const file = files.find(file => file.filename === part.filename)!;
          return { type: "fileMention", attrs: { kind: "attachment", attachmentId: file.id, path: part.filename } };
        }),
      } : {}),
    })),
  };
}

function serializeComposerDocument(json: JSONContent): {
  text: string;
  document: ThreadComposerDocument;
} {
  const refs: ThreadComposerCommandRef[] = [];
  const text = serializeNode(json, refs);

  return {
    text,
    document: {
      version: 1,
      refs,
    },
  };
}

/**
 * Leaf placeholder for the trigger/autosubmit text reads. Atom pills
 * (slash commands, file mentions) collapse to U+FFFC so they count as real
 * non-whitespace content, but a `Shift+Enter` hard break must read as
 * whitespace — it lives inside the paragraph, so mapping it to U+FFFC made
 * both triggers inert on every continuation line (OS-1601).
 */
function suggestionLeafText(leafNode: ProseMirrorNode): string {
  return leafNode.type.name === "hardBreak" ? "\n" : "\uFFFC";
}

function attachmentNames(doc: ProseMirrorNode): string[] {
  const names: string[] = [];
  doc.descendants(node => {
    if (node.type.name === "fileMention" && node.attrs.kind === "attachment") names.push(node.attrs.path);
  });
  return names;
}

function getCaretAnchor(editor: NonNullable<ReturnType<typeof useEditor>>): SuggestionState["anchor"] {
  try {
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    return { left: coords.left, top: coords.top, bottom: coords.bottom };
  } catch {
    const editorRect = editor.view.dom.getBoundingClientRect();
    return {
      left: editorRect.left,
      top: editorRect.top,
      bottom: editorRect.bottom,
    };
  }
}

function getSuggestionPosition(suggestion: SuggestionState | null, menuItemCount: number): CSSProperties | null {
  if (!suggestion || typeof window === "undefined") {
    return null;
  }

  const maxWidth = 520;
  const viewportPadding = 12;
  const maxHeight = 280;
  // h-8 rows + container padding; the empty state is a single short row.
  const estimatedHeight = Math.min(menuItemCount > 0 ? menuItemCount * 33 + 10 : 44, maxHeight);
  // The composer usually sits at the bottom of the viewport, so flip the
  // menu above the caret when it would be trimmed by the screen edge.
  const spaceBelow = window.innerHeight - suggestion.anchor.bottom - viewportPadding;
  const openUp = spaceBelow < estimatedHeight;

  return {
    left: Math.max(viewportPadding, Math.min(suggestion.anchor.left - 12, window.innerWidth - maxWidth - viewportPadding)),
    ...(openUp ? { bottom: window.innerHeight - suggestion.anchor.top + 6 } : { top: suggestion.anchor.bottom + 6 }),
    width: maxWidth,
    maxHeight,
  };
}

function getSuggestionState(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  fileMentionEnabled: boolean
): SuggestionState | null {
  if (!editor.state.selection.empty) {
    return null;
  }

  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock) {
    return null;
  }

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, suggestionLeafText);

  const slashMatch = /(?:^|\s)(\/[a-z0-9:-]*)$/.exec(textBefore.toLowerCase());
  if (slashMatch) {
    const token = slashMatch[1];

    return {
      kind: "slash",
      anchor: getCaretAnchor(editor),
      query: token.slice(1),
      range: {
        from: editor.state.selection.from - token.length,
        to: editor.state.selection.from,
      },
    };
  }

  const attachmentMatch = /(?:^|\s)(#[^\s#]*)$/.exec(textBefore);
  if (attachmentMatch) {
    const token = attachmentMatch[1];
    return { kind: "attachment", anchor: getCaretAnchor(editor), query: token.slice(1), range: { from: editor.state.selection.from - token.length, to: editor.state.selection.from } };
  }

  if (fileMentionEnabled) {
    // Raw-case match: file paths are case-sensitive-ish; the CLI search
    // lowercases for matching, but the token keeps what the user typed.
    const match = /(?:^|\s)(@[^\s@]*)$/.exec(textBefore);
    if (match) {
      const token = match[1];
      return {
        kind: "file",
        anchor: getCaretAnchor(editor),
        query: token.slice(1),
        range: {
          from: editor.state.selection.from - token.length,
          to: editor.state.selection.from,
        },
      };
    }
  }

  return null;
}

function hasOnlySuggestionText(editor: NonNullable<ReturnType<typeof useEditor>>, range: SuggestionState["range"]): boolean {
  const { doc } = editor.state;
  const before = doc.textBetween(0, range.from, "\n", suggestionLeafText);
  const after = doc.textBetween(range.to, doc.content.size, "\n", suggestionLeafText);
  return before.trim().length === 0 && after.trim().length === 0;
}

export function PromptInputTiptapTextarea({
  pendingAttachments = [],
  placeholder = "What would you like to know?",
  disabled = false,
  autoFocus = false,
  className,
  slashCommands = [],
  getPromptEditHref,
  fileMention = null,
  mentionApiRef,
  onChange,
  onComposerDocumentChange,
  initialContent,
  onEditorContentChange,
  onAutoSubmit,
}: PromptInputTiptapTextareaProps) {
  const controller = usePromptInputController();
  const attachments = usePromptInputAttachments();
  const attachmentsRef = useRef(attachments);
  useLayoutEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const editorClassName = useMemo(
    () =>
      cn(
        // Fade matches py-4 so unscrolled text is untouched; scrolled text fades out through the padding instead of hard-clipping at the pills/footer.
        // The !important paragraph overrides beat paragraph-node.scss's
        // `.tiptap.ProseMirror p:not(:first-child)` (1rem + 20px margin),
        // which would render seeded multiline drafts with mixed sizes/gaps.
        "min-h-16 max-h-48 w-full select-text overflow-y-auto px-4 py-4 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-16px),transparent)] text-sm leading-6 text-foreground outline-none [&_p]:!mt-0 [&_p]:!text-sm [&_p]:!leading-6 selection:bg-primary/30 selection:text-foreground disabled:cursor-not-allowed disabled:opacity-50 [&_*::selection]:bg-primary/30 [&_*::selection]:text-foreground [&>p.is-editor-empty:first-child::before]:pointer-events-none [&>p.is-editor-empty:first-child::before]:float-left [&>p.is-editor-empty:first-child::before]:h-0 [&>p.is-editor-empty:first-child::before]:!text-muted-foreground [&>p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
        className
      ),
    [className]
  );
  const editorId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [autoSubmitRequest, setAutoSubmitRequest] = useState(0);
  const consumedAutoSubmitRequestRef = useRef(0);
  const suggestionRef = useRef<SuggestionState | null>(null);
  const activeIndexRef = useRef(0);
  const editorRef = useRef<NonNullable<ReturnType<typeof useEditor>> | null>(null);
  const lastSyncedTextRef = useRef(controller.textInput.value);
  const slashCommandsRef = useRef(slashCommands);
  const skipInitialProviderSyncRef = useRef(initialContent !== undefined && typeof initialContent !== "string");
  const shouldHydrateInitialDocumentRef = useRef(initialContent !== undefined && typeof initialContent !== "string");

  // File suggestions load async from the connected CLI; results live outside
  // the (synchronous) suggestion state and are mirrored into a ref for the
  // keyboard handler.
  const fileMentionEnabled = fileMention?.isProfileOnline === true;
  const fileMentionEnabledRef = useRef(fileMentionEnabled);
  const fileQuery = suggestion?.kind === "file" ? suggestion.query : null;
  const { files: fileResults, isLoading: isFileSearchLoading } = useFileMentionSearch(fileMention, fileQuery);
  const fileResultsRef = useRef(fileResults);

  useEffect(() => {
    slashCommandsRef.current = slashCommands;
  }, [slashCommands]);

  useEffect(() => {
    fileMentionEnabledRef.current = fileMentionEnabled;
  }, [fileMentionEnabled]);

  useEffect(() => {
    fileResultsRef.current = fileResults;
  }, [fileResults]);

  const selectCommand = useCallback(
    (command: ComposerSlashCommandItem) => {
      const currentSuggestion = suggestionRef.current;
      if (!currentSuggestion) {
        return;
      }
      const currentEditor = editorRef.current;
      if (!currentEditor) {
        return;
      }

      // Runtime commands opt in per name (`/compact` — no arguments to type),
      // stored prompts opt in via their autoSubmit setting (OS-1614).
      const shouldAutoSubmit =
        command.autoSubmit && onAutoSubmit !== undefined && hasOnlySuggestionText(currentEditor, currentSuggestion.range);

      // Runtime commands always insert their literal text (`/compact `);
      // there is no stored content to expand and no ref node to resolve.
      let didInsert = false;
      if (command.scope === "runtime" || command.autoExpand) {
        didInsert = currentEditor.chain().focus().deleteRange(currentSuggestion.range).insertContent(command.content).insertContent(" ").run();
      } else {
        didInsert = currentEditor
          .chain()
          .focus()
          .deleteRange(currentSuggestion.range)
          .insertSlashCommand(attrsFromCommand(command))
          .insertContent(" ")
          .run();
      }

      if (shouldAutoSubmit && didInsert) {
        setAutoSubmitRequest((request) => request + 1);
      }
    },
    [onAutoSubmit]
  );

  useEffect(() => {
    if (autoSubmitRequest === 0 || consumedAutoSubmitRequestRef.current === autoSubmitRequest) {
      return;
    }

    consumedAutoSubmitRequestRef.current = autoSubmitRequest;
    onAutoSubmit?.();
  }, [autoSubmitRequest, onAutoSubmit]);

  const selectFile = useCallback((path: string) => {
    const currentSuggestion = suggestionRef.current;
    if (!currentSuggestion) {
      return;
    }

    editorRef.current
      ?.chain()
      .focus()
      .deleteRange(currentSuggestion.range)
      .insertFileMention({ type: "file-mention", path })
      .insertContent(" ")
      .run();
  }, []);

  const selectAttachment = useCallback((id: string) => {
    const suggestion = suggestionRef.current;
    const file = attachmentsRef.current.files.find(file => file.id === id);
    if (!suggestion || !file) return;
    editorRef.current?.chain().focus().deleteRange(suggestion.range).insertContent([
      { type: "fileMention", attrs: { kind: "attachment", attachmentId: file.id, path: file.filename ?? "attachment" } },
      { type: "text", text: " " },
    ]).run();
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        listItem: false,
        orderedList: false,
        strike: false,
      }),
      // Keep global rich-text .is-empty styles out of the composer (OS-2045).
      Placeholder.configure({ placeholder, emptyNodeClass: "thread-composer-empty-node" }),
      PromptInputSlashCommand,
      AttachmentFileMention,
    ],
    content: typeof initialContent === "object" ? initialContent : plainTextToDoc(initialContent ?? controller.textInput.value ?? "", attachments.files),
    editorProps: {
      handleDOMEvents: { drop: (_view, event) => (event.dataTransfer?.files.length ?? 0) > 0 },
      attributes: {
        class: editorClassName,
        "aria-label": "Message",
        "aria-placeholder": placeholder,
        "aria-disabled": disabled ? "true" : "false",
        "data-thread-composer-editor": "true",
        "data-disabled": disabled ? "true" : "false",
        "data-slot": "input-group-control",
        id: editorId,
        placeholder,
        role: "textbox",
        spellcheck: "true",
        ...(disabled ? { disabled: "true" } : {}),
      },
      handleKeyDown: (_view, event) => {
        if (isComposing || event.isComposing) return false;
        const currentSuggestion = suggestionRef.current;
        const attachmentItems = currentSuggestion?.kind === "attachment" ? attachmentsRef.current.files.filter(file => (file.filename ?? "attachment").toLowerCase().includes(currentSuggestion.query.toLowerCase())) : [];
        // Matches are derived, not stored, so a catalog that resolves while the
        // menu is open is already reflected here.
        const slashItems =
          currentSuggestion?.kind === "slash"
            ? matchComposerSlashCommands(slashCommandsRef.current, currentSuggestion.query)
            : [];
        const menuLength = currentSuggestion
          ? currentSuggestion.kind === "file"
            ? fileResultsRef.current.length
            : currentSuggestion.kind === "attachment" ? attachmentItems.length : slashItems.length
          : 0;
        if (currentSuggestion && menuLength > 0) {
          switch (event.key) {
            case "ArrowDown":
              event.preventDefault();
              setActiveIndex((index) => {
                const nextIndex = (index + 1) % menuLength;
                activeIndexRef.current = nextIndex;
                return nextIndex;
              });
              return true;
            case "ArrowUp":
              event.preventDefault();
              setActiveIndex((index) => {
                const nextIndex = (index - 1 + menuLength) % menuLength;
                activeIndexRef.current = nextIndex;
                return nextIndex;
              });
              return true;
            case "Enter":
            case "Tab": {
              event.preventDefault();
              if (currentSuggestion.kind === "attachment") {
                const file = attachmentItems[activeIndexRef.current] ?? attachmentItems[0];
                if (file) selectAttachment(file.id);
                return true;
              }
              if (currentSuggestion.kind === "file") {
                const path = fileResultsRef.current[activeIndexRef.current] ?? fileResultsRef.current[0];
                if (path) {
                  selectFile(path);
                }
                return true;
              }
              const item = slashItems[activeIndexRef.current] ?? slashItems[0];
              if (item) {
                selectCommand(item);
              }
              return true;
            }
            case "Escape":
              event.preventDefault();
              suggestionRef.current = null;
              setSuggestion(null);
              return true;
          }
        }

        if (event.key === "Enter") {
          if (isComposing || event.isComposing) {
            return false;
          }
          // Touch keyboards have no Shift+Enter, so Enter adds a line and the send button submits (OS-2152).
          if (event.shiftKey || window.matchMedia?.("(pointer: coarse)").matches) {
            event.preventDefault();
            return editorRef.current?.chain().setHardBreak().scrollIntoView().run() ?? false;
          }

          event.preventDefault();
          const form = editorRef.current?.view.dom.closest("form");
          const submitButton = form?.querySelector('button[type="submit"]') as HTMLButtonElement | null;
          if (!submitButton?.disabled) {
            form?.requestSubmit();
          }
          return true;
        }

        if (event.key === "Backspace" && controller.textInput.value === "" && attachments.files.length > 0) {
          event.preventDefault();
          const lastAttachment = attachments.files.at(-1);
          if (lastAttachment) {
            attachments.remove(lastAttachment.id);
          }
          return true;
        }

        return false;
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      attachmentsRef.current.reserveNames?.(attachmentNames(updatedEditor.state.doc));
      const serialized = serializeComposerDocument(updatedEditor.getJSON());
      lastSyncedTextRef.current = serialized.text;
      if (typeof controller.textInput.setInput === "function") {
        controller.textInput.setInput(serialized.text);
      }
      onChange?.(serialized.text);
      onComposerDocumentChange?.(serialized.document);
      onEditorContentChange?.(updatedEditor.getJSON());
    },
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      const nextSuggestion = getSuggestionState(updatedEditor, fileMentionEnabledRef.current);
      suggestionRef.current = nextSuggestion;
      setSuggestion(nextSuggestion);
      if (!nextSuggestion) {
        activeIndexRef.current = 0;
        setActiveIndex(0);
      }
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // "Mention in reply" from the Changes card (OS-1159): append the pill to
  // the end of the current draft with a separating space, and focus.
  useEffect(() => {
    if (!mentionApiRef) {
      return;
    }
    mentionApiRef.current = {
      insertFileMention: (path: string) => {
        const currentEditor = editorRef.current;
        if (!currentEditor) {
          return;
        }
        const text = currentEditor.getText();
        const chain = currentEditor.chain().focus("end");
        if (text.length > 0 && !/\s$/.test(text)) {
          chain.insertContent(" ");
        }
        chain.insertFileMention({ type: "file-mention", path }).insertContent(" ").run();
      },
      focus: () => editorRef.current?.commands.focus("end"),
    };
    return () => {
      mentionApiRef.current = null;
    };
  }, [mentionApiRef]);

  useEffect(() => {
    if (!editor || !shouldHydrateInitialDocumentRef.current) {
      return;
    }

    attachmentsRef.current.reserveNames?.(attachmentNames(editor.state.doc));
    shouldHydrateInitialDocumentRef.current = false;
    const serialized = serializeComposerDocument(editor.getJSON());
    lastSyncedTextRef.current = serialized.text;
    if (typeof controller.textInput.setInput === "function") {
      controller.textInput.setInput(serialized.text);
    }
    onChange?.(serialized.text);
    onComposerDocumentChange?.(serialized.document);
  }, [controller.textInput, editor, onChange, onComposerDocumentChange]);

  useEffect(() => {
    editor?.view.dom.setAttribute("class", `tiptap ProseMirror ${editorClassName}`);
  }, [editor, editorClassName]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    // Suppress the update event: setEditable emits one by default, and the
    // post-submit re-enable would re-serialize the not-yet-cleared content
    // into the draft (stale draft restored on refresh).
    editor.setEditable(!disabled, false);
  }, [disabled, editor]);

  // commands.focus waits a frame, so React has finished placing the editor DOM;
  // a DOM .focus() during mount is lost when StrictMode re-attaches it.
  useEffect(() => {
    if (autoFocus && editor && !disabled) {
      editor.commands.focus("end");
    }
  }, [autoFocus, disabled, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (skipInitialProviderSyncRef.current) {
      skipInitialProviderSyncRef.current = false;
      return;
    }
    const providerText = controller.textInput.value;
    if (providerText === lastSyncedTextRef.current) {
      return;
    }

    lastSyncedTextRef.current = providerText;
    editor.commands.setContent(plainTextToDoc(providerText || "", attachmentsRef.current.files), {
      emitUpdate: false,
    });
    onComposerDocumentChange?.(createEmptyThreadComposerDocument());
  }, [controller.textInput.value, editor, onComposerDocumentChange]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const syncSuggestion = () => {
      const nextSuggestion = getSuggestionState(editor, fileMentionEnabledRef.current);
      suggestionRef.current = nextSuggestion;
      setSuggestion(nextSuggestion);
    };

    // The menu is portalled to document.body, so a focus-out that leaves this
    // composer mounted (the group "+", a panel tab overlaying the thread
    // column) would leave it floating over the incoming surface (OS-1679).
    // Item clicks preventDefault on mousedown, so selecting never blurs.
    const clearSuggestion = () => {
      suggestionRef.current = null;
      setSuggestion(null);
    };

    editor.on("update", syncSuggestion);
    editor.on("blur", clearSuggestion);
    return () => {
      editor.off("update", syncSuggestion);
      editor.off("blur", clearSuggestion);
    };
  }, [editor]);

  const handlePaste: ClipboardEventHandler<HTMLDivElement> = (event) => {
    if (disabled) return;
    const items = event.clipboardData?.items;
    if (!items) {
      return;
    }

    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const accepted = attachments.add(files);
      if (accepted?.length && editor) {
        editor.chain().command(({ tr }) => { closeHistory(tr); return true; }).insertContent(accepted.flatMap(file => [
          { type: "fileMention", attrs: { kind: "attachment", attachmentId: file.id, path: file.filename ?? "attachment" } },
          { type: "text", text: " " },
        ])).run();
        editor.view.dispatch(closeHistory(editor.state.tr));
      }
    }
  };

  // Derived, not stored: the two catalogs (Prompts, Skills) resolve independently,
  // and a list snapshotted at keystroke time would stay stale until the next one.
  const slashItems = useMemo(
    () => (suggestion?.kind === "slash" ? matchComposerSlashCommands(slashCommands, suggestion.query) : []),
    [slashCommands, suggestion]
  );
  const attachmentItems = suggestion?.kind === "attachment" ? attachments.files.filter(file => (file.filename ?? "attachment").toLowerCase().includes(suggestion.query.toLowerCase())) : [];
  const menuItemCount = suggestion?.kind === "file" ? fileResults.length : suggestion?.kind === "attachment" ? attachmentItems.length : slashItems.length;

  // Attached to the active row so keyboard navigation keeps it visible
  // inside the scrollable menu.
  const activeItemRef = (node: HTMLButtonElement | null) => {
    // Guarded: jsdom has no scrollIntoView.
    if (typeof node?.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  };

  const suggestionPosition = getSuggestionPosition(suggestion, menuItemCount);

  // An empty catalog shows nothing rather than an empty menu: a composer with no
  // Prompts, Skills, or agent commands has nothing to suggest behind `/`.
  const isMenuOpen = suggestion !== null && (suggestion.kind === "attachment" ? attachmentItems.length > 0 : suggestion.kind === "file" || slashCommands.length > 0);
  const slashPreview = useSlashCommandPreview(isMenuOpen && suggestion?.kind === "slash" ? slashItems : null);
  const suggestionMenu =
    suggestion && suggestionPosition && isMenuOpen ? (
      // pointer-events-auto: the menu is portalled to document.body, which a
      // modal Radix Dialog sets to pointer-events:none (e.g. the project-agent
      // automation dialogs, OS-1094) — without it clicks fall through.
      // RemoveScroll lifts that dialog's (or a drawer's) scroll lock the same way (OS-2198).
      <RemoveScroll
        noIsolation
        removeScrollBar={false}
        allowPinchZoom
        className={cn(POPOVER_SURFACE_CLASS, "pointer-events-auto fixed z-[100] overflow-y-auto p-1")}
        style={suggestionPosition}
      >
        {suggestion.kind === "attachment" ? (
          <div className="flex flex-col gap-px">{attachmentItems.map((file, index) => {
            const Icon = getFileIcon(file.mediaType);
            return (
            <AttachmentReferencePreview key={file.id} file={file}>
            <button type="button" ref={index === activeIndex ? activeItemRef : undefined}
              className={cn("flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm", index === activeIndex ? "bg-muted/80 text-foreground" : "text-muted-foreground hover:bg-muted/60")}
              onMouseDown={event => event.preventDefault()} onClick={() => selectAttachment(file.id)}>
              <Icon className="size-4 shrink-0" /><span className="truncate">{file.filename ?? "attachment"}</span>
            </button>
            </AttachmentReferencePreview>
          ); })}</div>
        ) : suggestion.kind === "file" ? (
          fileResults.length > 0 ? (
            <div className="flex flex-col gap-px">
              {fileResults.map((path, index) => {
                const lastSlash = path.lastIndexOf("/");
                const dir = lastSlash === -1 ? "" : path.slice(0, lastSlash + 1);
                const base = lastSlash === -1 ? path : path.slice(lastSlash + 1);
                return (
                  <button
                    key={path}
                    ref={index === activeIndex ? activeItemRef : undefined}
                    type="button"
                    className={cn(
                      "flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors",
                      index === activeIndex
                        ? "bg-muted/80 text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectFile(path)}
                  >
                    <FileIcon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-foreground">{base}</span>
                      {dir ? <span className="ml-2 text-muted-foreground">{dir}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md px-2.5 py-2 text-sm text-muted-foreground">
              {isFileSearchLoading ? "Searching files…" : "No files found"}
            </div>
          )
        ) : slashItems.length > 0 ? (
          <div className="flex flex-col gap-px" data-slash-command-menu onPointerLeave={slashPreview.leave}>
            {slashItems.map((item, index) => {
              const editHref = item.scope === "runtime" || item.scope === "skill" ? null : getPromptEditHref?.(item) ?? null;
              return (
                <div key={item.canonicalKey} className="group relative">
                  <button
                    ref={index === activeIndex ? activeItemRef : undefined}
                    type="button"
                    // Prompts get the preview card instead; agent commands and Skills
                    // keep the native title (docs/specs/slash-commands.md#composer-behavior).
                    title={item.scope === "runtime" || item.scope === "skill" ? getSlashCommandMenuTitle(item) : undefined}
                    onPointerEnter={(event) => slashPreview.hover(item, event.currentTarget)}
                    className={cn(
                      "flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors",
                      index === activeIndex ? "bg-muted/80 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectCommand(item)}
                  >
                    {/* Skill rows carry the same accent as the sent mention (docs/specs/skills.md#trigger-and-appearance). */}
                    {item.scope === "skill" ? (
                      <Sparkles className="size-4 shrink-0 text-violet-600 dark:text-violet-400" />
                    ) : (
                      <TerminalSquare className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      <span className={cn("font-medium", item.scope === "skill" ? "text-violet-600 dark:text-violet-400" : "text-foreground")}>
                        {item.displayLabel}
                      </span>
                      {/* The runtime's own argument hint, dimmed after the name the
                          way the agent's own input renders it (OS-1806). */}
                      {item.scope === "runtime" && item.argumentHint ? (
                        <span className="ml-1.5 text-muted-foreground/70">{item.argumentHint}</span>
                      ) : null}
                      <span className="ml-2 text-muted-foreground">{getSlashCommandMenuDescription(item)}</span>
                    </span>
                    {item.scope === "skill" || item.scope === "project" || item.scope === "organization" ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                          editHref && "group-hover:invisible",
                          item.scope === "skill" ? "border-violet-600/40 text-violet-600 dark:border-violet-400/40 dark:text-violet-400" : "border-border text-muted-foreground"
                        )}
                      >
                        {item.scope === "skill" ? "Skill" : item.scope === "project" ? "Project" : "Organization"}
                      </span>
                    ) : null}
                  </button>
                  {/* A sibling, not a child: a link can't nest in the row's button. */}
                  {editHref ? (
                    <AppLink
                      href={editHref}
                      aria-label={`Edit ${item.displayLabel}`}
                      title="Edit prompt"
                      className="absolute right-2 top-1/2 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        suggestionRef.current = null;
                        setSuggestion(null);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </AppLink>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          // Prompts, agent commands and Skills all live behind `/`.
          <div className="rounded-md px-2.5 py-2 text-sm text-muted-foreground">No results found</div>
        )}
      </RemoveScroll>
    ) : null;

  return (
    <AttachmentReferenceProvider value={pendingAttachments}>
      <div
        className={cn(
          // Accents are keyed off mutually exclusive kinds, so neither rule has to
          // out-specify the other.
          "relative w-full [&_span[data-slash-command-kind=command]]:text-info [&_span[data-slash-command-kind=skill]]:text-violet-600 dark:[&_span[data-slash-command-kind=skill]]:text-violet-400 [&_span[data-slash-command]]:mx-0.5 [&_span[data-slash-command]]:inline-flex [&_span[data-slash-command]]:items-center [&_span[data-slash-command]]:align-baseline [&_span[data-slash-command]]:font-medium [&_span[data-file-mention]]:mx-0.5 [&_span[data-file-mention]]:inline-flex [&_span[data-file-mention]]:items-center [&_span[data-file-mention]]:align-baseline [&_span[data-file-mention]]:font-medium [&_span[data-file-mention]]:text-info",
          disabled && "pointer-events-none opacity-50"
        )}
        onCompositionEnd={() => setIsComposing(false)}
        onCompositionStart={() => setIsComposing(true)}
        onPasteCapture={handlePaste}
      >
        <EditorContent editor={editor} />
      </div>

      {suggestionMenu && typeof document !== "undefined" ? createPortal(suggestionMenu, document.body) : null}
      <SlashCommandPreview
        preview={slashPreview.preview}
        onPointerEnter={slashPreview.stay}
        onPointerLeave={slashPreview.leave}
        onClose={slashPreview.close}
      />
    </AttachmentReferenceProvider>
  );
}
