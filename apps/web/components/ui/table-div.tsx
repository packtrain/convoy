"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function TableDiv({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table"
      role="table"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function TableDivHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-header"
      role="rowgroup"
      className={cn("*:data-[slot=table-row]:border-b", className)}
      {...props}
    />
  )
}

function TableDivBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-body"
      role="rowgroup"
      className={cn("[&>[data-slot=table-row]:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableDivFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-footer"
      role="rowgroup"
      className={cn("bg-muted/50 border-t font-medium *:data-[slot=table-row]:last:border-b-0", className)}
      {...props}
    />
  )
}

function TableDivRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-row"
      role="row"
      className={cn("flex overflow-hidden hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors", className)}
      {...props}
    />
  )
}

function TableDivHead({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-head"
      role="columnheader"
      className={cn("text-foreground h-10 px-2 flex items-center font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  )
}

function TableDivCell({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-cell"
      role="cell"
      className={cn("p-2 flex items-center whitespace-nowrap [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  )
}

function TableDivCaption({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-caption"
      role="caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  TableDiv,
  TableDivHeader,
  TableDivBody,
  TableDivFooter,
  TableDivHead,
  TableDivRow,
  TableDivCell,
  TableDivCaption,
}
