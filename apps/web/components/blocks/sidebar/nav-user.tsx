"use client"

import { forwardRef, useState, type ComponentPropsWithoutRef } from "react"
import {
  Check,
  ChevronsUpDown,
  LogOut,
  Plus,
  Settings,
} from "lucide-react"
import { isLocalDemoAuthMode } from "@/lib/auth/auth-mode"
import { supportsSignOut, useAppSignOut, useAppUser } from "@/lib/auth/hooks"
import { useQuery } from "convex/react"
import Image from "next/image"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  UserSettingsDialog,
  type UserSettingsSectionId,
} from "@/components/blocks/user/settings"
import {
  OrganizationDialog,
  type OrganizationDialogData,
} from "@/components/blocks/organization/organization-dialog"
import { MobileDrawerPanel } from "@/components/blocks/mobile/mobile-drawer-panel"
import { AppLink, appRoute } from "@/lib/navigation"
import { useDialogWithData } from "@/hooks/ui/use-dialog"
import { cn, getInitials } from "@/lib/utils"
import { setLastOrganizationSlug } from "@/lib/routing/last-org-storage"

interface NavUserProps {
  currentOrgId: Id<"organizations">;
}

export function NavUser({ currentOrgId }: NavUserProps) {
  const { isMobile } = useSidebar()
  const signOut = useAppSignOut()
  const { user } = useAppUser()
  const organizations = useQuery(api.organizations.core.listForUser, {})
  const orgDialog = useDialogWithData<OrganizationDialogData>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] =
    useState<UserSettingsSectionId>("general")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const name = user?.fullName ?? user?.firstName ?? "User"
  const email = user?.email ?? ""
  const avatar = user?.imageUrl ?? ""
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
  const currentOrg = organizations?.find((organization) => organization._id === currentOrgId)
  const otherOrgs = organizations?.filter((organization) => organization._id !== currentOrgId) ?? []
  const orderedOrganizations = currentOrg ? [currentOrg, ...otherOrgs] : (organizations ?? [])
  const organizationName = currentOrg?.name ?? "Organization"

  const handleCreateOrg = () => {
    setMobileMenuOpen(false)
    orgDialog.open({})
  }

  const openProfileSettings = () => {
    setMobileMenuOpen(false)
    setSettingsOpen(true)
  }

  const handleSignOut = () => {
    void signOut({ redirectUrl: "/" })
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          {isMobile ? (
            <>
              <NavUserTrigger
                avatar={avatar}
                initials={initials}
                name={name}
                organizationName={organizationName}
                onClick={() => setMobileMenuOpen(true)}
              />
              <MobileDrawerPanel
                open={mobileMenuOpen}
                onClose={() => setMobileMenuOpen(false)}
                compact
              >
                <UserMenuContent
                  surface="drawer"
                  avatar={avatar}
                  name={name}
                  email={email}
                  initials={initials}
                  currentOrgId={currentOrgId}
                  organizations={orderedOrganizations}
                  onProfileSettings={openProfileSettings}
                  onCreateOrg={handleCreateOrg}
                  onSignOut={handleSignOut}
                  onNavigate={() => setMobileMenuOpen(false)}
                />
              </MobileDrawerPanel>
            </>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <NavUserTrigger
                  avatar={avatar}
                  initials={initials}
                  name={name}
                  organizationName={organizationName}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-lg"
                side="right"
                align="end"
                sideOffset={4}
              >
                <UserMenuContent
                  surface="dropdown"
                  avatar={avatar}
                  name={name}
                  email={email}
                  initials={initials}
                  currentOrgId={currentOrgId}
                  organizations={orderedOrganizations}
                  onProfileSettings={openProfileSettings}
                  onCreateOrg={handleCreateOrg}
                  onSignOut={handleSignOut}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </SidebarMenuItem>
      </SidebarMenu>

      <UserSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
      />
      <OrganizationDialog dialog={orgDialog} />
    </>
  )
}

interface NavUserTriggerProps
  extends ComponentPropsWithoutRef<typeof SidebarMenuButton> {
  avatar: string;
  initials: string;
  name: string;
  organizationName: string;
}

const NavUserTrigger = forwardRef<HTMLButtonElement, NavUserTriggerProps>(
  function NavUserTrigger({
    avatar,
    initials,
    name,
    organizationName,
    className,
    ...props
  }, ref) {
  return (
    <SidebarMenuButton
      ref={ref}
      size="lg"
      className={cn(
        "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!",
        className
      )}
      {...props}
    >
      <Avatar className="size-8 rounded-lg group-data-[collapsible=icon]:size-7">
        <AvatarImage src={avatar} alt={name} />
        <AvatarFallback className="rounded-lg text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{organizationName}</span>
      </div>
      <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
    </SidebarMenuButton>
  );
})

function UserMenuContent({
  surface,
  avatar,
  name,
  email,
  initials,
  currentOrgId,
  organizations,
  onProfileSettings,
  onCreateOrg,
  onSignOut,
  onNavigate,
}: {
  surface: "dropdown" | "drawer";
  avatar: string;
  name: string;
  email: string;
  initials: string;
  currentOrgId: Id<"organizations">;
  organizations: Array<{
    _id: Id<"organizations">;
    name: string;
    slug: string;
    role: string;
    color?: string | null;
    avatarUrl?: string | null;
  }>;
  onProfileSettings: () => void;
  onCreateOrg: () => void;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  const header = (
    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
      <Avatar className="size-8 rounded-lg">
        <AvatarImage src={avatar} alt={name} />
        <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{name}</span>
          {isLocalDemoAuthMode && (
            <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
              Local demo
            </Badge>
          )}
        </span>
        <span className="truncate text-xs">{email}</span>
      </div>
      <button
        type="button"
        aria-label="Profile settings"
        title="Profile settings"
        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={onProfileSettings}
      >
        <Settings className="size-4" />
      </button>
    </div>
  );

  const organizationLinks = organizations.map((organization) => (
    <OrganizationMenuLink
      key={organization._id}
      organization={organization}
      currentOrgId={currentOrgId}
      onNavigate={onNavigate}
      className={surface === "drawer" ? "rounded-lg px-3 py-2.5" : "p-1"}
    />
  ));

  const createOrgContent = (
    <>
      <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
        <Plus className="size-4" />
      </div>
      <span className="font-medium text-muted-foreground">New organization</span>
    </>
  );

  if (surface === "drawer") {
    return (
      <div className="space-y-3 p-4">
        {header}
        <div className="h-px bg-border" />
        <div className="space-y-1">{organizationLinks}</div>
        <button
          type="button"
          onClick={onCreateOrg}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-muted active:bg-muted"
        >
          {createOrgContent}
        </button>
        {supportsSignOut && (
          <>
            <div className="h-px bg-border" />
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-muted active:bg-muted"
            >
              <LogOut className="size-4" />
              Log out
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <DropdownMenuLabel className="p-0 font-normal">
        {header}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {organizations.map((organization) => (
          <DropdownMenuItem
            key={organization._id}
            asChild
            className="cursor-pointer gap-2 p-1"
          >
            <OrganizationMenuLink
              organization={organization}
              currentOrgId={currentOrgId}
            />
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onClick={onCreateOrg}
          className="gap-2 p-1 cursor-pointer"
        >
          {createOrgContent}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {supportsSignOut && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSignOut}>
            <LogOut />
            Log out
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

function OrganizationMenuLink({
  organization,
  currentOrgId,
  onNavigate,
  className,
}: {
  organization: {
    _id: Id<"organizations">;
    name: string;
    slug: string;
    role: string;
    color?: string | null;
    avatarUrl?: string | null;
  };
  currentOrgId: Id<"organizations">;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <AppLink
      href={appRoute.organization(organization.slug)}
      onClick={() => {
        setLastOrganizationSlug(organization.slug);
        onNavigate?.();
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 text-sm hover:bg-muted active:bg-muted",
        className
      )}
    >
      <div
        className={cn(
          "flex size-6 items-center justify-center rounded-md border",
          !organization.color && "bg-icon-muted",
          organization.color ? "text-white" : "text-foreground"
        )}
        style={
          organization.color
            ? { backgroundColor: organization.color }
            : undefined
        }
      >
        {organization.avatarUrl ? (
          <Image
            src={organization.avatarUrl}
            alt={organization.name}
            className="size-6 rounded-md"
          />
        ) : (
          <span
            className={cn(
              "text-[10px] font-medium",
              organization.color ? "text-white" : "text-foreground"
            )}
          >
            {getInitials(organization.name)}
          </span>
        )}
      </div>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate">{organization.name}</span>
        {organization._id === currentOrgId && (
          <Badge
            variant="secondary"
            className="h-4 px-1.5 text-[10px] capitalize"
          >
            {organization.role}
          </Badge>
        )}
      </span>
      {organization._id === currentOrgId && (
        <Check className="size-4 text-primary" />
      )}
    </AppLink>
  );
}
