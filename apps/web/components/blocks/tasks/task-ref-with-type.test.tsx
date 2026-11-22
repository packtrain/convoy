/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  BUILT_IN_TASK_TYPES,
  getDefaultTaskTypeSummary,
} from "@/lib/tasks/task-types";
import { TaskRefWithType, TaskTypeGlyph } from "./task-ref-with-type";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";

vi.mock("@/lib/navigation/use-route-params", () => ({
  useRouteParams: () => ({ organizationSlug: "acme", threadId: "thread_1" }),
}));

describe("TaskRefWithType", () => {
  afterEach(() => {
    cleanup();
  });

  test("keeps the optimistic placeholder ref separated from the type icon", () => {
    const { container } = render(
      <TaskRefWithType
        refId="..."
        taskType={getDefaultTaskTypeSummary()}
        editable
        taskTypes={BUILT_IN_TASK_TYPES}
        onTaskTypeChange={vi.fn()}
        typeVariant="icon"
      />
    );

    const wrapper = container.firstElementChild;
    const typeTrigger = screen.getByRole("button", { name: /change task type/i });
    const pendingRef = screen.getByLabelText("Task reference pending");

    expect(wrapper?.className).toContain("whitespace-nowrap");
    expect(wrapper?.className).toContain("shrink-0");
    expect(typeTrigger.className).toContain("size-4");
    expect(typeTrigger.className).toContain("shrink-0");
    expect(pendingRef.className).toContain("inline-flex");
    expect(pendingRef.className).toContain("shrink-0");
    expect(pendingRef.className).toContain("min-w-[3ch]");
  });

  // On a thread page the pathname is the thread, not the task (OS-2325).
  test("Mod+Click copies the task page link, not the current page", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    window.history.pushState({}, "", "/o/acme/threads/thread_1?tab=task");

    render(<TaskRefWithType refId="WEB-7" taskType={getDefaultTaskTypeSummary()} />);
    fireEvent.click(screen.getByRole("button", { name: "WEB-7" }), { metaKey: true });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/o/acme/WEB?task=WEB-7`);
  });
});

// The investigation glyph renders at the same size as the other task types.
test("does not scale the investigation glyph", () => {
  const { container } = render(
    <>
      <TaskTypeGlyph taskType={resolveTaskTypeSummary("investigation")} />
      <TaskTypeGlyph taskType={resolveTaskTypeSummary("chore")} />
    </>
  );
  const [investigation, chore] = container.querySelectorAll("svg");

  expect(investigation.classList).not.toContain("scale-125");
  expect(investigation.classList).toContain("size-4");
  expect(chore.classList).toContain("size-4");
});
