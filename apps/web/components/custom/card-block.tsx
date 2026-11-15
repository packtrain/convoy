import * as React from "react"

import { cn } from "@/lib/utils"

function CardBlock({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="card-block"
      className={cn(
        "group/card-block flex flex-col rounded-lg border border-border bg-background text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardBlockHeader({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="card-block-header"
      className={cn(
        "flex items-center justify-between gap-1 border-b border-border bg-muted/60 px-3 py-1.5",
        className
      )}
      {...props}
    />
  )
}

function CardBlockTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"p">) {
  return (
    <p
      data-slot="card-block-title"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  )
}

function CardBlockToolbar({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="card-block-toolbar"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  )
}

function CardBlockContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="card-block-content"
      className={cn("px-3 py-3", className)}
      {...props}
    />
  )
}

function CardBlockFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="card-block-footer"
      className={cn("flex items-center px-3 pb-3", className)}
      {...props}
    />
  )
}

function CardBlockError({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"p">) {
  return (
    <p
      data-slot="card-block-error"
      className={cn("px-3 pb-3 text-xs text-red-500", className)}
      {...props}
    />
  )
}

export {
  CardBlock,
  CardBlockHeader,
  CardBlockTitle,
  CardBlockToolbar,
  CardBlockContent,
  CardBlockFooter,
  CardBlockError,
}
