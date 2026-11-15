import { describe, expect, test } from "vitest";
import {
  RESOURCE_DRAG_MIME,
  dragHasResourceForProject,
  readResourceDragPayload,
  setResourceDragPayload,
} from "./resource-drag";

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
  } as unknown as DataTransfer;
}

describe("resource drag payload", () => {
  test("round-trips both kinds and gates by project", () => {
    for (const kind of ["artifact", "attachment"] as const) {
      const dataTransfer = createDataTransfer();
      setResourceDragPayload(dataTransfer, {
        kind,
        projectId: "project_1",
        resourceId: "resource_1",
        taskId: "task_1",
        name: "Plan",
      });

      expect(dragHasResourceForProject(dataTransfer, "project_1")).toBe(true);
      expect(dragHasResourceForProject(dataTransfer, "project_2")).toBe(false);
      expect(readResourceDragPayload(dataTransfer)).toEqual({
        kind,
        projectId: "project_1",
        resourceId: "resource_1",
        taskId: "task_1",
        name: "Plan",
      });
    }
  });

  test("rejects missing, malformed, and incomplete payloads", () => {
    expect(readResourceDragPayload(createDataTransfer())).toBeNull();

    const malformed = createDataTransfer();
    malformed.setData(RESOURCE_DRAG_MIME, "{not json");
    expect(readResourceDragPayload(malformed)).toBeNull();

    const wrongShape = createDataTransfer();
    wrongShape.setData(RESOURCE_DRAG_MIME, JSON.stringify({ projectId: 1 }));
    expect(readResourceDragPayload(wrongShape)).toBeNull();

    const missingResource = createDataTransfer();
    missingResource.setData(
      RESOURCE_DRAG_MIME,
      JSON.stringify({
        kind: "artifact",
        projectId: "project_1",
        taskId: "task_1",
        name: "Plan",
      })
    );
    expect(readResourceDragPayload(missingResource)).toBeNull();

    const emptyTask = createDataTransfer();
    emptyTask.setData(
      RESOURCE_DRAG_MIME,
      JSON.stringify({
        kind: "artifact",
        projectId: "project_1",
        resourceId: "resource_1",
        taskId: "",
        name: "Plan",
      })
    );
    expect(readResourceDragPayload(emptyTask)).toBeNull();
  });

  test("rejects an unknown kind", () => {
    const unknownKind = createDataTransfer();
    unknownKind.setData(
      RESOURCE_DRAG_MIME,
      JSON.stringify({
        kind: "comment",
        projectId: "project_1",
        resourceId: "resource_1",
        taskId: "task_1",
        name: "Plan",
      })
    );

    expect(readResourceDragPayload(unknownKind)).toBeNull();
  });

  test("keeps the payload when the name is missing", () => {
    const noName = createDataTransfer();
    noName.setData(
      RESOURCE_DRAG_MIME,
      JSON.stringify({
        kind: "attachment",
        projectId: "project_1",
        resourceId: "resource_1",
        taskId: "task_1",
      })
    );

    expect(readResourceDragPayload(noName)).toEqual({
      kind: "attachment",
      projectId: "project_1",
      resourceId: "resource_1",
      taskId: "task_1",
      name: "attachment",
    });
  });
});
