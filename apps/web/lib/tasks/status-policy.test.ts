import { describe, expect, test } from "vitest";
import {
  ALL_TASK_STATUSES,
  CLOSED_TASK_STATUSES,
  REQUIRED_PROJECT_STATUSES,
  isAllowedProjectTaskStatus,
  getAllowedTaskStatuses,
  getDisabledTaskStatuses,
  getInvalidRequiredDisabledStatuses,
  isClosedStatus,
  isTaskStatus,
  isProjectStatusRequired,
} from "./status-policy";
import { Status } from "./status";

describe("task status policy", () => {
  test("recognizes canonical task statuses", () => {
    expect(isTaskStatus(Status.TODO)).toBe(true);
    expect(isTaskStatus("Backlog")).toBe(false);
    expect(isTaskStatus("Unknown")).toBe(false);
  });

  test("treats Done and Canceled as closed statuses", () => {
    expect(CLOSED_TASK_STATUSES).toEqual([Status.DONE, Status.CANCELED]);
    expect([Status.DONE, Status.CANCELED].every(isClosedStatus)).toBe(true);
  });

  test("treats all other statuses as open", () => {
    const openStatuses = ALL_TASK_STATUSES.filter(
      (status) => !CLOSED_TASK_STATUSES.includes(status)
    );

    expect(openStatuses.every((status) => !isClosedStatus(status))).toBe(true);
  });

});

describe("project status settings", () => {
  test("defaults to all statuses enabled when no project config exists", () => {
    expect(getAllowedTaskStatuses()).toEqual(ALL_TASK_STATUSES);
    expect(getDisabledTaskStatuses()).toEqual([]);
    expect(isAllowedProjectTaskStatus(undefined, Status.CANCELED)).toBe(true);
  });

  test("derives canonical disabled and allowed statuses", () => {
    const project = {
      disabledStatuses: [
        Status.CANCELED,
        Status.TRIAGE,
        Status.CANCELED,
        Status.TODO,
      ],
    };

    expect(getDisabledTaskStatuses(project)).toEqual([
      Status.TRIAGE,
      Status.CANCELED,
    ]);
    expect(getAllowedTaskStatuses(project)).toEqual(
      ALL_TASK_STATUSES.filter(
        (status) => status !== Status.TRIAGE && status !== Status.CANCELED
      )
    );
    expect(isAllowedProjectTaskStatus(project, Status.TRIAGE)).toBe(false);
    expect(isAllowedProjectTaskStatus(project, Status.IN_PROGRESS)).toBe(true);
  });

  test("marks the required statuses as non-toggleable", () => {
    expect(REQUIRED_PROJECT_STATUSES).toEqual([
      Status.TODO,
      Status.DONE,
    ]);
    expect(isProjectStatusRequired(Status.TODO)).toBe(true);
    expect(isProjectStatusRequired(Status.DONE)).toBe(true);
    expect(isProjectStatusRequired(Status.CANCELED)).toBe(false);
  });

  test("detects required statuses in disabled input", () => {
    expect(
      getInvalidRequiredDisabledStatuses([
        Status.DONE,
        Status.CANCELED,
      ])
    ).toEqual([Status.DONE]);
  });
});
