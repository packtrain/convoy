/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TaskTypesSection } from "./task-types-section";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizations: {
      members: {
        getMyRole: { _type: "query", name: "organizations/members.getMyRole" },
      },
    },
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => (
    <button {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    htmlFor,
  }: {
    children: ReactNode;
    htmlFor?: string;
  }) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/custom/color-picker", () => ({
  ColorPicker: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
    allowEmpty?: boolean;
  }) => (
    <button type="button" onClick={() => onChange(value ?? "#ef4444")}>
      Pick color
    </button>
  ),
}));

vi.mock("@/components/blocks/tasks/task-ref-with-type", () => ({
  TaskType: ({ taskType }: { taskType: { key: string; name: string } }) => (
    <span data-testid={`task-type-${taskType.key}`}>{taskType.name}</span>
  ),
}));

describe("TaskTypesSection", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue("owner");
  });

  test("renders all built-in task types as a read-only list", () => {
    render(<TaskTypesSection organizationId={"org_1" as never} />);

    expect(screen.getByText("Manage organization-wide task types.")).toBeTruthy();
    expect(screen.getByTestId("task-type-task")).toBeTruthy();
    expect(screen.getByTestId("task-type-bug")).toBeTruthy();
    expect(screen.getByTestId("task-type-feature")).toBeTruthy();
    expect(screen.getByTestId("task-type-epic")).toBeTruthy();
    expect(screen.getByTestId("task-type-investigation")).toBeTruthy();
    expect(screen.getByTestId("task-type-chore")).toBeTruthy();
  });

  test("shows disabled 'Soon' badge and disabled create form", () => {
    render(<TaskTypesSection organizationId={"org_1" as never} />);

    expect(screen.getByText("Soon")).toBeTruthy();

    const createButton = screen.getByRole("button", { name: /create/i });
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
  });

  test("shows permission message for non-admin users", () => {
    useQueryMock.mockReturnValue("member");

    render(<TaskTypesSection organizationId={"org_1" as never} />);

    expect(
      screen.getByText(/only organization admins can manage task types/i)
    ).toBeTruthy();
  });
});
