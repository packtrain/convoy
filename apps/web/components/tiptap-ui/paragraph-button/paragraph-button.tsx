"use client"

import { forwardRef, useCallback } from "react"

// --- Tiptap UI ---
import {
  useParagraph,
  type UseParagraphConfig,
} from "@/components/tiptap-ui/paragraph-button/use-paragraph"

// --- UI Primitives ---
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button } from "@/components/tiptap-ui-primitive/button"

export interface ParagraphButtonProps
  extends Omit<ButtonProps, "type">,
    UseParagraphConfig {
  text?: string
}

export const ParagraphButton = forwardRef<
  HTMLButtonElement,
  ParagraphButtonProps
>(
  (
    { text = "Normal text", editor, onToggled, onClick, children, ...buttonProps },
    ref
  ) => {
    const { canToggle, isActive, handleToggle, label } = useParagraph({
      editor,
      onToggled,
    })

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleToggle()
      },
      [handleToggle, onClick]
    )

    if (!editor) {
      return null
    }

    return (
      <Button
        type="button"
        data-style="ghost"
        data-active-state={isActive ? "on" : "off"}
        role="button"
        tabIndex={-1}
        disabled={!canToggle}
        data-disabled={!canToggle}
        aria-label={label}
        aria-pressed={isActive}
        tooltip={label}
        onClick={handleClick}
        {...buttonProps}
        ref={ref}
      >
        {children ?? <span className="tiptap-button-text">{text}</span>}
      </Button>
    )
  }
)

ParagraphButton.displayName = "ParagraphButton"
