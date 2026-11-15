/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SettingsPageContent } from "./settings-page-content";

const replaceMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@/lib/navigation", () => ({
  appRoute: {
    organizationSettings: (organizationSlug: string, section: string) => ({
      pathname: `/o/${organizationSlug}/settings/${section}`,
    }),
  },
  useNavigation: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/lib/routing/current-org-project-context", () => ({
  useCurrentOrgProject: () => ({
    organizationId: "org_1",
    organizationSlug: "acme",
    projectAlias: null,
  }),
}));

vi.mock("@/components/blocks/organization/settings/general-section", () => ({
  GeneralSection: ({ showHeader }: { showHeader?: boolean }) => (
    <div>General content {showHeader ? "with header" : "without header"}</div>
  ),
}));

vi.mock("@/components/blocks/organization/settings/members-section", () => ({
  MembersSection: ({ showHeader }: { showHeader?: boolean }) => (
    <div>Members content {showHeader ? "with header" : "without header"}</div>
  ),
}));

vi.mock("@/components/blocks/organization/settings/projects-section", () => ({
  ProjectsSection: ({
    organizationId,
    organizationSlug,
  }: {
    organizationId: string;
    organizationSlug: string;
  }) => (
    <div>
      Projects content for {organizationId} / {organizationSlug}
    </div>
  ),
}));

vi.mock(
  "@/components/blocks/organization/settings/prompts/slash-commands-section",
  () => ({
    SlashCommandsSection: ({
      organizationId,
      organizationSlug,
    }: {
      organizationId: string;
      organizationSlug: string;
    }) => (
      <div>
        Prompts content for {organizationId} / {organizationSlug}
      </div>
    ),
  })
);

vi.mock("@/components/blocks/organization/settings/agents/agents-section", () => ({
  AgentsSection: ({
    organizationId,
    organizationSlug,
  }: {
    organizationId: string;
    organizationSlug: string;
  }) => (
    <div>
      Agents content for {organizationId} / {organizationSlug}
    </div>
  ),
}));

vi.mock("@/components/blocks/organization/settings/danger-section", () => ({
  DangerSection: () => <div>Danger Zone content</div>,
}));

describe("SettingsPageContent", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    replaceMock.mockReset();
  });

  test("renders general settings with danger zone content", () => {
    useQueryMock.mockReturnValue({ _id: "org_1", name: "Acme", slug: "acme" });

    render(<SettingsPageContent section="general" />);

    expect(screen.getByText("General content without header")).toBeDefined();
    expect(screen.getByText("Danger Zone content")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Organization" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Danger zone" }).className).toContain("text-destructive");
    expect(screen.queryByText("Members content without header")).toBeNull();
  });

  test("renders members settings without danger zone content", () => {
    useQueryMock.mockReturnValue({ _id: "org_1", name: "Acme", slug: "acme" });

    render(<SettingsPageContent section="members" />);

    expect(screen.getByText("Members content without header")).toBeDefined();
    expect(screen.queryByText("General content without header")).toBeNull();
    expect(screen.queryByText("Danger Zone content")).toBeNull();
  });

  test("renders the projects section for the projects slug", () => {
    useQueryMock.mockReturnValue({ _id: "org_1", name: "Acme", slug: "acme" });

    render(<SettingsPageContent section="projects" />);

    expect(screen.getByText("Projects content for org_1 / acme")).toBeDefined();
    expect(screen.queryByText("Members content without header")).toBeNull();
    expect(screen.queryByText("General content without header")).toBeNull();
    expect(screen.queryByText("Danger Zone content")).toBeNull();
  });

  test("renders prompts settings without general or members content", () => {
    useQueryMock.mockReturnValue({ _id: "org_1", name: "Acme", slug: "acme" });

    render(<SettingsPageContent section="prompts" />);

    expect(screen.getByText("Prompts content for org_1 / acme")).toBeDefined();
    expect(screen.queryByText("Members content without header")).toBeNull();
    expect(screen.queryByText("General content without header")).toBeNull();
    expect(screen.queryByText("Danger Zone content")).toBeNull();
  });

  test("renders agents settings without general or members content", () => {
    useQueryMock.mockReturnValue({ _id: "org_1", name: "Acme", slug: "acme" });

    render(<SettingsPageContent section="agents" />);

    expect(screen.getByText("Agents content for org_1 / acme")).toBeDefined();
    expect(screen.queryByText("Members content without header")).toBeNull();
    expect(screen.queryByText("General content without header")).toBeNull();
    expect(screen.queryByText("Danger Zone content")).toBeNull();
  });
});
