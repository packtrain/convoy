/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import { DEFAULT_GUIDE_INSTRUCTIONS } from "./guide-prompt";
import { GuidePromptSection } from "./guide-prompt-section";

const state = vi.hoisted(() => ({ stored: null as string | null, role: "project-admin" as string }));
const setPrompt = vi.fn(async () => null);
vi.mock("convex/react", () => ({
  useQuery: (fn: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    if (getFunctionName(fn) === getFunctionName(api.integrations.github.guides.getPrompt)) return state.stored;
    if (getFunctionName(fn) === getFunctionName(api.projects.members.getMyRole)) return state.role;
    return undefined;
  },
  useMutation: () => setPrompt,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const field = () => screen.getByRole("textbox", { name: "Guide prompt" }) as HTMLTextAreaElement;
const renderSection = () => render(<GuidePromptSection projectId={"project_1" as never} />);

beforeEach(() => {
  state.stored = null;
  state.role = "project-admin";
});
afterEach(() => {
  cleanup();
  setPrompt.mockReset();
  setPrompt.mockImplementation(async () => null);
});

describe("GuidePromptSection (OS-2416)", () => {
  test("shows the built-in instructions until an admin saves their own", async () => {
    renderSection();
    expect(field().value).toBe(DEFAULT_GUIDE_INSTRUCTIONS);
    expect(screen.getByRole("button", { name: "Save prompt" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Restore default prompt" })).toHaveProperty("disabled", true);
    fireEvent.change(field(), { target: { value: `${DEFAULT_GUIDE_INSTRUCTIONS}\nWrite every explanation as one short sentence.` } });
    fireEvent.click(screen.getByRole("button", { name: "Save prompt" }));
    await waitFor(() =>
      expect(setPrompt).toHaveBeenCalledWith({ projectId: "project_1", prompt: `${DEFAULT_GUIDE_INSTRUCTIONS}\nWrite every explanation as one short sentence.` })
    );
  });

  test("Restore default prompt clears the project's text, and saving the built-in text as is stores none", async () => {
    state.stored = "Be brief.";
    renderSection();
    expect(field().value).toBe("Be brief.");
    fireEvent.click(screen.getByRole("button", { name: "Restore default prompt" }));
    await waitFor(() => expect(setPrompt).toHaveBeenCalledWith({ projectId: "project_1", prompt: null }));
    fireEvent.change(field(), { target: { value: DEFAULT_GUIDE_INSTRUCTIONS } });
    fireEvent.click(screen.getByRole("button", { name: "Save prompt" }));
    await waitFor(() => expect(setPrompt).toHaveBeenLastCalledWith({ projectId: "project_1", prompt: null }));
  });

  test("text typed while Save or Reset is pending stays", async () => {
    state.stored = "Be brief.";
    let finish = () => {};
    setPrompt.mockImplementation(() => new Promise<null>((resolve) => (finish = () => resolve(null))));
    renderSection();
    fireEvent.change(field(), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save prompt" }));
    fireEvent.change(field(), { target: { value: "AB" } });
    await act(async () => finish());
    expect(field().value).toBe("AB");
    fireEvent.click(screen.getByRole("button", { name: "Restore default prompt" }));
    fireEvent.change(field(), { target: { value: "ABC" } });
    await act(async () => finish());
    expect(field().value).toBe("ABC");
  });

  test("a member reads it but cannot change it", () => {
    state.role = "member";
    state.stored = "Be brief.";
    renderSection();
    expect(field().readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Save prompt" })).toBeNull();
  });
});
