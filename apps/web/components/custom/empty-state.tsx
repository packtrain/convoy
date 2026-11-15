import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const emptyMessageSizeClasses = {
  default: "p-4 text-sm",
  compact: "p-2 text-sm",
  loose: "px-3 py-8 text-sm",
  inline: "px-2 pb-2 text-xs",
} as const;

interface EmptyMessageProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: keyof typeof emptyMessageSizeClasses;
}

const EmptyMessage = React.forwardRef<HTMLDivElement, EmptyMessageProps>(
  ({ className, size = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "text-center text-muted-foreground",
        emptyMessageSizeClasses[size],
        className
      )}
      {...props}
    />
  )
);
EmptyMessage.displayName = "EmptyMessage";

const emptyVariantClasses = {
  default: "",
  dashed: "rounded-lg border border-dashed border-border text-sm text-muted-foreground",
} as const;

interface EmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `dashed` frames a bare text message, such as no search matches. */
  variant?: keyof typeof emptyVariantClasses;
}

const Empty = React.forwardRef<HTMLDivElement, EmptyProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      data-slot="empty"
      className={cn(
        "flex flex-col items-center justify-center text-center p-8",
        emptyVariantClasses[variant],
        className
      )}
      {...props}
    />
  )
);
Empty.displayName = "Empty";

const EmptyHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col items-center gap-2", className)}
    {...props}
  />
));
EmptyHeader.displayName = "EmptyHeader";

interface EmptyMediaProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "icon" | "image";
}

const EmptyMedia = React.forwardRef<HTMLDivElement, EmptyMediaProps>(
  ({ className, variant = "icon", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center justify-center",
        variant === "icon" &&
          "size-12 rounded-full bg-muted text-muted-foreground [&>svg]:size-6",
        className
      )}
      {...props}
    />
  )
);
EmptyMedia.displayName = "EmptyMedia";

interface EmptyTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Page-level states (not found) render the page's `h1`. */
  as?: "h1" | "h2" | "h3";
}

const EmptyTitle = React.forwardRef<HTMLHeadingElement, EmptyTitleProps>(
  ({ as: Heading = "h3", className, ...props }, ref) => (
    <Heading
      ref={ref}
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  )
);
EmptyTitle.displayName = "EmptyTitle";

const EmptyDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground max-w-sm text-pretty", className)}
    {...props}
  />
));
EmptyDescription.displayName = "EmptyDescription";

const EmptyContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("mt-4", className)} {...props} />
));
EmptyContent.displayName = "EmptyContent";

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "children"> {
  icon: LucideIcon;
  title: React.ReactNode;
  /** Page-level states (not found) render the page's `h1`. */
  titleAs?: EmptyTitleProps["as"];
  description?: React.ReactNode;
  /** A create button, or richer content such as a command or a template list. */
  action?: React.ReactNode;
  actionClassName?: string;
  /** Grow into the parent flex column and center vertically. */
  fill?: boolean;
}

/** The page- and section-level empty state (docs/guidelines/frontend-development.md#empty-states). */
const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon: Icon, title, titleAs, description, action, actionClassName, fill = false, className, ...props }, ref) => (
    <Empty ref={ref} className={cn(fill && "flex-1", className)} {...props}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle as={titleAs}>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent className={actionClassName}>{action}</EmptyContent> : null}
    </Empty>
  )
);
EmptyState.displayName = "EmptyState";

export {
  EmptyState,
  EmptyMessage,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
};
