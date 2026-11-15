import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const pillVariants = cva(
  "group/pill inline-flex max-w-full min-w-0 items-center rounded-md border transition-colors has-[a[data-slot=pill-content]:hover]:bg-muted has-[a[data-slot=pill-content]:focus-visible]:bg-muted has-[button[data-slot=pill-content]:hover]:bg-muted has-[button[data-slot=pill-content]:focus-visible]:bg-muted",
  {
    variants: {
      size: {
        default: "h-7 pl-2 pr-1 text-sm",
        compact: "h-6 pl-1.5 pr-1 text-xs",
      },
      tone: {
        default: "border-border bg-muted/50 text-foreground",
        selected: "border-primary/40 bg-muted text-foreground",
        muted: "border-border bg-muted/30 text-muted-foreground",
      },
    },
    defaultVariants: {
      size: "default",
      tone: "default",
    },
  }
)

const pillActionVariants = cva(
  "group/pill-action ml-1 flex shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors hover:bg-foreground/10 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      size: {
        default: "size-5",
        compact: "ml-0.5 size-4",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const pillMetaVariants = cva("shrink-0 text-muted-foreground", {
  variants: {
    variant: {
      default: "",
      badge:
        "rounded-full bg-background px-1.5 text-[10px] font-medium uppercase tracking-wide",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

const PillContext = React.createContext<{ size: "default" | "compact" }>({
  size: "default",
})

function Pill({
  className,
  size = "default",
  tone = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof pillVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "div"
  const resolvedSize = size ?? "default"
  const resolvedTone = tone ?? "default"

  return (
    <PillContext.Provider value={{ size: resolvedSize }}>
      <Comp
        data-slot="pill"
        data-size={resolvedSize}
        data-tone={resolvedTone}
        className={cn(
          pillVariants({ size: resolvedSize, tone: resolvedTone, className })
        )}
        {...props}
      />
    </PillContext.Provider>
  )
}

// Use `Pill asChild` when the whole pill is the interactive target.
// Use `PillContent asChild` when the pill has clickable content plus a sibling action.
function PillContent({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "div"

  return (
    <Comp
      data-slot="pill-content"
      className={cn("flex min-w-0 items-center gap-1.5", className)}
      {...props}
    />
  )
}

function PillIcon({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="pill-icon"
      className={cn("flex shrink-0 items-center justify-center", className)}
      {...props}
    />
  )
}

function PillText({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="pill-text"
      className={cn("min-w-0 truncate", className)}
      {...props}
    />
  )
}

function PillMeta({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof pillMetaVariants>) {
  return (
    <span
      data-slot="pill-meta"
      className={cn(pillMetaVariants({ variant, className }))}
      {...props}
    />
  )
}

function PillAction({
  className,
  children,
  size,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof pillActionVariants>) {
  const { size: inheritedSize } = React.useContext(PillContext)

  return (
    <button
      type="button"
      data-slot="pill-action"
      className={cn(pillActionVariants({ size: size ?? inheritedSize, className }))}
      {...props}
    >
      {children ?? (
        <X className="size-3 text-muted-foreground transition-colors group-hover/pill-action:text-foreground" />
      )}
    </button>
  )
}

export { Pill, PillAction, PillContent, PillIcon, PillMeta, PillText }
