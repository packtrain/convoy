/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { NavUser } from "./nav-user";

const signOutMock = vi.fn();
const openOrgDialogMock = vi.fn();
const dropdownTriggerClickMock = vi.fn();
let isMobileSidebar = false;
const organizations = [
  {
    _id: "org_1" as Id<"organizations">,
    name: "Acme Workspace",
    slug: "acme",
    role: "admin",
    color: "#2563eb",
    avatarUrl: undefined,
  },
  {
    _id: "org_2" as Id<"organizations">,
    name: "Beta Workspace",
    slug: "beta",
    role: "member",
    color: undefined,
    avatarUrl: undefined,
  },
];

vi.mock("@/lib/auth/hooks", () => ({
  supportsSignOut: true,
  useAppSignOut: () => signOutMock,
  useAppUser: () => ({
    isLoaded: true,
    user: {
      firstName: "Robin",
      lastName: "Hale",
      fullName: "Robin Hale",
      email: "robin@example.com",
      imageUrl: "https://example.com/avatar.png",
    },
  }),
}));

vi.mock("convex/react", () => ({
  useQuery: () => organizations,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizations: {
      core: {
        listForUser: "listForUser",
      },
    },
  },
}));

vi.mock("next/image", () => ({
  default: ({
    alt,
    className,
  }: {
    alt?: string;
    className?: string;
    src?: string;
  }) => <span aria-label={alt} className={className} role="img" />,
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div className={className} data-avatar>
      {children}
    </div>
  ),
  AvatarFallback: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AvatarImage: ({ alt }: { alt?: string; src?: string }) => (
    <span aria-label={alt} role="img" />
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
    variant?: string;
  }) => <span className={className}>{children}</span>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    className,
    onClick,
  }: {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    asChild?: boolean;
  }) => (
    <button className={className} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) =>
    isValidElement<ComponentProps<"button">>(children)
      ? cloneElement(children, {
          onClick: dropdownTriggerClickMock,
        })
      : <>{children}</>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({
    children,
    className,
    onClick,
    size,
    ...props
  }: {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    size?: string;
  } & ComponentProps<"button">) => (
    <button
      className={className}
      data-size={size ?? "default"}
      type="button"
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({
    isMobile: isMobileSidebar,
  }),
}));

vi.mock("@/components/blocks/mobile/mobile-drawer-panel", () => ({
  MobileDrawerPanel: ({
    children,
    open,
  }: {
    children: ReactNode;
    open: boolean;
    onClose: () => void;
    compact?: boolean;
  }) => (open ? <div data-testid="mobile-user-drawer">{children}</div> : null),
}));

vi.mock("@/components/blocks/user/settings", () => ({
  UserSettingsDialog: () => null,
}));

vi.mock("@/components/blocks/organization/organization-dialog", () => ({
  OrganizationDialog: () => null,
}));

vi.mock("@/hooks/ui/use-dialog", () => ({
  useDialogWithData: () => ({
    close: vi.fn(),
    data: undefined,
    isOpen: false,
    open: openOrgDialogMock,
  }),
}));

vi.mock("@/lib/navigation", () => ({
  AppLink: ({
    children,
    href,
    onClick,
  }: {
    children: ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
  appRoute: {
    organization: (slug: string) => `/o/${slug}`,
  },
}));

describe("NavUser", () => {
  afterEach(() => {
    cleanup();
    signOutMock.mockReset();
    openOrgDialogMock.mockReset();
    dropdownTriggerClickMock.mockReset();
    isMobileSidebar = false;
  });

  test("forwards desktop dropdown trigger events to the button", () => {
    render(<NavUser currentOrgId={"org_1" as Id<"organizations">} />);

    const trigger = screen.getAllByRole("button")[0];

    fireEvent.click(trigger);

    expect(dropdownTriggerClickMock).toHaveBeenCalledTimes(1);
  });

  test("shows the selected organization under the user name in the trigger", () => {
    render(<NavUser currentOrgId={"org_1" as Id<"organizations">} />);

    const trigger = screen.getAllByRole("button")[0];

    expect(trigger.textContent).not.toContain("robin@example.com");
    expect(trigger.textContent).toContain("Robin Hale");
    expect(trigger.textContent).toContain("Acme Workspace");
    expect(trigger.querySelector("[style]")).toBeNull();
    expect(screen.getAllByText("robin@example.com")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /profile settings/i })).toBeDefined();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.getByRole("button", { name: /log out/i })).toBeDefined();
  });

  test("uses the larger footer trigger button and user avatar", () => {
    render(<NavUser currentOrgId={"org_1" as Id<"organizations">} />);

    const trigger = screen.getAllByRole("button")[0];
    const triggerAvatar = trigger.querySelector("[data-avatar]");

    expect(trigger.getAttribute("data-size")).toBe("lg");
    expect(trigger.getAttribute("class")).toContain("group-data-[collapsible=icon]:p-0!");
    expect(trigger.getAttribute("class")).toContain(
      "group-data-[collapsible=icon]:justify-center"
    );
    expect(triggerAvatar?.getAttribute("class")).toContain("size-8");
    expect(triggerAvatar?.getAttribute("class")).toContain(
      "group-data-[collapsible=icon]:size-7"
    );
  });

  test("lists organizations in the dropdown with color only on dropdown icons", () => {
    render(<NavUser currentOrgId={"org_1" as Id<"organizations">} />);

    expect(screen.getAllByText("Acme Workspace")).toHaveLength(2);
    expect(screen.getByText("Beta Workspace")).toBeDefined();
    expect(screen.getByText("admin")).toBeDefined();
    expect(screen.queryByText("member")).toBeNull();
    expect(screen.getByText("New organization")).toBeDefined();

    const organizationIcon = screen
      .getAllByText("Acme Workspace")[1]
      .closest("button")
      ?.querySelector("[style]");

    expect(organizationIcon?.getAttribute("style")).toContain("background-color");
  });

  test("uses a bottom drawer for the user menu on mobile", () => {
    isMobileSidebar = true;
    render(<NavUser currentOrgId={"org_1" as Id<"organizations">} />);

    expect(screen.queryByTestId("mobile-user-drawer")).toBeNull();

    fireEvent.click(screen.getAllByRole("button")[0]);

    expect(screen.getByTestId("mobile-user-drawer")).toBeDefined();
    expect(screen.getAllByText("Acme Workspace")).toHaveLength(2);
    expect(screen.getByText("Beta Workspace")).toBeDefined();
    expect(screen.getByRole("button", { name: /profile settings/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /log out/i })).toBeDefined();
  });
});
