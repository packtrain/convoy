"use client";

import { useState } from "react";
import {
  Archive,
  Bell,
  BotMessageSquare,
  Check,
  ChevronsUpDown,
  Circle,
  CircleDashed,
  GitPullRequest,
  Hash,
  LogOut,
  Plus,
  Settings,
  TowerControl,
  UserCog,
} from "lucide-react";
import { KeyboardShortcutsButton } from "@/components/blocks/sidebar/keyboard-shortcuts-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface PinnedList {
  id: string;
  name: string;
  color: string;
}

interface Project {
  id: string;
  name: string;
  alias: string;
  color: string;
  notifications: number;
  unreadThreads: number;
  lists: PinnedList[];
}

interface Organization {
  id: string;
  name: string;
  color: string;
  projects: Project[];
}

const OPENSANA_PROJECTS: Project[] = [
  {
    id: "os",
    name: "Convoy",
    alias: "OS",
    color: "#6366f1",
    notifications: 2,
    unreadThreads: 0,
    lists: [
      { id: "m2", name: "Milestone 2", color: "#f59e0b" },
      { id: "bugs", name: "Bugs", color: "#ef4444" },
      { id: "landing", name: "Landing", color: "#10b981" },
    ],
  },
  {
    id: "web",
    name: "Marketing site",
    alias: "WEB",
    color: "#0ea5e9",
    notifications: 5,
    unreadThreads: 3,
    lists: [{ id: "launch", name: "Launch", color: "#8b5cf6" }],
  },
  { id: "ops", name: "Infrastructure", alias: "OPS", color: "#f97316", notifications: 0, unreadThreads: 1, lists: [] },
  {
    id: "mob",
    name: "Mobile app",
    alias: "MOB",
    color: "#14b8a6",
    notifications: 0,
    unreadThreads: 0,
    lists: [
      { id: "ios", name: "iOS", color: "#64748b" },
      { id: "android", name: "Android", color: "#22c55e" },
    ],
  },
];

const ORGANIZATIONS: Organization[] = [
  { id: "opensana", name: "Opensana", color: "#6366f1", projects: OPENSANA_PROJECTS },
  {
    id: "acme",
    name: "Acme",
    color: "#ef4444",
    projects: [
      { id: "shop", name: "Storefront", alias: "SHOP", color: "#ec4899", notifications: 1, unreadThreads: 0, lists: [] },
      {
        id: "api",
        name: "Public API",
        alias: "API",
        color: "#84cc16",
        notifications: 0,
        unreadThreads: 2,
        lists: [{ id: "v2", name: "v2", color: "#0ea5e9" }],
      },
    ],
  },
];

const ALL_PROJECTS = ORGANIZATIONS.flatMap((organization) => organization.projects);

// Every page is per project and exists in every project, so switching keeps you on the same page.
const PROJECT_PAGES = [
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "watch-tower", label: "Watch Tower", icon: TowerControl },
  { id: "threads", label: "Threads", icon: BotMessageSquare },
  { id: "pulls", label: "Pull requests", icon: GitPullRequest },
  { id: "settings", label: "Project settings", icon: Settings },
] as const;

// Every project has these; Inbox is the default persisted List, the other two are system Lists.
const BUILT_IN_LISTS = [
  { id: "backlog", label: "Backlog", icon: CircleDashed },
  { id: "archived", label: "Archived", icon: Archive },
  { id: "inbox", label: "Inbox", icon: Circle },
] as const;

const FIXED_PAGES = [...PROJECT_PAGES, ...BUILT_IN_LISTS, { id: "org-settings", label: "Organization settings" }];

/** One project in the sidebar at a time, picked from a selector at the top (OS-1755). */
export default function SingleProjectSidebarPlaygroundPage() {
  const [projectId, setProjectId] = useState("os");
  const [page, setPage] = useState("inbox");
  const project = ALL_PROJECTS.find((candidate) => candidate.id === projectId)!;
  const organization = ORGANIZATIONS.find((candidate) => candidate.projects.includes(project))!;

  const switchProject = (id: string) => {
    setProjectId(id);
    // A pinned List exists only in its own project; land on the new project's Inbox.
    if (!FIXED_PAGES.some((candidate) => candidate.id === page)) setPage("inbox");
  };

  const pageLabel =
    [...FIXED_PAGES, ...project.lists.map((list) => ({ id: list.id, label: list.name }))].find(
      (candidate) => candidate.id === page
    )?.label ?? "Inbox";
  const badges: Record<string, number> = {
    notifications: project.notifications,
    threads: project.unreadThreads,
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="none" className="sticky top-0 h-svh border-r">
        <SidebarHeader className="pt-3">
          <ProjectSelector organization={organization} project={project} onSelect={switchProject} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton className="cursor-pointer font-medium">
                  <Plus className="size-4" />
                  <span>Add task</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {PROJECT_PAGES.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton className="cursor-pointer" isActive={page === item.id} onClick={() => setPage(item.id)}>
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  <UnreadBadge count={badges[item.id] ?? 0} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Lists</SidebarGroupLabel>
            <SidebarMenu>
              {BUILT_IN_LISTS.map((list) => (
                <SidebarMenuItem key={list.id}>
                  <SidebarMenuButton className="cursor-pointer" isActive={page === list.id} onClick={() => setPage(list.id)}>
                    <list.icon className="size-3.5 text-muted-foreground" />
                    <span>{list.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            {project.lists.length > 0 && <SidebarSeparator className="my-2" style={{ width: "calc(100% - 1rem)" }} />}
            <SidebarMenu>
              {project.lists.map((list) => (
                <SidebarMenuItem key={list.id}>
                  <SidebarMenuButton className="cursor-pointer" isActive={page === list.id} onClick={() => setPage(list.id)}>
                    <Circle className="size-3.5" style={{ color: list.color }} />
                    <span>{list.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="sm" className="cursor-pointer" isActive={page === "org-settings"} onClick={() => setPage("org-settings")}>
                <Settings className="size-4" />
                <span>Organization settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarSeparator className="my-0" style={{ width: "calc(100% - 1rem)" }} />
          <KeyboardShortcutsButton />
          <SidebarMenu>
            <SidebarMenuItem>
              <UserMenu organization={organization} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-1.5 border-b px-4 text-sm">
          <Hash className="size-4 shrink-0" style={{ color: project.color }} />
          <span className="truncate text-muted-foreground">{page === "org-settings" ? organization.name : project.name}</span>
          <span className="text-muted-foreground">/</span>
          <span className="truncate font-medium">{pageLabel}</span>
        </header>
        <div className="flex-1 p-6">
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            {pageLabel} for {project.name}
          </div>
        </div>
      </main>
    </SidebarProvider>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <SidebarMenuBadge className="right-2 h-4.5 min-w-4.5 rounded-full bg-destructive px-1 text-[10px] font-medium text-white peer-hover/menu-button:text-white">
      {count}
    </SidebarMenuBadge>
  );
}

function ProjectSelector({
  organization,
  project,
  onSelect,
}: {
  organization: Organization;
  project: Project;
  onSelect: (id: string) => void;
}) {
  // Other projects are out of sight, so the selector carries their unread state.
  const otherUnread = ALL_PROJECTS.some((candidate) => candidate.id !== project.id && unreadCount(candidate) > 0);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="cursor-pointer data-[state=open]:bg-sidebar-accent">
              <ProjectTile project={project} className="size-8 text-xs" />
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{project.name}</span>
                <span className="truncate text-xs text-muted-foreground">{organization.name}</span>
              </span>
              {otherUnread && <span aria-label="Unread in other projects" className="size-2 shrink-0 rounded-full bg-destructive" />}
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
            <ProjectItems projects={organization.projects} currentId={project.id} onSelect={onSelect} />
            <DropdownMenuItem className="cursor-pointer gap-2">
              <Plus className="size-4" />
              New project
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
            {/* The current organization's projects are already listed above. */}
            {ORGANIZATIONS.filter((candidate) => candidate.id !== organization.id).map((candidate) => {
              const unread = candidate.projects.reduce((sum, item) => sum + unreadCount(item), 0);
              return (
                <DropdownMenuSub key={candidate.id}>
                  <DropdownMenuSubTrigger className="cursor-pointer gap-2">
                    <OrganizationTile organization={candidate} />
                    <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                    {unread > 0 && <span className="text-xs text-destructive">{unread}</span>}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-48 rounded-lg">
                    <ProjectItems projects={candidate.projects} currentId={project.id} onSelect={onSelect} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}
            <DropdownMenuItem className="cursor-pointer gap-2">
              <Plus className="size-4" />
              New organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function ProjectItems({
  projects,
  currentId,
  onSelect,
}: {
  projects: Project[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  return projects.map((candidate) => (
    <DropdownMenuItem key={candidate.id} className="cursor-pointer gap-2" onSelect={() => onSelect(candidate.id)}>
      <ProjectTile project={candidate} className="size-5 text-[9px]" />
      <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
      {unreadCount(candidate) > 0 && <span className="text-xs text-destructive">{unreadCount(candidate)}</span>}
      {candidate.id === currentId && <Check className="size-4" />}
    </DropdownMenuItem>
  ));
}

function unreadCount(project: Project) {
  return project.notifications + project.unreadThreads;
}

// Mirrors NavUser's trigger; organization switching moved to the project selector.
function UserMenu({ organization }: { organization: Organization }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" className="cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
          <Avatar className="size-8 rounded-lg">
            <AvatarFallback className="rounded-lg text-xs">PT</AvatarFallback>
          </Avatar>
          <span className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">Pavlo Tkhir</span>
            <span className="truncate text-xs text-muted-foreground">{organization.name}</span>
          </span>
          <ChevronsUpDown className="ml-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={4} className="min-w-56 rounded-lg">
        <DropdownMenuItem className="cursor-pointer">
          <UserCog />
          Profile settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer">
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OrganizationTile({ organization }: { organization: Organization }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
      style={{ backgroundColor: organization.color }}
    >
      {organization.name[0]}
    </span>
  );
}

function ProjectTile({ project, className }: { project: Project; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex shrink-0 items-center justify-center rounded-md font-semibold text-white", className)}
      style={{ backgroundColor: project.color }}
    >
      {project.alias.slice(0, 2)}
    </span>
  );
}
