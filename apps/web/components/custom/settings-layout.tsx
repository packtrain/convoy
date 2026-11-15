import { ChevronLeft } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { AppLink, type RouteTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type SettingsPageContainerProps = ComponentProps<"div">;

export function SettingsPageContainer({
  className,
  ...props
}: SettingsPageContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full max-w-4xl", className)}
      {...props}
    />
  );
}

interface SettingsPageHeaderProps extends Omit<ComponentProps<"div">, "title"> {
  title: ReactNode;
  description?: ReactNode;
  backLink?: {
    href: RouteTarget | string;
    label: string;
  };
}

export function SettingsPageHeader({
  title,
  description,
  backLink,
  className,
  ...props
}: SettingsPageHeaderProps) {
  return (
    <div className={cn("space-y-1", className)} {...props}>
      {backLink ? (
        <AppLink
          href={backLink.href}
          className="-ml-1 inline-flex w-fit cursor-pointer items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {backLink.label}
        </AppLink>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

interface SettingsSectionHeaderProps
  extends Omit<ComponentProps<"div">, "title"> {
  title: ReactNode;
  description?: ReactNode;
  /** `danger` titles a Danger Zone section in the destructive color. */
  tone?: "default" | "danger";
}

export function SettingsSectionHeader({
  title,
  description,
  tone = "default",
  className,
  ...props
}: SettingsSectionHeaderProps) {
  return (
    <div className={className} {...props}>
      <h2
        className={cn(
          "text-base font-semibold leading-7",
          tone === "danger" && "text-destructive"
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

interface SettingsTwoColumnSectionProps
  extends Omit<ComponentProps<"section">, "title"> {
  title: ReactNode;
  description?: ReactNode;
  contentClassName?: string;
  tone?: SettingsSectionHeaderProps["tone"];
}

export function SettingsTwoColumnSection({
  title,
  description,
  tone,
  contentClassName,
  className,
  children,
  ...props
}: SettingsTwoColumnSectionProps) {
  return (
    <section
      className={cn(
        "grid grid-cols-1 gap-x-8 gap-y-10 border-b border-border pb-8 md:grid-cols-3",
        className
      )}
      {...props}
    >
      <SettingsSectionHeader title={title} description={description} tone={tone} />
      <div className={cn("md:col-span-2", contentClassName)}>{children}</div>
    </section>
  );
}

type SettingsFormGridProps = ComponentProps<"div">;

export function SettingsFormGrid({
  className,
  ...props
}: SettingsFormGridProps) {
  return (
    <div
      className={cn(
        "grid max-w-2xl grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6",
        className
      )}
      {...props}
    />
  );
}

interface SettingsActionsProps extends ComponentProps<"div"> {
  start?: ReactNode;
}

export function SettingsActions({
  start,
  className,
  children,
  ...props
}: SettingsActionsProps) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3", className)}
      {...props}
    >
      <div>{start}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

interface SettingsDangerRowProps {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  action: ReactNode;
  /** Shown under the row, which dims, when the action is unavailable. */
  disabledReason?: ReactNode;
}

/** One destructive action in a Danger Zone section. */
export function SettingsDangerRow({
  icon,
  title,
  description,
  action,
  disabledReason,
}: SettingsDangerRowProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-destructive/50 p-4",
        disabledReason && "opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4">
            {icon}
            {title}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {disabledReason ? (
        <p className="mt-2 text-xs italic text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
