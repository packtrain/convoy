import { describe, expect, test } from "vitest";
import { href } from "./target";
import {
  buildProjectRouteTarget,
  normalizeProjectParams,
  parseProjectParams,
  projectEntryTarget,
  resolveDefaultView,
  updateProjectParams,
  withProjectArtifact,
  withProjectList,
  withProjectTask,
  withProjectTaskAndArchive,
} from "./project-state";
import { BACKLOG_LIST_REF } from "@/lib/task-lists/system-lists";

describe("project navigation state", () => {
  test("preserves project query semantics when opening tasks and artifacts", () => {
    const base = parseProjectParams(
      new URLSearchParams([
        ["filter", "done"],
        ["assignee", "me"],
        ["list", "L-1"],
      ])
    );

    expect(href(withProjectTask("/o/acme/WEB", base, "WEB-1")))
      .toBe("/o/acme/WEB?task=WEB-1&filter=done&assignee=me&list=L-1");

    expect(
      href(
        withProjectArtifact("/o/acme/WEB", base, "artifact-1")
      )
    ).toBe("/o/acme/WEB?artifact=artifact-1&filter=done&assignee=me&list=L-1");
  });

  test("archive, status, assignee, and list updates normalize the URL", () => {
    const base = parseProjectParams(new URLSearchParams([["task", "WEB-1"]]));

    expect(
      href(
        withProjectTaskAndArchive("/o/acme/WEB", base, "WEB-1", true)
      )
    ).toBe("/o/acme/WEB?task=WEB-1&archived=true");

    expect(
      href(
        buildProjectRouteTarget("/o/acme/WEB", updateProjectParams(base, {
          list: BACKLOG_LIST_REF,
          assignee: { type: "me" },
          archived: false,
        }))
      )
    ).toBe("/o/acme/WEB?task=WEB-1&assignee=me&list=BACKLOG");
  });

  test("list filter targets are pure route targets", () => {
    expect(
      href(
        withProjectList("/o/acme/WEB", parseProjectParams(new URLSearchParams()), "L-2")
      )
    ).toBe("/o/acme/WEB?list=L-2");
  });

  test("invalid status filters do not select a List", () => {
    const base = parseProjectParams(
      new URLSearchParams([
        ["filter", "backlog"],
        ["view", "board"],
      ])
    );

    expect(base.filter).toBeUndefined();
    expect(base.list).toBeUndefined();
    expect(href(withProjectList("/o/acme/WEB", base, "SPRINT-1")))
      .toBe("/o/acme/WEB?list=SPRINT-1&view=board");
  });

  test("normalizes valid and invalid Board groupBy values", () => {
    const valid = parseProjectParams(
      new URLSearchParams([["groupBy", "assignee"]])
    );
    const invalid = parseProjectParams(
      new URLSearchParams([["groupBy", "unknown"]])
    );

    expect(valid.groupBy).toBe("assignee");
    expect(invalid.groupBy).toBeUndefined();
    expect(
      href(buildProjectRouteTarget("/o/acme/WEB/kanban", updateProjectParams(valid, {})))
    ).toBe("/o/acme/WEB/kanban?groupBy=assignee");
    expect(
      href(buildProjectRouteTarget("/o/acme/WEB/kanban", updateProjectParams(invalid, {})))
    ).toBe("/o/acme/WEB/kanban");
  });

  test("does not preserve groupBy when normalizing archived state", () => {
    const base = parseProjectParams(
      new URLSearchParams([
        ["archived", "true"],
        ["groupBy", "priority"],
      ])
    );

    expect(
      href(buildProjectRouteTarget("/o/acme/WEB", updateProjectParams(base, {})))
    ).toBe("/o/acme/WEB?archived=true");
  });

  test("project entry targets the table route without a board default", () => {
    expect(href(projectEntryTarget("/o/acme/WEB", undefined))).toBe("/o/acme/WEB");
    expect(href(projectEntryTarget("/o/acme/WEB", {}))).toBe("/o/acme/WEB");
    expect(
      href(projectEntryTarget("/o/acme/WEB", { defaultViewMode: "list" }))
    ).toBe("/o/acme/WEB");
  });

  test("project entry targets the board route with a board default", () => {
    expect(
      href(projectEntryTarget("/o/acme/WEB", { defaultViewMode: "board" }))
    ).toBe("/o/acme/WEB/kanban");
    // Status is the normalized default grouping, so it stays out of the URL.
    expect(
      href(
        projectEntryTarget("/o/acme/WEB", {
          defaultViewMode: "board",
          defaultBoardGroupBy: "status",
        })
      )
    ).toBe("/o/acme/WEB/kanban");
    expect(
      href(
        projectEntryTarget("/o/acme/WEB", {
          defaultViewMode: "board",
          defaultBoardGroupBy: "assignee",
        })
      )
    ).toBe("/o/acme/WEB/kanban?groupBy=assignee");
  });

  test("resolveDefaultView prefers an explicit List override", () => {
    const project = {
      defaultViewMode: "board" as const,
      defaultBoardGroupBy: "label" as const,
    };

    // Absent override inherits the project default.
    expect(resolveDefaultView(project, {})).toEqual({
      viewMode: "board",
      boardGroupBy: "label",
      listGroupBy: "none",
      boardRowGroupBy: "none",
      fromList: false,
    });
    expect(resolveDefaultView(project, null)).toEqual({
      viewMode: "board",
      boardGroupBy: "label",
      listGroupBy: "none",
      boardRowGroupBy: "none",
      fromList: false,
    });

    // An explicit list-level "list" beats a project-level board default; the
    // board grouping still comes from the project.
    expect(resolveDefaultView(project, { defaultViewMode: "list" })).toEqual({
      viewMode: "list",
      boardGroupBy: "label",
      listGroupBy: "none",
      boardRowGroupBy: "none",
      fromList: true,
    });

    // A board override with no grouping normalizes to status.
    expect(
      resolveDefaultView({ defaultViewMode: "list" }, { defaultViewMode: "board" })
    ).toEqual({ viewMode: "board", boardGroupBy: "status", listGroupBy: "none", boardRowGroupBy: "none", fromList: true });

    // No project settings at all falls back to the table view.
    expect(resolveDefaultView(null)).toEqual({
      viewMode: "list",
      boardGroupBy: "status",
      listGroupBy: "none",
      boardRowGroupBy: "none",
      fromList: false,
    });
  });

  test("project entry resolves the target List's own default view", () => {
    // The List override wins over the project default.
    expect(
      href(
        projectEntryTarget(
          "/o/acme/WEB",
          { defaultViewMode: "list" },
          {
            listRef: "SPRINT-1",
            list: { defaultViewMode: "board", defaultBoardGroupBy: "label" },
          }
        )
      )
    ).toBe("/o/acme/WEB/kanban?list=SPRINT-1&groupBy=label");

    // Board with the default grouping keeps the URL clean.
    expect(
      href(
        projectEntryTarget(
          "/o/acme/WEB",
          { defaultViewMode: "list" },
          { listRef: "SPRINT-1", list: { defaultViewMode: "board" } }
        )
      )
    ).toBe("/o/acme/WEB/kanban?list=SPRINT-1");

    // An explicit list-level "list" stops inheriting the project board default.
    expect(
      href(
        projectEntryTarget(
          "/o/acme/WEB",
          { defaultViewMode: "board" },
          { listRef: "SPRINT-1", list: { defaultViewMode: "list" } }
        )
      )
    ).toBe("/o/acme/WEB?list=SPRINT-1");

    // No override inherits the project default.
    expect(
      href(
        projectEntryTarget(
          "/o/acme/WEB",
          { defaultViewMode: "board" },
          { listRef: "SPRINT-1", list: {} }
        )
      )
    ).toBe("/o/acme/WEB/kanban?list=SPRINT-1");
  });

  test("project entry carries the selected list ref", () => {
    expect(
      href(
        projectEntryTarget("/o/acme/WEB", { defaultViewMode: "board" }, { listRef: "sprint-1" })
      )
    ).toBe("/o/acme/WEB/kanban?list=SPRINT-1");
    expect(
      href(projectEntryTarget("/o/acme/WEB", null, { listRef: "SPRINT-1" }))
    ).toBe("/o/acme/WEB?list=SPRINT-1");
  });
});

test("list grouping survives filters, task links, archive and stored entry defaults", () => {
  const params = parseProjectParams(new URLSearchParams("listGroupBy=owner"));
  expect(params.listGroupBy).toBe("owner");
  expect(updateProjectParams(params, { filter: "active" }).listGroupBy).toBe("owner");
  expect(updateProjectParams(params, { archived: true }).listGroupBy).toBe("owner");
  expect(parseProjectParams(new URLSearchParams("listGroupBy=bogus")).listGroupBy).toBeUndefined();
  expect(href(projectEntryTarget("/o/team/PR", { defaultViewMode: "list", defaultListGroupBy: "owner" }))).toBe("/o/team/PR?listGroupBy=owner");
});


test("resolved defaults always include ungrouped list mode", () => {
  expect(resolveDefaultView(undefined).listGroupBy).toBe("none");
});

test("board rows live in rowGroupBy and never repeat the column dimension", () => {
  const params = parseProjectParams(new URLSearchParams("groupBy=label&rowGroupBy=section"));
  expect(params.rowGroupBy).toBe("section");
  expect(updateProjectParams(params, { filter: "active" }).rowGroupBy).toBe("section");
  expect(updateProjectParams(params, { archived: true }).rowGroupBy).toBeUndefined();
  // A chosen rows value stays in the URL; one equal to the columns means None.
  expect(normalizeProjectParams({ rowGroupBy: "status" }).rowGroupBy).toBe("none");
  expect(normalizeProjectParams({ groupBy: "label", rowGroupBy: "label" }).rowGroupBy).toBe("none");
  expect(normalizeProjectParams({ rowGroupBy: "none" }).rowGroupBy).toBe("none");
  expect(normalizeProjectParams({}).rowGroupBy).toBeUndefined();
  expect(parseProjectParams(new URLSearchParams("rowGroupBy=none")).rowGroupBy).toBe("none");
  expect(parseProjectParams(new URLSearchParams("rowGroupBy=bogus")).rowGroupBy).toBeUndefined();
  expect(href(projectEntryTarget("/o/team/PR", {
    defaultViewMode: "board", defaultBoardGroupBy: "status", defaultBoardRowGroupBy: "section",
  }))).toBe("/o/team/PR/kanban?rowGroupBy=section");
  expect(resolveDefaultView({ defaultViewMode: "board", defaultBoardGroupBy: "label", defaultBoardRowGroupBy: "owner" }).boardRowGroupBy).toBe("owner");
  expect(resolveDefaultView({ defaultViewMode: "board", defaultBoardGroupBy: "label", defaultBoardRowGroupBy: "label" }).boardRowGroupBy).toBe("none");
  expect(resolveDefaultView({ defaultViewMode: "list", defaultBoardRowGroupBy: "label" }).boardRowGroupBy).toBe("label");
});

test("a project keeps both views' grouping; a List override answers for its own mode", () => {
  const project = {
    defaultViewMode: "list" as const, defaultListGroupBy: "status" as const,
    defaultBoardGroupBy: "assignee" as const, defaultBoardRowGroupBy: "priority" as const,
  };
  expect(resolveDefaultView(project)).toEqual({
    viewMode: "list", listGroupBy: "status", boardGroupBy: "assignee", boardRowGroupBy: "priority", fromList: false,
  });
  expect(resolveDefaultView(project, { defaultViewMode: "board", defaultBoardGroupBy: "label" })).toEqual({
    viewMode: "board", listGroupBy: "status", boardGroupBy: "label", boardRowGroupBy: "none", fromList: true,
  });
  expect(resolveDefaultView(project, { defaultViewMode: "list", defaultListGroupBy: "owner" })).toEqual({
    viewMode: "list", listGroupBy: "owner", boardGroupBy: "assignee", boardRowGroupBy: "priority", fromList: true,
  });
});

test("an explicit No grouping stays in the URL", () => {
  const params = parseProjectParams(new URLSearchParams("listGroupBy=none"));
  expect(params.listGroupBy).toBe("none");
  expect(normalizeProjectParams(params).listGroupBy).toBe("none");
});
