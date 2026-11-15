"use client";

import {
  CodeMirrorEditor,
  editorInFocus$,
  useCellValue,
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from "@mdxeditor/editor";
import { Trash2 } from "lucide-react";

import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger } from "./ui/select";

export const codeBlockLanguages = {
  txt: "Plain text",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TypeScript React",
  js: "JavaScript",
  jsx: "JavaScript React",
  json: "JSON",
  css: "CSS",
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  md: "Markdown",
} as const;

export function createCodeBlockEditorDescriptor(): CodeBlockEditorDescriptor {
  return {
    priority: 2,
    match(_language, meta) {
      return !meta;
    },
    Editor: CodeBlockEditor,
  };
}

function CodeBlockEditor(props: CodeBlockEditorProps) {
  const { lexicalNode, parentEditor, setLanguage } = useCodeBlockEditorContext();
  const editorInFocus = useCellValue(editorInFocus$);
  const currentLanguageLabel =
    codeBlockLanguages[props.language as keyof typeof codeBlockLanguages] ?? "Plain text";
  const isActiveCodeBlock =
    editorInFocus?.editorType === "codeblock" &&
    editorInFocus.rootNode?.getKey?.() === lexicalNode.getKey();

  return (
    <div className="mdx-editor-kit__code-block-shell">
      <div
        className={`mdx-editor-kit__code-block-toolbar${isActiveCodeBlock ? " is-active" : ""}`}
      >
        <Select value={props.language} onValueChange={setLanguage}>
          <SelectTrigger className="h-8 min-w-[8.25rem] rounded-[10px] border border-border bg-background px-3 text-[0.8rem] text-foreground">
            <span>{currentLanguageLabel}</span>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(codeBlockLanguages).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                <SelectItemText>{label}</SelectItemText>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete code block"
          className="rounded-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(event) => {
            event.preventDefault();
            parentEditor.update(() => {
              lexicalNode.remove();
            });
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="mdx-editor-kit__code-block-body">
        <CodeMirrorEditor {...props} />
      </div>
    </div>
  );
}
