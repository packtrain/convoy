/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { GeneralSection } from "./general-section";

const USER = { firstName: "Ada", lastName: null, fullName: "Ada", email: "ada@example.com", imageUrl: "" };
const auth = vi.hoisted(() => ({
  isLoaded: false,
  emailChangeHint: null as string | null,
}));
vi.mock("@/lib/auth/hooks", () => ({
  useAppUser: () => ({ user: auth.isLoaded ? USER : null, isLoaded: auth.isLoaded }),
  useAppUpdateProfileName: () => vi.fn(),
  get emailChangeHint() {
    return auth.emailChangeHint;
  },
}));

afterEach(() => {
  cleanup();
  auth.isLoaded = false;
  auth.emailChangeHint = null;
});

test("keeps the Profile header and skeletons the form while the user loads", () => {
  render(<GeneralSection />);

  expect(screen.getByRole("heading", { name: "Profile" })).toBeDefined();
  expect(screen.getByLabelText("Loading profile").querySelector('[data-slot="skeleton"]')).not.toBeNull();
  expect(screen.queryByText(/Loading/)).toBeNull();
});

test("shows the adapter's email hint under the disabled email", () => {
  auth.isLoaded = true;
  auth.emailChangeHint = "Change it elsewhere.";
  render(<GeneralSection />);

  expect((screen.getByLabelText("Email") as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("Change it elsewhere.")).toBeDefined();
});

test("shows no hint when the adapter has none", () => {
  auth.isLoaded = true;
  render(<GeneralSection />);

  expect((screen.getByLabelText("Email") as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByText(/Email changes/)).toBeNull();
});
