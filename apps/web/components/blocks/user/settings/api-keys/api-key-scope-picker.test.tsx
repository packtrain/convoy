/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiKeyScopePicker } from "./api-key-scope-picker";

const projectsMock = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("convex/react", () => ({
  useQuery: (ref: string) => (ref === "listByOrganization" ? projectsMock.value : []),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizations: { core: { listForUser: "listForUser" } },
    projects: { core: { listByOrganization: "listByOrganization" } },
  },
}));

const ACTIVE = { _id: "p_web", name: "Website", alias: "WEB", isArchived: false };
const ARCHIVED = { _id: "p_old", name: "Old site", alias: "OLD", isArchived: true };
const OTHER_ARCHIVED = { _id: "p_gone", name: "Gone", alias: "GONE", isArchived: true };

function renderPicker(projectIds: string[]) {
  const onChange = vi.fn();
  render(
    <ApiKeyScopePicker
      value={{ organizationId: "org_1", projectIds } as never}
      onChange={onChange}
    />
  );
  return onChange;
}

describe("ApiKeyScopePicker", () => {
  afterEach(() => {
    cleanup();
  });

  test("keeps a selected archived project and hides unselected archived ones", () => {
    projectsMock.value = [ACTIVE, ARCHIVED, OTHER_ARCHIVED];
    const onChange = renderPicker(["p_old"]);

    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /OLD/ }));
    expect(screen.getByText("Website")).toBeDefined();
    expect(screen.getByText("Old site")).toBeDefined();
    expect(screen.queryByText("Gone")).toBeNull();
  });

  test("never empties a selection, which would widen the key to every project", () => {
    projectsMock.value = [ACTIVE];
    const onChange = renderPicker(["p_deleted"]);

    expect(onChange).not.toHaveBeenCalled();
  });

  test("drops a vanished project when others stay selected", () => {
    projectsMock.value = [ACTIVE];
    const onChange = renderPicker(["p_web", "p_deleted"]);

    expect(onChange).toHaveBeenCalledWith({ organizationId: "org_1", projectIds: ["p_web"] });
  });
});
