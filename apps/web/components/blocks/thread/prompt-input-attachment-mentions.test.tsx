/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useEffect } from "react";
import { getFunctionName } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { useThreadMessageAttachmentUpload } from "@/lib/threads/hooks/use-thread-message-attachment-upload";
import type { Editor } from "@tiptap/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  PromptInput,
  PromptInputProvider,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { dedupeAttachmentFileName } from "@/lib/threads/message-attachments";
import { PromptInputTiptapTextarea } from "./prompt-input-tiptap-textarea";

vi.mock("@/lib/threads/hooks/use-file-mention-search", () => ({ useFileMentionSearch: () => ({ files: [], isLoading: false }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const generateUploadUrl = vi.fn(async () => "https://upload.test");
const completeMutation = vi.fn(async () => null);
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith("generateMessageAttachmentUploadUrl") ? generateUploadUrl : completeMutation,
}));
let attachmentApi: ReturnType<typeof usePromptInputAttachments>;
let controllerApi: ReturnType<typeof usePromptInputController>;
function Files() {
  const controller = usePromptInputController();
  const attachments = usePromptInputAttachments();
  useEffect(() => {
    controllerApi = controller;
    attachmentApi = attachments;
  }, [controller, attachments]);
  return (
    <>
      {attachments.files.map((file) => (
        <button key={file.id} onClick={() => attachments.remove(file.id)}>
          Remove {file.filename}
        </button>
      ))}
    </>
  );
}
async function setup(options: Partial<Parameters<typeof PromptInputTiptapTextarea>[0]> = {}) {
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  const onChange = vi.fn();
  const tree = (props: typeof options) => (
    <PromptInputProvider>
      <PromptInput nameFile={dedupeAttachmentFileName} onSubmit={vi.fn()} maxFiles={2}>
        <Files />
        <PromptInputTiptapTextarea {...props} onChange={onChange} />
      </PromptInput>
    </PromptInputProvider>
  );
  const view = render(tree(options));
  const textbox = await screen.findByRole("textbox", { name: "Message" });
  const editor = (textbox as HTMLElement & { editor: Editor }).editor;
  return { ...view, textbox, editor, onChange, update: (props: typeof options) => view.rerender(tree({ ...options, ...props })) };
}
function paste(textbox: HTMLElement, files: File[]) {
  fireEvent.paste(textbox, {
    clipboardData: { getData: () => "", types: ["Files"], items: files.map((file) => ({ kind: "file", getAsFile: () => file })) },
  });
}
test("paste inserts accepted file references at the selection with pending state", async () => {
  const { textbox, editor, onChange } = await setup();
  act(() => {
    editor.commands.setContent("before after");
    editor.commands.setTextSelection(8);
  });
  paste(textbox, [
    new File(["a"], "image.png", { type: "image/png" }),
    new File(["b"], "notes.pdf", { type: "application/pdf" }),
    new File(["c"], "rejected.txt"),
  ]);
  expect(onChange).toHaveBeenLastCalledWith("before #image.png #notes.pdf after");
  expect(textbox.querySelectorAll('[data-attachment-state="uploading"]')).toHaveLength(2);
  expect(screen.queryByText("Remove rejected.txt")).toBeNull();
  fireEvent.click(screen.getByText("Remove image.png"));
  expect(textbox.querySelector('[data-attachment-state="unavailable"]')?.textContent).toContain("#image.png");
  act(() => {
    editor.commands.undo();
  });
  expect(textbox.querySelector("[data-attachment-reference]")).toBeNull();
  expect(screen.getByText("Remove notes.pdf")).toBeTruthy();
});
test("picker leaves text alone and its files can be selected with # offline", async () => {
  const { container, textbox, editor, onChange } = await setup();
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["a"], "notes.pdf", { type: "application/pdf" })] },
  });
  expect(textbox.querySelector("[data-attachment-reference]")).toBeNull();
  act(() => {
    editor.commands.insertContent("#not");
  });
  fireEvent.keyDown(textbox, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith("#notes.pdf ");
  act(() => {
    editor.commands.selectAll();
    editor.commands.deleteSelection();
  });
  expect(screen.getByText("Remove notes.pdf")).toBeTruthy();
});

test("a rich draft reserves unavailable filenames before another paste", async () => {
  const { textbox, editor } = await setup();
  act(() => {
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "fileMention", attrs: { kind: "attachment", attachmentId: "removed", path: "image.png" } }],
        },
      ],
    });
  });
  paste(textbox, [new File(["a"], "image.png", { type: "image/png" })]);
  expect(screen.getByText("Remove image-2.png")).toBeTruthy();
  expect(textbox.querySelector('[data-attachment-state="unavailable"]')).toBeTruthy();
});

test("status changes update every reference without changing text, selection, or history", async () => {
  const { textbox, editor, onChange, update } = await setup();
  paste(textbox, [new File(["a"], "image.png", { type: "image/png" })]);
  const id = attachmentApi.files[0].id;
  act(() => {
    editor.commands.insertContent("#");
  });
  fireEvent.keyDown(textbox, { key: "Tab" });
  expect(textbox.querySelectorAll('[data-attachment-state="uploading"]')).toHaveLength(2);
  const json = editor.getJSON();
  const selection = editor.state.selection.toJSON();
  onChange.mockClear();
  update({ pendingAttachments: [{ filePartId: id, status: "uploaded" }] });
  expect(textbox.querySelectorAll('[data-attachment-state="uploaded"]')).toHaveLength(2);
  expect(textbox.querySelector('[role="status"]')).toBeNull();
  update({ pendingAttachments: [{ filePartId: id, status: "error", error: "Network failed" }] });
  expect(textbox.querySelectorAll('[title="Network failed"]')).toHaveLength(2);
  expect(editor.getJSON()).toEqual(json);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Remove image.png"));
  update({ pendingAttachments: [{ filePartId: id, status: "uploaded" }] });
  expect(textbox.querySelectorAll('[data-attachment-state="unavailable"]')).toHaveLength(2);
});

test("drop never inserts text and rapid additions reserve names and capacity", async () => {
  const { textbox, container } = await setup();
  const image = new File(["a"], "image.png", { type: "image/png" });
  fireEvent.drop(textbox, { dataTransfer: { types: ["Files"], files: [image] } });
  expect(textbox.querySelector("[data-attachment-reference]")).toBeNull();
  act(() => {
    attachmentApi.add([image]);
    attachmentApi.add([image]);
  });
  expect(attachmentApi.files.map((file) => file.filename)).toEqual(["image.png", "image-2.png"]);
  fireEvent.click(screen.getByText("Remove image.png"));
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [image] } });
  expect(attachmentApi.files.map((file) => file.filename)).toEqual(["image-2.png", "image-3.png"]);
  act(() => {
    controllerApi.attachments.clear();
    controllerApi.textInput.clear();
  });
  paste(textbox, [image]);
  expect(attachmentApi.files.map((file) => file.filename)).toEqual(["image.png"]);
});

test("quoted names round trip through JSON, HTML, and plain text", async () => {
  const { textbox, editor, onChange } = await setup();
  const filename = 'before #"screenshot"\\.png';
  paste(textbox, [new File(["a"], filename, { type: "image/png" })]);
  const expected = `#${JSON.stringify(filename)} `;
  expect(onChange).toHaveBeenLastCalledWith(expected);
  expect(editor.getText()).toBe(expected);
  const html = editor.getHTML();
  act(() => {
    editor.commands.setContent(html, { parseOptions: { preserveWhitespace: "full" } });
  });
  expect(onChange).toHaveBeenLastCalledWith(expected);
  expect(editor.state.doc.firstChild?.firstChild?.attrs.attachmentId).toBe(attachmentApi.files[0].id);
});

test("an upload-state rerender does not resurrect a deleted pill", async () => {
  const { textbox, editor, update } = await setup();
  paste(textbox, [new File(["a"], "image.png", { type: "image/png" })]);
  const id = attachmentApi.files[0].id;
  act(() => {
    editor.commands.selectAll();
    editor.commands.deleteSelection();
  });
  update({ pendingAttachments: [{ filePartId: id, status: "uploaded" }] });
  expect(textbox.querySelector("[data-attachment-reference]")).toBeNull();
  expect(attachmentApi.files).toHaveLength(1);
});

test("undoing a paste preserves the preceding typed text", async () => {
  const { textbox, editor } = await setup();
  act(() => {
    editor.commands.insertContent("before ");
  });
  paste(textbox, [new File(["a"], "image.png", { type: "image/png" })]);
  act(() => {
    editor.commands.undo();
  });
  expect(editor.getText()).toBe("before ");
  expect(attachmentApi.files).toHaveLength(1);
});

test("disabled composers do not accept clipboard files", async () => {
  const { textbox } = await setup({ disabled: true });
  paste(textbox, [new File(["a"], "image.png", { type: "image/png" })]);
  expect(attachmentApi.files).toHaveLength(0);
});

test("initial rich drafts preserve unavailable IDs and reserve their labels", async () => {
  const initialContent = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "fileMention", attrs: { kind: "attachment", attachmentId: "missing", path: "image.png" } }] },
    ],
  };
  const { textbox, editor } = await setup({ initialContent });
  expect(textbox.querySelector('[data-attachment-state="unavailable"]')).toBeTruthy();
  act(() => {
    editor.commands.focus("end");
  });
  paste(textbox, [new File(["a"], "image.png", { type: "image/png" })]);
  expect(attachmentApi.files[0].filename).toBe("image-2.png");
});

test("restored file parts keep metadata and do not append references", async () => {
  const { editor, textbox } = await setup({ initialContent: "Inspect #same.png" });
  act(() => {
    attachmentApi.addParts([
      { type: "file", id: "restored1", url: "https://example.test/a", mediaType: "image/png", filename: "same.png" },
      { type: "file", id: "restored2", url: "https://example.test/b", mediaType: "image/png", filename: "same.png" },
    ]);
  });
  expect(editor.getText()).toBe("Inspect #same.png");
  expect(textbox.querySelector("[data-attachment-reference]")).toBeNull();
  expect(attachmentApi.files.map((file) => file.filename)).toEqual(["same.png", "same.png"]);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test("attachment queries follow hard breaks and dismiss on Escape", async () => {
  const { textbox, editor, onChange } = await setup();
  act(() => {
    attachmentApi.add([new File(["a"], "before screenshot.png", { type: "image/png" })]);
    editor.commands.insertContent("line");
    editor.commands.setHardBreak();
    editor.commands.insertContent("#bef");
  });
  expect(screen.getByRole("button", { name: "before screenshot.png" })).toBeTruthy();
  fireEvent.keyDown(textbox, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "before screenshot.png" })).toBeNull();
  act(() => {
    editor.commands.insertContent("o");
  });
  fireEvent.click(screen.getByRole("button", { name: "before screenshot.png" }));
  expect(onChange).toHaveBeenLastCalledWith('line\n#"before screenshot.png" ');
});

test("no matches and live removal leave Enter available for submission", async () => {
  const { textbox, editor } = await setup();
  act(() => {
    attachmentApi.add([new File(["a"], "image.png", { type: "image/png" })]);
    editor.commands.insertContent("#");
  });
  expect(screen.getByRole("button", { name: "image.png" })).toBeTruthy();
  fireEvent.click(screen.getByText("Remove image.png"));
  expect(screen.queryByRole("button", { name: "image.png" })).toBeNull();
  fireEvent.keyDown(textbox, { key: "Tab" });
  expect(editor.getText()).toBe("#");
  act(() => {
    editor.commands.insertContent("unmatched");
  });
  expect(screen.queryByRole("button", { name: "image.png" })).toBeNull();
});

test("IME Enter does not select an attachment suggestion", async () => {
  const { textbox, editor } = await setup();
  act(() => {
    attachmentApi.add([new File(["a"], "image.png", { type: "image/png" })]);
    editor.commands.insertContent("#");
  });
  fireEvent.keyDown(textbox, { key: "Enter", isComposing: true });
  expect(textbox.querySelector("[data-attachment-reference]")).toBeNull();
});

test("deduplicated paste names reach upload metadata and completed inline references", async () => {
  const fetchUpload = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "blob:test") return { ok: true, blob: async () => new Blob(["pixels"], { type: "image/png" }) };
    return { ok: true, json: async () => ({ storageId: (init?.body as File).name }) };
  });
  vi.stubGlobal("fetch", fetchUpload);
  const { result } = renderHook(() => useThreadMessageAttachmentUpload("project" as Id<"projects">));
  const { textbox, onChange, update } = await setup();
  paste(textbox, [new File(["pixels"], "image.png", { type: "image/png" }), new File(["pixels"], "image.png", { type: "image/png" })]);
  expect(onChange).toHaveBeenLastCalledWith("#image.png #image-2.png ");
  await act(async () => {
    await result.current.syncFileParts(attachmentApi.files);
  });
  update({ pendingAttachments: result.current.pendingAttachments });
  expect(textbox.querySelectorAll('[data-attachment-state="uploaded"]')).toHaveLength(2);
  const sent = await result.current.prepareAttachmentsForSubmit();
  expect(sent.map((file) => file.fileName)).toEqual(["image.png", "image-2.png"]);
  expect(sent.map((file) => [file.fileSize, file.contentType])).toEqual([
    [6, "image/png"],
    [6, "image/png"],
  ]);
  expect(fetchUpload.mock.calls.filter(([url]) => url === "https://upload.test").map(([, init]) => (init?.body as File).name)).toEqual([
    "image.png",
    "image-2.png",
  ]);
});

vi.mock("@/components/blocks/tasks/attachment-lightbox", () => ({
  AttachmentLightbox: ({
    open,
    slides,
    initialIndex,
    onClose,
  }: {
    open: boolean;
    slides: { src?: string; fileName: string }[];
    initialIndex: number;
    onClose: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Image preview" data-src={slides[initialIndex]?.src}>
        <span>{slides[initialIndex]?.fileName}</span>
        <button onClick={onClose}>Close preview</button>
      </div>
    ) : null,
}));

test("image suggestion rows show hover previews and still insert on click", async () => {
  const { textbox, editor, onChange } = await setup();
  act(() => {
    attachmentApi.add([new File(["a"], "image.png", { type: "image/png" })]);
    editor.commands.insertContent("#");
  });
  const row = screen.getByRole("button", { name: "image.png" });
  fireEvent.pointerEnter(row);
  expect((await screen.findByRole("img", { name: "image.png" })).getAttribute("src")).toBe("blob:test");
  expect(editor.getText()).toBe("#");
  fireEvent.mouseDown(row);
  fireEvent.click(row);
  expect(onChange).toHaveBeenLastCalledWith("#image.png ");
  expect(textbox.querySelector("[data-attachment-reference]")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Image preview" })).toBeNull();
});

test("image references preview on hover and open the lightbox without editing the draft", async () => {
  const { textbox, editor } = await setup();
  paste(textbox, [new File(["a"], "image.png", { type: "image/png" })]);
  const reference = screen.getByText("#image.png");
  const json = editor.getJSON();
  const selection = editor.state.selection.toJSON();
  fireEvent.pointerEnter(reference);
  const preview = await screen.findByRole("img", { name: "image.png" });
  fireEvent.mouseDown(preview);
  fireEvent.click(preview);
  expect(screen.getByRole("dialog", { name: "Image preview" }).getAttribute("data-src")).toBe("blob:test");
  fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
  fireEvent.mouseDown(reference);
  fireEvent.click(reference);
  expect(screen.getByRole("dialog", { name: "Image preview" })).toBeTruthy();
  expect(editor.getJSON()).toEqual(json);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  fireEvent.click(screen.getByText("Remove image.png"));
  expect(screen.queryByRole("dialog", { name: "Image preview" })).toBeNull();
  fireEvent.click(screen.getByText("#image.png"));
  expect(screen.queryByRole("dialog", { name: "Image preview" })).toBeNull();
});

test("document references have no image-preview action", async () => {
  const { textbox } = await setup();
  paste(textbox, [new File(["a"], "notes.pdf", { type: "application/pdf" })]);
  expect(textbox.querySelector("[data-attachment-reference] button")).toBeNull();
  fireEvent.click(screen.getByText("#notes.pdf"));
  expect(screen.queryByRole("dialog", { name: "Image preview" })).toBeNull();
});

test("clicking a suggestion preview keeps the lightbox open after the menu closes", async () => {
  const { textbox, editor } = await setup();
  act(() => {
    attachmentApi.add([new File(["a"], "image.png", { type: "image/png" })]);
    editor.commands.insertContent("#");
  });
  fireEvent.pointerEnter(screen.getByRole("button", { name: "image.png" }));
  const preview = await screen.findByRole("img", { name: "image.png" });
  fireEvent.mouseDown(preview);
  fireEvent.click(preview);
  fireEvent.blur(textbox);
  expect(screen.getByRole("dialog", { name: "Image preview" }).getAttribute("data-src")).toBe("blob:test");
  expect(editor.getText()).toBe("#");
  expect(textbox.querySelector('[data-attachment-reference]')).toBeNull();
});

test("queued edit restores quoted references with attachment identity and previews", async () => {
  const { editor, textbox } = await setup();
  const text = 'Inspect #"before shot.png"\nAgain #"before shot.png" #unknown';
  act(() => {
    controllerApi.textInput.setInput(text);
    attachmentApi.addParts([{ type: "file", id: "restored-image", url: "https://example.test/restored.png", mediaType: "image/png", filename: "before shot.png" }]);
  });
  const nodes: string[] = [];
  editor.state.doc.descendants((node) => { if (node.type.name === "fileMention") nodes.push(node.attrs.attachmentId); });
  expect(nodes).toEqual(["restored-image", "restored-image"]);
  expect(controllerApi.textInput.value).toBe(text);
  expect(textbox.textContent).toContain("#unknown");
  fireEvent.click(screen.getAllByText("#before shot.png")[0]);
  expect(screen.getByRole("dialog", { name: "Image preview" }).getAttribute("data-src")).toBe("https://example.test/restored.png");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test("queued image restoration keeps the attachment for resubmit without uploading again", async () => {
  const fetchUpload = vi.fn();
  vi.stubGlobal("fetch", fetchUpload);
  const { result } = renderHook(() => useThreadMessageAttachmentUpload("project" as Id<"projects">));
  const { textbox, update } = await setup();
  act(() => {
    result.current.seedUploadedAttachments([{ filePartId: "restored", storageId: "stored-image" as Id<"_storage">, fileName: "image.png", fileSize: 42, contentType: "image/png" }]);
    controllerApi.textInput.setInput("Inspect #image.png");
    controllerApi.attachments.addParts([{ type: "file", id: "restored", url: "https://example.test/image.png", mediaType: "image/png", filename: "image.png" }]);
  });
  await act(async () => { await result.current.syncFileParts(attachmentApi.files); });
  update({ pendingAttachments: result.current.pendingAttachments });
  expect(screen.getByText("Remove image.png")).toBeTruthy();
  expect(textbox.querySelector('[data-attachment-state="uploaded"]')).toBeTruthy();
  expect(await result.current.prepareAttachmentsForSubmit()).toEqual([{ storageId: "stored-image", fileName: "image.png", fileSize: 42, contentType: "image/png" }]);
  expect(fetchUpload).not.toHaveBeenCalled();
});

test("external restoration leaves ambiguous references plain and file additions do not rebuild deleted pills", async () => {
  const { editor, textbox } = await setup();
  act(() => {
    controllerApi.attachments.addParts([
      { type: "file", id: "a", url: "https://example.test/a", mediaType: "image/png", filename: "same.png" },
      { type: "file", id: "b", url: "https://example.test/b", mediaType: "image/png", filename: "same.png" },
    ]);
    controllerApi.textInput.setInput("#same.png #missing.png");
  });
  expect(textbox.querySelector("[data-attachment-reference]")).toBeNull();
  act(() => {
    attachmentApi.remove("b");
    controllerApi.textInput.setInput("Inspect #same.png");
  });
  expect(textbox.querySelectorAll("[data-attachment-reference]")).toHaveLength(1);
  act(() => {
    editor.commands.selectAll();
    editor.commands.deleteSelection();
    attachmentApi.addParts([{ type: "file", id: "c", url: "https://example.test/c", mediaType: "image/png", filename: "new.png" }]);
  });
  expect(textbox.querySelector("[data-attachment-reference]")).toBeNull();
  expect(editor.getText()).toBe("");
  expect(attachmentApi.files).toHaveLength(2);
});
