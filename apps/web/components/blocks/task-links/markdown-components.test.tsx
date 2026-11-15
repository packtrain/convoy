/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message";
import { getAppUrlBase } from "@/convex/lib/shared/appUrl";
import { TaskLinkHandlersContext } from ".";

const push = vi.fn();
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ organizationSlug: "acme", projectAlias: "OS" }),
  usePathname: () => "/o/acme/OS/threads",
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  push.mockReset();
});

const app = `${getAppUrlBase()}/o/acme/OS`;
const MARKDOWN = `I filed [Project default views](${app}?task=OS-2148 "type=feature; status=To Do").

- [Add board rows](${app}?task=OS-2138 "type=feature; status=Done")
- [Add sections](${app}?task=OS-2137 "type=feature; status=In Review")

[Kanban card flickers](${app}?task=OS-2141 "type=bug; status=Blocked")

See the [Implementation plan](${app}?task=OS-2148&artifact=kd71plan "type=md").

- [Implementation plan](${app}?task=OS-2148&artifact=kd71plan "type=md")
- [Mockup](${app}?task=OS-2148&artifact=kd72mock "type=html")

No snapshot: [Board cleanup](${app}?task=OS-2099). Bare: ${app}?task=OS-2100

Other project: [Elsewhere](${getAppUrlBase()}/o/acme/WEB?task=WEB-1 "status=Done").`;

function renderMessage(markdown = MARKDOWN) {
  const handlers = { onOpenTask: vi.fn(), onOpenArtifact: vi.fn() };
  render(
    <TaskLinkHandlersContext.Provider value={handlers}>
      <MessageResponse>{markdown}</MessageResponse>
    </TaskLinkHandlersContext.Provider>
  );
  return handlers;
}

const texts = (elements: HTMLElement[]) => elements.map((element) => element.textContent);

describe("task links in messages", () => {
  test("renders lists as tables, lone links as blocks, and in-sentence links as chips", async () => {
    renderMessage();
    const [taskTable, artifactTable] = await screen.findAllByTestId("task-link-table");

    expect(texts(within(taskTable).getAllByTestId("task-link-block"))).toEqual([
      "OS-2138Add board rowsDone",
      "OS-2137Add sectionsIn Review",
    ]);
    expect(screen.getAllByTestId("task-link-block").at(-1)?.textContent).toBe("OS-2141Kanban card flickersBlocked");
    expect(texts(within(artifactTable).getAllByTestId("artifact-link-block"))).toEqual([
      "Implementation planmdOS-2148",
      "MockuphtmlOS-2148",
    ]);
    expect(screen.getByTestId("artifact-link-chip").textContent).toBe("Implementation planmd");
    expect(texts(screen.getAllByTestId("task-link-chip"))).toEqual([
      "OS-2148Project default viewsTo Do",
      "OS-2099Board cleanup",
      "OS-2100",
      "WEB-1ElsewhereDone",
    ]);
    expect(screen.queryByRole("button", { name: /Project default views/ })).toBeNull();
  });

  test("keeps a mixed list as bullets with chips", async () => {
    renderMessage(`- [Clean up fixtures](${app}?task=OS-1001 "type=chore; status=Done")
- [Investigate](${app}?task=OS-1002 "type=investigation; status=To Do") was created in To Do`);
    const chips = await screen.findAllByTestId("task-link-chip");

    expect(texts(chips)).toEqual(["OS-1001Clean up fixturesDone", "OS-1002InvestigateTo Do"]);
    expect(screen.queryByTestId("task-link-block")).toBeNull();
    expect(screen.queryByTestId("task-link-table")).toBeNull();
    expect(screen.getAllByRole("listitem").map((item) => item.className.includes("list-none"))).toEqual([false, false]);
  });

  test("keeps names with inline markdown as plain text (OS-2269)", async () => {
    renderMessage(`- [Bare \`convoy\` prompts](${app}?task=OS-2266 "type=bug; status=To Do")
- [A **bold** _title_](${app}?task=OS-2270 "type=bug; status=To Do")

Chip: [\`convoy tasks\` fails](${app}?task=OS-2267 "type=bug; status=To Do") and [The \`audit\` notes](${app}?task=OS-2256&artifact=kd73audit "type=md").`);
    const rows = await screen.findAllByTestId("task-link-block");

    expect(texts(rows)).toEqual(["OS-2266Bare `convoy` promptsTo Do", "OS-2270A bold titleTo Do"]);
    expect(screen.getByTestId("task-link-chip").textContent).toBe("OS-2267`convoy tasks` failsTo Do");
    expect(screen.getByTestId("artifact-link-chip").textContent).toBe("The `audit` notesmd");
  });

  test("opens tasks and artifacts of the current project in place", async () => {
    const { onOpenTask, onOpenArtifact } = renderMessage();
    const [taskTable, artifactTable] = await screen.findAllByTestId("task-link-table");

    const row = within(taskTable).getAllByTestId("task-link-block")[0];
    expect(row.getAttribute("href")).toBe("/o/acme/OS?task=OS-2138");
    fireEvent.click(row);
    fireEvent.click(within(artifactTable).getAllByTestId("artifact-link-block")[1]);

    expect(onOpenTask).toHaveBeenCalledWith("OS-2138");
    expect(onOpenArtifact).toHaveBeenCalledWith("kd72mock");
    expect(push).not.toHaveBeenCalled();
  });

  test("navigates in the app to a task in another project", async () => {
    const { onOpenTask } = renderMessage();
    fireEvent.click(await screen.findByText("Elsewhere"));

    expect(onOpenTask).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/o/acme/WEB?task=WEB-1", expect.anything());
  });
});
