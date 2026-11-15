/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OrganizationProjectForm, type OrganizationProjectFormValues } from "./organization-project-form";

const initialValues: OrganizationProjectFormValues = {
  name: "Website Redesign",
  alias: "WEB",
  description: "",
  color: null,
};

describe("OrganizationProjectForm", () => {
  afterEach(() => {
    cleanup();
  });

  test("side-by-side Details fields stay top-aligned when one shows a validation error", async () => {
    render(<OrganizationProjectForm initialValues={initialValues} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name must be at least 2 characters")).toBeDefined();
    // The name error grows the grid row; a stretched field would sink its label.
    expect(screen.getByLabelText("Project key").closest("[data-slot='form-item']")?.className).toContain("content-start");
  });
});
