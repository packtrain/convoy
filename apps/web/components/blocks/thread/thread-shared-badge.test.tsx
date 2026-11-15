/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { ARCHIVED_TASK_LIST_TRIGGER_CLASS } from "@/components/blocks/project/task-lists/task-list-identity";
import { ThreadSharedBadge } from "./thread-shared-badge";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

// Radix tooltips need pointer plumbing jsdom lacks; the trigger is what matters.
vi.mock("@/components/custom/tooltip-ext", () => ({
  TooltipExt: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function renderBadge(
  overrides: Partial<Parameters<typeof ThreadSharedBadge>[0]> = {}
) {
  return render(
    <ThreadSharedBadge
      threadId={"thread_1" as Id<"cliThreads">}
      readOnly={false}
      sharedAt={undefined}
      organizationSlug="contoso"
      projectAlias="OS"
      {...overrides}
    />
  );
}

describe("ThreadSharedBadge", () => {
  afterEach(() => {
    cleanup();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  test("renders nothing for an owner who has not shared the thread", () => {
    const { container } = renderBadge();
    expect(container.firstChild).toBeNull();
  });

  test("tells a viewer the thread is read-only", () => {
    renderBadge({ readOnly: true });
    expect(screen.getByText("Read-only")).toBeDefined();
    expect(screen.queryByText("Shared")).toBeNull();
  });

  test("an owner of a shared thread copies the link by clicking the badge", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderBadge({ sharedAt: Date.now() });
    fireEvent.click(screen.getByRole("button", { name: /Shared/ }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/o/contoso/OS/threads/thread_1`
    );
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  // A real <button>, not a role="button" span: the badge is the header's only
  // copy affordance, so it has to answer the keyboard too.
  test("the shared badge is keyboard-operable", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderBadge({ sharedAt: Date.now() });
    const badge = screen.getByRole("button", { name: /Shared/ });
    expect(badge.tagName).toBe("BUTTON");

    badge.focus();
    expect(document.activeElement).toBe(badge);
    // A native button turns Enter/Space into a click; jsdom does not, so drive
    // the click the browser would synthesize.
    fireEvent.click(badge);
    expect(writeText).toHaveBeenCalled();
  });

  // The clipboard rejects in insecure contexts and on denied permission; the
  // badge used to fire the success toast regardless and float the rejection.
  test("a failed copy reports failure instead of success", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    renderBadge({ sharedAt: Date.now() });
    fireEvent.click(screen.getByRole("button", { name: /Shared/ }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  // Both pills override Badge's own `h-5` to match the header's Archived pill,
  // which only holds because tailwind-merge drops the losing class. A silent
  // regression there shrinks them back with nothing else failing.
  test.each([
    { name: "viewer", props: { readOnly: true }, label: "Read-only" },
    { name: "owner", props: { sharedAt: 1 }, label: "Shared" },
  ])("the $name pill keeps the Archived pill's size and colour", ({ props, label }) => {
    renderBadge(props);

    const pill = screen.getByText(label).closest("[data-slot='badge']");
    expect(pill).not.toBeNull();
    const className = pill!.className;

    expect(className).toContain("h-7");
    expect(className).not.toContain("h-5");
    // The colour comes from the Archived pill's own constant, so assert that
    // rather than the amber values it happens to hold today. Only the resting
    // utilities: the read-only pill intentionally re-pins its hover colour.
    const restingUtilities = ARCHIVED_TASK_LIST_TRIGGER_CLASS.split(" ").filter(
      (utility) => !utility.includes("hover:")
    );
    expect(restingUtilities.length).toBeGreaterThan(0);
    for (const utility of restingUtilities) {
      expect(className).toContain(utility);
    }
  });

  test("only the clickable pill reacts to hover", () => {
    renderBadge({ readOnly: true });
    const readOnlyPill = screen.getByText("Read-only").closest("[data-slot='badge']");
    expect(readOnlyPill!.className).toContain("hover:bg-amber-50");
    cleanup();

    renderBadge({ sharedAt: 1 });
    const sharedPill = screen.getByText("Shared").closest("[data-slot='badge']");
    expect(sharedPill!.className).toContain("hover:bg-amber-100");
  });
});
