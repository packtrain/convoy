/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { GeneralSection } from "./general-section";

const auth = vi.hoisted(() => ({ isLoaded: false }));
vi.mock("@/lib/auth/hooks", () => ({
  useAppUser: () => ({ user: null, isLoaded: auth.isLoaded }),
  useAppUpdateProfileName: () => vi.fn(),
}));

afterEach(cleanup);

test("keeps the Profile header and skeletons the form while the user loads", () => {
  render(<GeneralSection />);

  expect(screen.getByRole("heading", { name: "Profile" })).toBeDefined();
  expect(screen.getByLabelText("Loading profile").querySelector('[data-slot="skeleton"]')).not.toBeNull();
  expect(screen.queryByText(/Loading/)).toBeNull();
});
