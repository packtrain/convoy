import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { ElementType, useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";

export function NavSection({
  Icon,
  title,
  children,
  className,
  actions,
}: {
  Icon?: ElementType;
  title: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
  actionsLeft?: React.ReactNode;
}) {
  return (
    <SidebarGroup className={className}>
      <div className="flex justify-between items-center w-full">
        <SidebarGroupLabel>
          {Icon && <Icon className="size-4 shrink-0 mr-2" />}
          {title}
        </SidebarGroupLabel>
        {actions}
      </div>
      <SidebarGroupContent>{children}</SidebarGroupContent>
    </SidebarGroup>
  );
}

export type NavSectionVariant = "default" | "menu-item";

export function NavSectionCollapsible({
  Icon,
  title,
  children,
  variant = "default",
  className,
  classNameChildContainer,
  classNameLabel,
  actions,
  defaultOpen = false,
  showChevron: showChevronProp = true,
  ...props
}: {
  showChevron?: boolean;
  Icon?: ElementType;
  title: string;
  children: React.ReactNode;
  variant?: NavSectionVariant;
  className?: string;
  classNameChildContainer?: string;
  classNameLabel?: string;
  actions?: React.ReactNode;
} & React.ComponentPropsWithoutRef<typeof Collapsible>) {
  const showChevron = showChevronProp && children && Icon;
  const [open, setOpen] = useState(defaultOpen);

  return (
    <SidebarGroup className={className}>
      <Collapsible defaultOpen={defaultOpen} onOpenChange={setOpen} {...props}>
        <div className="cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md flex justify-between items-center w-full group/section">
          <CollapsibleTrigger asChild>
            <SidebarGroupLabel className={cn("flex-1", variant === "menu-item" && "text-sidebar-foreground text-sm font-normal", classNameLabel)}>
              {Icon && <Icon className={cn("size-4 shrink-0 mr-2", showChevron && "group-hover/section:hidden")} />}
              {showChevron && <ChevronRight className={cn("size-4 shrink-0 mr-2 transition-transform duration-200 hidden group-hover/section:block", showChevron && open && "rotate-90")} />}
              {title}
            </SidebarGroupLabel>
          </CollapsibleTrigger>
          {actions}
        </div>
        <CollapsibleContent>
          <SidebarGroupContent className={cn(variant === "menu-item" && "pl-0", classNameChildContainer)}>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

const navSectionButtonVariants = cva("", {
  variants: {
    variant: {
      default: "",
      hover: "group-hover/section:opacity-100 opacity-0",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function NavSectionButton({
  children,
  className,
  onClick,
  Icon,
  variant,
  ...props
}: {
  children?: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  Icon?: ElementType;
  variant?: VariantProps<typeof navSectionButtonVariants>["variant"];
} & Omit<React.ComponentPropsWithoutRef<typeof Button>, "variant">) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn("px-2 has-[>svg]:px-1 text-muted-foreground mr-0.5", navSectionButtonVariants({ variant }), className)}
      onClick={(e) => {
        onClick?.(e);
        e.stopPropagation();
      }}
      {...props}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {children}
    </Button>
  );
}

export function NavItemsSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 px-2", className)}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-4 rounded-sm" />
      ))}
    </div>
  );
}

export function NavItemsEmptyState({ title, className, ...props }: { title: string; className?: string } & React.ComponentPropsWithoutRef<typeof SidebarMenuButton>) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton type="button" className={cn("cursor-pointer text-muted-foreground", className)} {...props}>
        {title}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
