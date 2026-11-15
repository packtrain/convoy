"use client"

import { useCallback } from "react"
import { type Editor } from "@tiptap/react"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/editor/use-tiptap-editor"

// --- Lib ---
import {
  findNodePosition,
  getSelectedBlockNodes,
  isNodeInSchema,
  isNodeTypeSelected,
  isValidPosition,
  selectionWithinConvertibleTypes,
} from "@/lib/editor/tiptap-utils"

const CONVERTIBLE_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
] as const

const NON_PARAGRAPH_BLOCK_WRAPPERS = [
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
] as const

export interface UseParagraphConfig {
  editor?: Editor | null
  onToggled?: () => void
}

export function canToggleParagraph(
  editor: Editor | null,
  turnInto: boolean = true
): boolean {
  if (!editor || !editor.isEditable) return false
  if (
    !isNodeInSchema("paragraph", editor) ||
    isNodeTypeSelected(editor, ["image"])
  ) {
    return false
  }

  if (!turnInto) {
    return editor.can().setNode("paragraph")
  }

  if (!selectionWithinConvertibleTypes(editor, [...CONVERTIBLE_BLOCK_TYPES])) {
    return false
  }

  return editor.can().setNode("paragraph") || editor.can().clearNodes()
}

export function isParagraphActive(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!editor.isActive("paragraph")) return false

  return !NON_PARAGRAPH_BLOCK_WRAPPERS.some((nodeType) =>
    editor.isActive(nodeType)
  )
}

export function toggleParagraph(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canToggleParagraph(editor)) return false

  try {
    const view = editor.view
    let state = view.state
    let tr = state.tr

    const blocks = getSelectedBlockNodes(editor)
    const isPossibleToTurnInto =
      selectionWithinConvertibleTypes(editor, [...CONVERTIBLE_BLOCK_TYPES]) &&
      blocks.length === 1

    if (
      (state.selection.empty || state.selection instanceof TextSelection) &&
      isPossibleToTurnInto
    ) {
      const pos = findNodePosition({
        editor,
        node: state.selection.$anchor.node(1),
      })?.pos
      if (!isValidPosition(pos)) return false

      tr = tr.setSelection(NodeSelection.create(state.doc, pos))
      view.dispatch(tr)
      state = view.state
    }

    const selection = state.selection
    let chain = editor.chain().focus()

    if (selection instanceof NodeSelection) {
      const firstChild = selection.node.firstChild?.firstChild
      const lastChild = selection.node.lastChild?.lastChild

      const from = firstChild
        ? selection.from + firstChild.nodeSize
        : selection.from + 1

      const to = lastChild
        ? selection.to - lastChild.nodeSize
        : selection.to - 1

      const resolvedFrom = state.doc.resolve(from)
      const resolvedTo = state.doc.resolve(to)

      chain = chain
        .setTextSelection(TextSelection.between(resolvedFrom, resolvedTo))
        .clearNodes()
    }

    chain.setNode("paragraph").run()
    editor.chain().focus().selectTextblockEnd().run()

    return true
  } catch {
    return false
  }
}

export function useParagraph(config?: UseParagraphConfig) {
  const { editor: providedEditor, onToggled } = config || {}
  const { editor } = useTiptapEditor(providedEditor)

  const handleToggle = useCallback(() => {
    if (!editor) return false

    const success = toggleParagraph(editor)
    if (success) {
      onToggled?.()
    }
    return success
  }, [editor, onToggled])

  return {
    canToggle: canToggleParagraph(editor),
    isActive: isParagraphActive(editor),
    handleToggle,
    label: "Normal text",
  }
}
