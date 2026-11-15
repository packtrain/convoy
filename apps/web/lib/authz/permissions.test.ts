import { describe, expect, test } from "vitest";
import {
  OrgPermission,
  ProjectPermission,
  hasOrgPermission,
  hasProjectPermission,
  getOrgPermissions,
  getProjectPermissions,
} from "./permissions";
import { OrgRole, ProjectRole } from "./roles";

describe("Organization permissions", () => {
  describe("owner", () => {
    test("has all permissions", () => {
      const allPermissions = Object.values(OrgPermission);
      for (const permission of allPermissions) {
        expect(hasOrgPermission(OrgRole.OWNER, permission)).toBe(true);
      }
    });
  });

  describe("admin", () => {
    test("can update org", () => {
      expect(hasOrgPermission(OrgRole.ADMIN, OrgPermission.ORG_UPDATE)).toBe(
        true
      );
    });

    test("cannot delete org", () => {
      expect(hasOrgPermission(OrgRole.ADMIN, OrgPermission.ORG_DELETE)).toBe(
        false
      );
    });

    test("can manage members", () => {
      expect(hasOrgPermission(OrgRole.ADMIN, OrgPermission.MEMBERS_INVITE)).toBe(
        true
      );
      expect(hasOrgPermission(OrgRole.ADMIN, OrgPermission.MEMBERS_REMOVE)).toBe(
        true
      );
      expect(
        hasOrgPermission(OrgRole.ADMIN, OrgPermission.MEMBERS_UPDATE_ROLE)
      ).toBe(true);
    });

    test("can manage projects", () => {
      expect(hasOrgPermission(OrgRole.ADMIN, OrgPermission.PROJECT_CREATE)).toBe(
        true
      );
      expect(hasOrgPermission(OrgRole.ADMIN, OrgPermission.PROJECT_DELETE)).toBe(
        true
      );
      expect(
        hasOrgPermission(OrgRole.ADMIN, OrgPermission.PROJECTS_MANAGE_ALL)
      ).toBe(true);
    });

    test("can manage slash commands", () => {
      expect(
        hasOrgPermission(OrgRole.ADMIN, OrgPermission.SLASH_COMMANDS_MANAGE)
      ).toBe(true);
    });

    test("can manage agent templates", () => {
      expect(
        hasOrgPermission(OrgRole.ADMIN, OrgPermission.AGENTS_MANAGE)
      ).toBe(true);
    });

    test("can manage skills", () => {
      expect(hasOrgPermission(OrgRole.ADMIN, OrgPermission.SKILLS_MANAGE)).toBe(
        true
      );
    });
  });

  describe("member", () => {
    test("can only create projects", () => {
      expect(
        hasOrgPermission(OrgRole.MEMBER, OrgPermission.PROJECT_CREATE)
      ).toBe(true);
    });

    test("cannot update or delete org", () => {
      expect(hasOrgPermission(OrgRole.MEMBER, OrgPermission.ORG_UPDATE)).toBe(
        false
      );
      expect(hasOrgPermission(OrgRole.MEMBER, OrgPermission.ORG_DELETE)).toBe(
        false
      );
    });

    test("cannot manage members", () => {
      expect(
        hasOrgPermission(OrgRole.MEMBER, OrgPermission.MEMBERS_INVITE)
      ).toBe(false);
      expect(
        hasOrgPermission(OrgRole.MEMBER, OrgPermission.MEMBERS_REMOVE)
      ).toBe(false);
      expect(
        hasOrgPermission(OrgRole.MEMBER, OrgPermission.MEMBERS_UPDATE_ROLE)
      ).toBe(false);
    });

    test("cannot delete projects", () => {
      expect(
        hasOrgPermission(OrgRole.MEMBER, OrgPermission.PROJECT_DELETE)
      ).toBe(false);
    });

    test("cannot manage all projects", () => {
      expect(
        hasOrgPermission(OrgRole.MEMBER, OrgPermission.PROJECTS_MANAGE_ALL)
      ).toBe(false);
    });

    test("cannot manage slash commands", () => {
      expect(
        hasOrgPermission(OrgRole.MEMBER, OrgPermission.SLASH_COMMANDS_MANAGE)
      ).toBe(false);
    });

    test("cannot manage agent templates", () => {
      expect(
        hasOrgPermission(OrgRole.MEMBER, OrgPermission.AGENTS_MANAGE)
      ).toBe(false);
    });

    test("cannot manage skills", () => {
      expect(hasOrgPermission(OrgRole.MEMBER, OrgPermission.SKILLS_MANAGE)).toBe(
        false
      );
    });
  });

  describe("getOrgPermissions", () => {
    test("returns correct permissions for each role", () => {
      expect(getOrgPermissions(OrgRole.OWNER)).toHaveLength(11);
      expect(getOrgPermissions(OrgRole.ADMIN)).toHaveLength(10);
      expect(getOrgPermissions(OrgRole.MEMBER)).toHaveLength(1);
    });
  });

  test("missing roles have no permissions", () => {
    expect(hasOrgPermission(null, OrgPermission.ORG_UPDATE)).toBe(false);
    expect(hasOrgPermission(undefined, OrgPermission.ORG_UPDATE)).toBe(false);
  });
});

describe("Project permissions", () => {
  describe("project-admin", () => {
    test("has all permissions", () => {
      const allPermissions = Object.values(ProjectPermission);
      for (const permission of allPermissions) {
        expect(hasProjectPermission(ProjectRole.PROJECT_ADMIN, permission)).toBe(true);
      }
    });
  });

  describe("member", () => {
    test("can view and manage tasks", () => {
      expect(
        hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.TASK_VIEW)
      ).toBe(true);
      expect(
        hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.TASK_CREATE)
      ).toBe(true);
      expect(
        hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.TASK_UPDATE)
      ).toBe(true);
      expect(
        hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.TASK_DELETE)
      ).toBe(true);
    });

    test("can view project", () => {
      expect(
        hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.PROJECT_VIEW)
      ).toBe(true);
    });

    test("can manage lists", () => {
      expect(
        hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.LIST_MANAGE)
      ).toBe(true);
    });

    test("can manage project agents", () => {
      expect(
        hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.AGENTS_MANAGE)
      ).toBe(true);
    });

    test("can manage project slash commands", () => {
      expect(hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.SLASH_COMMANDS_MANAGE)).toBe(true);
    });

    test("can manage project skills", () => {
      expect(hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.SKILLS_MANAGE)).toBe(true);
    });

    test("cannot pin lists", () => {
      expect(
        hasProjectPermission(ProjectRole.MEMBER, ProjectPermission.LIST_PIN)
      ).toBe(false);
    });

    test("cannot update or archive project", () => {
      expect(
        hasProjectPermission(
          ProjectRole.MEMBER,
          ProjectPermission.PROJECT_UPDATE
        )
      ).toBe(false);
      expect(
        hasProjectPermission(
          ProjectRole.MEMBER,
          ProjectPermission.PROJECT_ARCHIVE
        )
      ).toBe(false);
    });

    test("cannot manage project members", () => {
      expect(
        hasProjectPermission(
          ProjectRole.MEMBER,
          ProjectPermission.PROJECT_MEMBERS_ADD
        )
      ).toBe(false);
      expect(
        hasProjectPermission(
          ProjectRole.MEMBER,
          ProjectPermission.PROJECT_MEMBERS_REMOVE
        )
      ).toBe(false);
    });
  });

  describe("viewer", () => {
    test("can only view", () => {
      expect(
        hasProjectPermission(ProjectRole.VIEWER, ProjectPermission.PROJECT_VIEW)
      ).toBe(true);
      expect(
        hasProjectPermission(ProjectRole.VIEWER, ProjectPermission.TASK_VIEW)
      ).toBe(true);
    });

    test("cannot create, update, or delete tasks", () => {
      expect(
        hasProjectPermission(ProjectRole.VIEWER, ProjectPermission.TASK_CREATE)
      ).toBe(false);
      expect(
        hasProjectPermission(ProjectRole.VIEWER, ProjectPermission.TASK_UPDATE)
      ).toBe(false);
      expect(
        hasProjectPermission(ProjectRole.VIEWER, ProjectPermission.TASK_DELETE)
      ).toBe(false);
    });

    test("cannot manage project", () => {
      expect(
        hasProjectPermission(
          ProjectRole.VIEWER,
          ProjectPermission.PROJECT_UPDATE
        )
      ).toBe(false);
      expect(
        hasProjectPermission(
          ProjectRole.VIEWER,
          ProjectPermission.PROJECT_ARCHIVE
        )
      ).toBe(false);
      expect(
        hasProjectPermission(
          ProjectRole.VIEWER,
          ProjectPermission.PROJECT_MEMBERS_ADD
        )
      ).toBe(false);
    });

    test("cannot manage lists", () => {
      expect(
        hasProjectPermission(ProjectRole.VIEWER, ProjectPermission.LIST_MANAGE)
      ).toBe(false);
      expect(
        hasProjectPermission(ProjectRole.VIEWER, ProjectPermission.LIST_PIN)
      ).toBe(false);
    });

    test("cannot manage project agents", () => {
      expect(
        hasProjectPermission(ProjectRole.VIEWER, ProjectPermission.AGENTS_MANAGE)
      ).toBe(false);
    });

    test("cannot manage project skills", () => {
      expect(hasProjectPermission(ProjectRole.VIEWER, ProjectPermission.SKILLS_MANAGE)).toBe(false);
    });
  });

  describe("getProjectPermissions", () => {
    test("returns correct permissions for each role", () => {
      expect(getProjectPermissions(ProjectRole.PROJECT_ADMIN)).toHaveLength(19);
      expect(getProjectPermissions(ProjectRole.MEMBER)).toHaveLength(13);
      expect(getProjectPermissions(ProjectRole.VIEWER)).toHaveLength(2);
    });
  });

  test("missing roles have no permissions", () => {
    expect(hasProjectPermission(null, ProjectPermission.TASK_UPDATE)).toBe(
      false
    );
    expect(hasProjectPermission(undefined, ProjectPermission.TASK_UPDATE)).toBe(
      false
    );
  });
});
