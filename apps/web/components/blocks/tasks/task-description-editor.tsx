"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, EditorContext, useEditor, type JSONContent } from "@tiptap/react";
import { useMutation } from "convex/react";
import { toast } from "@/lib/toast";
import { Copy } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";

// --- Tiptap Core Extensions ---
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { Highlight } from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Selection } from "@tiptap/extensions";
import { Dropcursor } from "@tiptap/extensions";
import { Image } from "@tiptap/extension-image";
import { FileHandler } from "@tiptap/extension-file-handler";
import { getContentType } from "@/lib/tasks/files";
import { serializeTaskDescriptionDocAsMarkdown } from "@/lib/tasks/task-description-markdown";

// --- UI Primitives ---
import { Spacer } from "@/components/tiptap-ui-primitive/spacer";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/tiptap-ui-primitive/toolbar";

// --- Tiptap Node styles (installed template expects these globals) ---
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss";
import "@/components/tiptap-node/code-block-node/code-block-node.scss";
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss";
import "@/components/tiptap-node/list-node/list-node.scss";
import "@/components/tiptap-node/image-node/image-node.scss";
import "@/components/tiptap-node/heading-node/heading-node.scss";
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss";

// --- Tiptap UI ---
import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu";
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu";
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button";
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button";
import { ColorHighlightPopover } from "@/components/tiptap-ui/color-highlight-popover";
import { LinkPopover } from "@/components/tiptap-ui/link-popover";
import { MarkButton } from "@/components/tiptap-ui/mark-button";
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button";

import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/tiptap-ui-primitive/dropdown-menu";
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card";
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon";
import { ImagePlusIcon } from "@/components/tiptap-icons/image-plus-icon";

import {
  TextAlignButton,
  type TextAlign as TextAlignType,
  textAlignIcons,
} from "@/components/tiptap-ui/text-align-button";

import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";

type ProseMirrorDoc = {
  type: "doc";
  content?: unknown;
};

function selectImageNodeFromEvent(view: EditorView, event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;

  const img = target.closest("img");
  if (!img) return false;
  if (!view.dom.contains(img)) return false;

  // Ignore emoji images from the template.
  if (img.closest('[data-type="emoji"]')) return false;

  // Prefer coords-based lookup (more reliable than posAtDOM for atoms like images).
  // `dragstart` is a DragEvent (MouseEvent-like), so we only require clientX/clientY.
  if (
    !("clientX" in event) ||
    !("clientY" in event) ||
    typeof (event as { clientX?: unknown }).clientX !== "number" ||
    typeof (event as { clientY?: unknown }).clientY !== "number"
  ) {
    return false;
  }

  const { clientX, clientY } = event as { clientX: number; clientY: number };
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (!coords) return false;

  const { state, dispatch } = view;
  const candidates = [coords.inside, coords.pos, coords.pos - 1, coords.pos + 1].filter(
    (n): n is number => typeof n === "number" && n >= 0
  );

  let nodePos: number | null = null;
  for (const candidate of candidates) {
    const node = state.doc.nodeAt(candidate);
    if (node?.type?.name === "image") {
      nodePos = candidate;
      break;
    }
  }
  if (nodePos == null) return false;

  // Avoid redundant transactions.
  if (state.selection instanceof NodeSelection && state.selection.from === nodePos) return true;

  dispatch(state.tr.setSelection(NodeSelection.create(state.doc, nodePos)));
  return true;
}

function isProseMirrorDoc(value: unknown): value is ProseMirrorDoc {
  if (typeof value !== "object" || value === null) return false;
  const maybe = value as Record<string, unknown>;
  return maybe.type === "doc";
}

function parseDescriptionToDoc(value: string | null | undefined): JSONContent {
  const trimmed = value?.trim();
  if (!trimmed) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isProseMirrorDoc(parsed)) {
      return parsed as JSONContent;
    }
  } catch {
    // fall through to legacy plaintext handling
  }

  // Legacy plaintext: wrap into a single paragraph
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: trimmed }],
      },
    ],
  };
}

function serializeEditorContent(editor: { getJSON: () => JSONContent; isEmpty: boolean }): string | null {
  if (editor.isEmpty) return null;
  return JSON.stringify(editor.getJSON());
}

export function TaskDescriptionEditor(props: {
  value: string | null | undefined;
  onSave: (value: string | null) => void;
  disabled?: boolean;
  debounceMs?: number;
  placeholder?: string;
  className?: string;
  editorContentClassName?: string;
  showToolbar?: boolean;
  borderless?: boolean;
}) {
  const {
    value,
    onSave,
    disabled = false,
    // Long enough to sit through a normal typing pause; blur and unmount still
    // flush, so nothing waits on it. See docs/specs/task-activity-log.md#coalescing.
    debounceMs = 3000,
    placeholder = "What is this task about?",
    className,
    editorContentClassName,
    showToolbar = true,
    borderless = false,
  } = props;

  const generateUploadUrl = useMutation(api.tasks.attachments.generateTaskAttachmentUploadUrl);
  const registerPendingUpload = useMutation(api.tasks.attachments.registerPendingUploadedAttachment);

  const isFocusedRef = useRef(false);
  const isSettingContentRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isPickingImage, setIsPickingImage] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // undefined = no pending save; null = pending "clear description"; string = pending JSON string
  const pendingValueRef = useRef<string | null | undefined>(undefined);
  const lastSentValueRef = useRef<string | null>(value ?? null);

  // Only used for editor initialization. External changes are handled via the sync effect below.
  const [initialContent] = useState<JSONContent>(() => parseDescriptionToDoc(value));
  const [isAlignOpen, setIsAlignOpen] = useState(false);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingValueRef.current;
    pendingValueRef.current = undefined;

    // No pending save request
    if (pending === undefined) return;

    // Save "clear description"
    if (pending === null) {
      if (lastSentValueRef.current !== null) {
        lastSentValueRef.current = null;
        onSave(null);
      }
      return;
    }

    if (pending !== lastSentValueRef.current) {
      lastSentValueRef.current = pending;
      onSave(pending);
    }
  }, [onSave]);

  const scheduleSave = useCallback(
    (next: string | null) => {
      pendingValueRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        flush();
      }, debounceMs);
    },
    [debounceMs, flush]
  );

  const uploadImageAndGetUrl = useCallback(
    async (file: File): Promise<string> => {
      const contentType = getContentType(file);
      const uploadUrl = await generateUploadUrl({});

      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file,
      });

      if (!result.ok) {
        const errorText = await result.text();
        throw new Error(`Upload failed: ${result.status} - ${errorText}`);
      }

      const { storageId } = (await result.json()) as { storageId: Id<"_storage"> };
      // Registering claims the blob for this user (OS-1901) and returns its URL.
      const url = await registerPendingUpload({ storageId });
      if (!url) {
        throw new Error("Failed to get image URL");
      }
      return url;
    },
    [generateUploadUrl, registerPendingUpload]
  );

  const uploadDataUrlAndGetUrl = useCallback(
    async (dataUrl: string): Promise<string> => {
      // data:[<mime>][;base64],<data>
      const match = /^data:([^;,]+)(;base64)?,(.*)$/i.exec(dataUrl);
      const mime = match?.[1];
      const data = match?.[3];
      if (!mime || !data) {
        throw new Error("Unsupported clipboard image format");
      }
      if (!mime.startsWith("image/")) {
        throw new Error("Clipboard data URL is not an image");
      }

      const base64 = dataUrl.includes(";base64,");
      const raw = base64 ? atob(data) : decodeURIComponent(data);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      const ext = mime.split("/")[1] ?? "png";
      const file = new File([bytes], `pasted-image.${ext}`, { type: mime });
      return uploadImageAndGetUrl(file);
    },
    [uploadImageAndGetUrl]
  );

  const handlePickImage = useCallback(() => {
    // Keep toolbar button visually "active" while the native picker is open.
    setIsPickingImage(true);
    const handleFocus = () => {
      setIsPickingImage(false);
      window.removeEventListener("focus", handleFocus);
    };
    window.addEventListener("focus", handleFocus);
    imageInputRef.current?.click();
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Task description editor",
        "data-task-description-editor": "true",
        // Keep `tiptap` so the template's `.tiptap.ProseMirror` styles apply (incl. dropcursor positioning)
        class: "tiptap task-description-editor",
      },
      handleClick: (view, _pos, event) => {
        // Fallback path: if ProseMirror doesn't report the clicked node as "image",
        // still try to select based on the DOM target.
        return selectImageNodeFromEvent(view, event);
      },
      handleClickOn: (view, _pos, node, nodePos, event) => {
        if (node.type.name !== "image") return false;

        // Ignore emoji images from the template.
        const target = event.target;
        if (target instanceof Element && target.closest('[data-type="emoji"]')) return false;

        const { state, dispatch } = view;
        if (state.selection instanceof NodeSelection && state.selection.from === nodePos) return true;

        dispatch(state.tr.setSelection(NodeSelection.create(state.doc, nodePos)));
        // Returning true prevents ProseMirror from placing a text cursor on mouseup.
        return true;
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          // Only for primary button. Returning `false` keeps native drag behavior.
          if (event instanceof MouseEvent && event.button !== 0) return false;
          // Make the outline appear immediately before dragging starts.
          selectImageNodeFromEvent(view, event);
          return false;
        },
        dragstart: (view, event) => {
          // Backup: ensure selection is still set when the drag begins.
          selectImageNodeFromEvent(view, event);
          return false;
        },
      },
    },
    extensions: [
      // Keep StarterKit baseline aligned with server-side markdown normalization:
      // apps/web/convex/lib/mcp/taskDescription.ts
      StarterKit.configure({
        horizontalRule: false,
        dropcursor: false,
        link: {
          openOnClick: false,
          enableClickSelection: true,
        },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Image,
      Typography,
      Dropcursor.configure({
        color: "var(--tt-brand-color-500)",
        width: 2,
        class: "prosemirror-dropcursor",
      }),
      FileHandler.configure({
        // Don't enable drop handling here; the sidebar already owns file DnD.
        onPaste: async (ed, files, htmlContent) => {
          const imageFiles = files.filter((f) => f.type.startsWith("image/"));

          // 1) If the browser provides real File objects (e.g. screenshot paste), upload them.
          if (imageFiles.length > 0) {
            for (const file of imageFiles) {
              await toast.busy("Uploading image…", {
                description: file.name,
                errorMessage: "Image upload failed",
              }).then(async () => {
                const url = await uploadImageAndGetUrl(file);
                ed.chain().focus().setImage({ src: url }).run();
              });
            }
            return;
          }

          // 2) If paste comes as HTML <img src="data:..."> (common when copying images from browsers),
          // extract the data URL and upload it.
          const html = typeof htmlContent === "string" ? htmlContent : "";
          if (!html) return;

          try {
            const doc = new DOMParser().parseFromString(html, "text/html");
            const img = doc.querySelector("img");
            const src = img?.getAttribute("src");
            if (!src) return;

            if (src.startsWith("data:image/")) {
              await toast.busy("Uploading image…", {
                errorMessage: "Image paste failed",
              }).then(async () => {
                const url = await uploadDataUrlAndGetUrl(src);
                ed.chain().focus().setImage({ src: url }).run();
              });
              return;
            }

            // As a fallback, if we only have an http(s) URL, insert it directly.
            // (Fetching + re-uploading can fail due to CORS.)
            if (src.startsWith("http://") || src.startsWith("https://")) {
              ed.chain().focus().setImage({ src }).run();
            }
          } catch (err) {
            const message = getErrorMessage(err, String(err));
            toast.error("Image paste failed", { description: message });
          }
        },
      }),
      Selection,
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    onUpdate: ({ editor: ed }) => {
      if (isSettingContentRef.current) return;
      const serialized = serializeEditorContent(ed);
      scheduleSave(serialized);
    },
    onFocus: () => {
      isFocusedRef.current = true;
    },
    onBlur: () => {
      isFocusedRef.current = false;
      flush();
    },
  });

  const handleCopyMarkdown = useCallback(async () => {
    if (!editor) return;

    if (!navigator.clipboard?.writeText) {
      toast.error("Clipboard is unavailable");
      return;
    }

    try {
      const markdown = serializeTaskDescriptionDocAsMarkdown(editor.state.doc);
      await navigator.clipboard.writeText(markdown);
      toast.success("Description copied as markdown");
    } catch (err) {
      const message = getErrorMessage(err, String(err));
      toast.error("Markdown copy failed", { description: message });
    }
  }, [editor]);

  // Keep lastSentValueRef in sync with server value
  useEffect(() => {
    if (!isFocusedRef.current) {
      lastSentValueRef.current = value ?? null;
    }
  }, [value]);

  // If the server value changes externally while not focused, reflect it in the editor.
  useEffect(() => {
    if (!editor) return;
    if (isFocusedRef.current) return;

    const nextDoc = parseDescriptionToDoc(value);

    isSettingContentRef.current = true;
    editor.commands.setContent(nextDoc, { emitUpdate: false });
    isSettingContentRef.current = false;
  }, [editor, value]);

  // Flush any pending save on unmount.
  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  if (!editor) return null;

  const alignOptions: TextAlignType[] = ["left", "center", "right", "justify"];
  const currentAlign: TextAlignType =
    alignOptions.find((a) => editor.isActive({ textAlign: a })) ?? "left";
  const CurrentAlignIcon = textAlignIcons[currentAlign];
  const alignText: Record<TextAlignType, string> = {
    left: "Left",
    center: "Center",
    right: "Right",
    justify: "Justify",
  };

  return (
    <div
      className={cn(
        "tiptap-theme bg-background",
        borderless
          ? "rounded-none border-0 focus-within:border-0"
          : "rounded-lg border border-border focus-within:border-ring",
        disabled ? "opacity-80" : "",
        className
      )}
      data-vaul-no-drag
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          // Reset input so selecting the same file again works
          e.target.value = "";
          setIsPickingImage(false);
          if (!file) return;

          await toast.busy("Uploading image…", {
            description: file.name,
            errorMessage: "Image upload failed",
          }).then(async () => {
            const url = await uploadImageAndGetUrl(file);
            editor.chain().focus().setImage({ src: url }).run();
          });
        }}
      />

      <EditorContext.Provider value={{ editor }}>
        {showToolbar ? (
          <Toolbar
            variant="fixed"
            className="!sticky !top-0 !h-auto !border-t-0 !border-b !border-border rounded-t-lg"
          >
            <ToolbarGroup>
              <UndoRedoButton action="undo" />
              <UndoRedoButton action="redo" />
            </ToolbarGroup>

            <ToolbarSeparator />

            <ToolbarGroup>
              <HeadingDropdownMenu levels={[1, 2, 3, 4]} />
              <ListDropdownMenu types={["bulletList", "orderedList", "taskList"]} />
              <BlockquoteButton />
              <CodeBlockButton />
            </ToolbarGroup>

            <ToolbarSeparator />

            <ToolbarGroup>
              <MarkButton type="bold" />
              <MarkButton type="italic" />
              <MarkButton type="strike" />
              <MarkButton type="underline" />
              <ColorHighlightPopover />
              <LinkPopover />
              <Button
                type="button"
                data-style="ghost"
                role="button"
                tabIndex={-1}
                aria-label="Insert image"
                tooltip="Image"
                disabled={disabled}
                data-disabled={disabled}
                data-active-state={isPickingImage ? "on" : "off"}
                onPointerDown={(e) => {
                  // Match other toolbar buttons: don't steal focus from the editor.
                  e.preventDefault();
                }}
                onClick={(e) => {
                  if (e.defaultPrevented) return;
                  handlePickImage();
                }}
              >
                <ImagePlusIcon className="tiptap-button-icon" />
              </Button>
            </ToolbarGroup>

            <ToolbarSeparator />

            <ToolbarGroup>
              <DropdownMenu open={isAlignOpen} onOpenChange={setIsAlignOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    role="button"
                    tabIndex={-1}
                    aria-label="Text alignment"
                    tooltip="Alignment"
                    // Same fix as Heading/List: avoid pointer-up auto-select.
                    onPointerDown={(e) => {
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      // Let callers prevent open if they need.
                      if (e.defaultPrevented) return;
                      setIsAlignOpen((prev) => !prev);
                    }}
                  >
                    <CurrentAlignIcon className="tiptap-button-icon" />
                    <ChevronDownIcon className="tiptap-button-dropdown-small" />
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="start" portal={false}>
                  <Card>
                    <CardBody>
                      <ButtonGroup orientation="vertical">
                        {alignOptions.map((align) => (
                          <DropdownMenuItem key={align} asChild>
                            <TextAlignButton
                              editor={editor}
                              align={align}
                              text={alignText[align]}
                              showTooltip={false}
                            />
                          </DropdownMenuItem>
                        ))}
                      </ButtonGroup>
                    </CardBody>
                  </Card>
                </DropdownMenuContent>
              </DropdownMenu>
            </ToolbarGroup>

            <ToolbarSeparator />

            <ToolbarGroup>
              <Button
                type="button"
                data-style="ghost"
                role="button"
                tabIndex={-1}
                aria-label="Copy as markdown"
                tooltip="Copy as Markdown"
                onPointerDown={(e) => {
                  // Match other toolbar buttons: don't steal focus from the editor.
                  e.preventDefault();
                }}
                onClick={(e) => {
                  if (e.defaultPrevented) return;
                  void handleCopyMarkdown();
                }}
              >
                <Copy className="tiptap-button-icon" />
              </Button>
            </ToolbarGroup>

            <Spacer />
          </Toolbar>
        ) : null}

        <div
          className={cn(
            "min-h-30.25 cursor-text",
            showToolbar ? "border-t border-border" : "border-0"
          )}
          onMouseDown={(e) => {
            // ProseMirror only handles clicks that land inside its own DOM. The
            // surrounding padding / min-height area is part of the wrapper, so clicks
            // there never place a cursor. Forward those clicks to the editor.
            if (disabled) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest(".ProseMirror")) return;
            e.preventDefault();
            editor.chain().focus("end").run();
          }}
        >
          <EditorContent
            editor={editor}
            className={cn("p-3", editorContentClassName)}
          />
        </div>
      </EditorContext.Provider>
    </div>
  );
}
