import { describe, expect, it } from "vitest";
import {
  filterProjectsByOrgRef,
  resolveProjectId,
  summarizeOrganizations,
  type AccessibleOrganization,
  type AccessibleProject,
} from "./project-resolution.js";

const organization = (
  id: string,
  slug: string,
  name: string
): AccessibleOrganization =>
  ({
    _id: id,
    slug,
    name,
  }) as AccessibleOrganization;

const projects: AccessibleProject[] = [
  {
    _id: "proj_web_1" as AccessibleProject["_id"],
    name: "Web",
    alias: "WEB",
    organizationId: "org_acme" as AccessibleProject["organizationId"],
    organizationName: "Acme",
    organizationSlug: "acme",
    role: { name: "org-owner", permissions: ["*"] },
  },
  {
    _id: "proj_api_1" as AccessibleProject["_id"],
    name: "API",
    alias: "API",
    organizationId: "org_acme" as AccessibleProject["organizationId"],
    organizationName: "Acme",
    organizationSlug: "acme",
    role: { name: "org-owner", permissions: ["*"] },
  },
  {
    _id: "proj_web_2" as AccessibleProject["_id"],
    name: "Web 2",
    alias: "WEB",
    organizationId: "org_beta" as AccessibleProject["organizationId"],
    organizationName: "Beta",
    organizationSlug: "beta",
    role: { name: "org-admin", permissions: ["*"] },
  },
];

describe("project resolution", () => {
  it("filters by org id and slug", () => {
    expect(filterProjectsByOrgRef(projects, "org_acme")).toHaveLength(2);
    expect(filterProjectsByOrgRef(projects, "beta")).toHaveLength(1);
  });

  it("uses default project when project ref is omitted", () => {
    expect(resolveProjectId({ projects, defaultProjectId: "proj_default" })).toBe(
      "proj_default"
    );
  });

  it("resolves by exact project id", () => {
    expect(resolveProjectId({ projects, projectRef: "proj_api_1" })).toBe(
      "proj_api_1"
    );
  });

  it("resolves by alias when unique", () => {
    expect(resolveProjectId({ projects, projectRef: "API" })).toBe("proj_api_1");
  });

  it("rejects ambiguous alias without org", () => {
    expect(() => resolveProjectId({ projects, projectRef: "WEB" })).toThrow(
      /ambiguous/
    );
  });

  it("resolves ambiguous alias with org", () => {
    expect(
      resolveProjectId({ projects, projectRef: "WEB", orgRef: "acme" })
    ).toBe("proj_web_1");
    expect(
      resolveProjectId({ projects, projectRef: "WEB", orgRef: "org_beta" })
    ).toBe("proj_web_2");
  });

  it("rejects org without project", () => {
    expect(() => resolveProjectId({ projects, orgRef: "acme" })).toThrow(
      /requires --project/
    );
  });

  it("summarizes organizations with project counts", () => {
    const organizations = [
      organization("org_beta", "beta", "Beta"),
      organization("org_acme", "acme", "Acme"),
    ];

    expect(summarizeOrganizations(organizations, projects)).toEqual([
      {
        organizationId: "org_acme",
        organizationSlug: "acme",
        organizationName: "Acme",
        projectCount: 2,
      },
      {
        organizationId: "org_beta",
        organizationSlug: "beta",
        organizationName: "Beta",
        projectCount: 1,
      },
    ]);
  });

  it("keeps organizations that have no accessible project", () => {
    const organizations = [organization("org_empty", "empty", "Empty")];

    expect(summarizeOrganizations(organizations, projects)).toEqual([
      {
        organizationId: "org_empty",
        organizationSlug: "empty",
        organizationName: "Empty",
        projectCount: 0,
      },
    ]);
  });
});
