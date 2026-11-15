/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "@/convex/_generated/dataModel";
import { GeneralSection } from "./general-section";

const updateMock = vi.hoisted(() => vi.fn());
const slugAvailability = vi.hoisted(() => ({ available: true }));
vi.mock("convex/react", () => ({
  useMutation: () => updateMock,
  useQuery: () => slugAvailability,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const organization = {
  _id: "org_1",
  name: "Acme",
  slug: "acme",
  color: null,
} as unknown as Doc<"organizations">;

describe("Organization GeneralSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    slugAvailability.available = true;
  });

  test("skeletons the form while the organization loads", () => {
    render(<GeneralSection organization={undefined} />);

    expect(screen.getByLabelText("Loading organization settings").querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });

  test("renders no heading of its own, since the page shell owns the title", () => {
    render(<GeneralSection organization={organization} />);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  test("labels its fields and keeps the /o/ prefix inside the URL input group", () => {
    render(<GeneralSection organization={organization} />);

    expect((screen.getByLabelText("Organization name") as HTMLInputElement).value).toBe("Acme");
    const slug = screen.getByLabelText("Organization URL") as HTMLInputElement;
    expect(slug.value).toBe("acme");
    const group = slug.closest('[data-slot="input-group"]');
    expect(group?.textContent).toContain("/o/");
  });

  test("shows validation through the form message and saves from the actions row", async () => {
    updateMock.mockResolvedValue(null);
    render(<GeneralSection organization={organization} />);

    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    expect(await screen.findByText("Name must be at least 2 characters")).toBeDefined();
    expect(updateMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Acme Inc" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith({ id: "org_1", name: "Acme Inc", slug: "acme", color: null })
    );
  });

  test.each([
    [true, "URL available"],
    [false, "URL taken"],
  ])("announces the URL check as text (available: %s)", async (available, text) => {
    slugAvailability.available = available;
    render(<GeneralSection organization={organization} />);

    fireEvent.change(screen.getByLabelText("Organization URL"), { target: { value: "acme-two" } });

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(text));
  });
});
