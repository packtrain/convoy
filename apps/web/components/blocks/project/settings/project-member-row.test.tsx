/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ProjectMemberRow } from "./project-member-row";

const useMutationMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useMutation: useMutationMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    projects: {
      members: {
        updateRole: { _type: "mutation", name: "projects.members.updateRole" },
        remove: { _type: "mutation", name: "projects.members.remove" },
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock("@/lib/errors", () => ({
  showConvexErrorToast: vi.fn(),
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/blocks/project/project-role-select", () => ({
  getProjectRoleLabel: (value: string) =>
    value === "project-admin" ? "Project Admin" : value,
  ProjectRoleSelect: ({
    value,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    className?: string;
  }) => <button type="button">Project Admin: {value}</button>,
}));

vi.mock("@/components/ui/role-badge", () => ({
  RoleBadge: ({ label }: { label: string }) => <span>{label}</span>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("lucide-react", () => ({
  X: () => <span aria-hidden="true">x</span>,
}));

describe("ProjectMemberRow", () => {
  beforeEach(() => {
    useMutationMock.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    cleanup();
    useMutationMock.mockReset();
  });

  test("allows managing a project admin even when it is the only explicit admin row", () => {
    render(
      <ProjectMemberRow
        member={{
          _id: "project_member_1" as never,
          userId: "user_1" as never,
          role: "project-admin",
          name: "Ada Lovelace",
          email: "ada@example.com",
        }}
        projectId={"project_1" as never}
        canManage
        isCurrentUser={false}
      />
    );

    expect(screen.getByRole("button", { name: /project admin/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Ada Lovelace" })).toBeTruthy();
  });
});
