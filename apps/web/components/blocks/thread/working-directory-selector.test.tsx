/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Slot } from "radix-ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { POPOVER_SURFACE_CLASS } from "@/components/ui/popover";
import { WorkingDirectorySelector } from "./working-directory-selector";

type ModelSelectorContentHandlers = {
  side?: string;
  onOpenChange?: (open: boolean) => void;
  onFocusOutside?: (event: {
    target: EventTarget | null;
    preventDefault: () => void;
  }) => void;
  onInteractOutside?: (event: {
    target: EventTarget | null;
    preventDefault: () => void;
  }) => void;
};

const mutationRefs = vi.hoisted(() => ({
  rename: { type: "rename" },
  remove: { type: "remove" },
}));
const modelSelectorContentHandlers = vi.hoisted(
  () =>
    ({
      current: null as ModelSelectorContentHandlers | null,
    }) satisfies { current: ModelSelectorContentHandlers | null }
);
const modelSelectorRoot = vi.hoisted(() => ({ onOpenChange: undefined as ((open: boolean) => void) | undefined }));
const renameProfileMock = vi.fn();
const deleteProfileMock = vi.fn();

vi.mock("@/convex/_generated/api", () => ({
  api: {
    cli: {
      profiles: {
        rename: mutationRefs.rename,
        remove: mutationRefs.remove,
      },
    },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: unknown) =>
    mutation === api.cli.profiles.rename ? renameProfileMock : deleteProfileMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/components/ai-elements/model-selector-dropdown", () => ({
  ModelSelectorDropdown: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => {
    modelSelectorRoot.onOpenChange = onOpenChange;
    return <div>{children}</div>;
  },
  ModelSelectorDropdownTrigger: ({
    children,
    asChild = false,
    ...props
  }: ComponentPropsWithoutRef<"button"> & { asChild?: boolean }) =>
    asChild ? (
      <Slot.Root {...props}>{children}</Slot.Root>
    ) : (
      <button type="button" {...props}>{children}</button>
    ),
  ModelSelectorDropdownContent: ({
    children,
    onFocusOutside,
    onInteractOutside,
    side,
  }: {
    children: ReactNode;
    side?: string;
    onFocusOutside?: ModelSelectorContentHandlers["onFocusOutside"];
    onInteractOutside?: ModelSelectorContentHandlers["onInteractOutside"];
  }) => {
    modelSelectorContentHandlers.current = {
      side,
      onFocusOutside,
      onInteractOutside,
    };
    return <div>{children}</div>;
  },
  ModelSelectorDropdownInput: ({ value, onValueChange, autoFocus }: { value?: string; onValueChange?: (value: string) => void; autoFocus?: boolean }) => (
    <input aria-label="Search working directories" value={value} autoFocus={autoFocus} onChange={(event) => onValueChange?.(event.target.value)} />
  ),
  ModelSelectorDropdownList: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ModelSelectorDropdownEmpty: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ModelSelectorDropdownGroup: ({
    children,
    heading,
  }: {
    children: ReactNode;
    heading: ReactNode;
  }) => (
    <div>
      <div>{heading}</div>
      {children}
    </div>
  ),
  ModelSelectorDropdownItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  ModelSelectorDropdownName: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("./rename-profile-dialog", () => ({
  RenameProfileDialog: ({
    open,
    profileId,
    currentName,
    onRename,
  }: {
    open: boolean;
    profileId?: Id<"cliProfiles">;
    currentName: string;
    onRename: (profileId: Id<"cliProfiles">, name: string) => Promise<void>;
  }) =>
    open ? (
      <div>
        <p>Rename profile dialog ({currentName})</p>
        <button
          type="button"
          onClick={() => {
            if (profileId) {
              void onRename(profileId, "Renamed profile");
            }
          }}
        >
          Confirm rename
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const singleOptionProfiles = [
  {
    _id: "profile_1" as Id<"cliProfiles">,
    name: "Default profile",
    profileKey: "os-local",
    hostname: "machine-a",
    isOnline: true,
    paths: [{ id: "path_1", path: "/tmp/project", label: "project" }],
  },
];

const folderProfiles = [
  {
    _id: "profile_1" as Id<"cliProfiles">,
    name: "Default profile",
    isOnline: true,
    paths: [
      { id: "acme", path: "/code/acme", label: "acme" },
      { id: "new-app", path: "/code/acme/new-app", label: "new-app", kind: "repo" as const, parentPathId: "acme" },
      { id: "old-app", path: "/code/acme/old-app", label: "old-app", kind: "repo" as const, parentPathId: "acme" },
    ],
  },
];

describe("WorkingDirectorySelector repos of a folder (OS-2647)", () => {
  afterEach(() => {
    cleanup();
  });

  test("reads a picked repo as folder / repo in the trigger", () => {
    render(<WorkingDirectorySelector profiles={folderProfiles} profileId="profile_1" pathId="new-app" onChange={vi.fn()} />);
    expect(screen.getByTitle("Default profile / acme / new-app")).toBeDefined();
  });

  test("clicking the folder picks it; its repos are rows under it on a wide screen too", () => {
    const onChange = vi.fn();
    render(<WorkingDirectorySelector profiles={folderProfiles} profileId="profile_1" pathId="acme" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /^acme\// }));
    expect(onChange).toHaveBeenLastCalledWith("profile_1", "acme");
    fireEvent.click(screen.getByRole("button", { name: /^acme \/\s*old-app$/ }));
    expect(onChange).toHaveBeenLastCalledWith("profile_1", "old-app");
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  test("searching keeps the matching repo row and shows its folder, since the folder row may be filtered out", () => {
    const onChange = vi.fn();
    render(<WorkingDirectorySelector profiles={folderProfiles} profileId="profile_1" pathId="acme" onChange={onChange} />);
    expect(screen.getAllByText("acme /", { exact: false, selector: ".sr-only" })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Search working directories"), { target: { value: "old" } });
    expect(screen.queryAllByText("acme /", { exact: false, selector: ".sr-only" })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /^acme \/\s*old-app$/ }));
    expect(onChange).toHaveBeenLastCalledWith("profile_1", "old-app");
  });

  test("a worktree of a repo reads folder / repo / worktree", () => {
    const profiles = [{
      ...folderProfiles[0],
      paths: [...folderProfiles[0].paths, { id: "wt", path: "/code/acme/new-app-worktrees/feat-x", label: "feat/x", kind: "worktree" as const, parentPathId: "new-app" }],
    }];
    render(<WorkingDirectorySelector profiles={profiles} profileId="profile_1" pathId="wt" onChange={vi.fn()} />);
    expect(screen.getByTitle("Default profile / acme / new-app / feat/x")).toBeDefined();
  });

  test("names the whole path in the trigger's accessible name, and shows the repo when only one segment fits", () => {
    render(<WorkingDirectorySelector profiles={folderProfiles} profileId="profile_1" pathId="new-app" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Default profile / acme / new-app" });
    // The narrow composer bar shows the repo instead of the profile name.
    expect(trigger.querySelector("[data-narrow-label]")?.textContent).toBe("new-app");
  });

  test("opening the menu focuses search, so typing and arrows work at once", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    try {
      render(<WorkingDirectorySelector profiles={folderProfiles} profileId="profile_1" pathId="acme" onChange={vi.fn()} />);
      expect(document.activeElement).toBe(screen.getByLabelText("Search working directories"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("picking a row does not pop the profile card when focus returns to the trigger", () => {
    vi.useFakeTimers();
    try {
      render(<WorkingDirectorySelector profiles={folderProfiles} profileId="profile_1" pathId="acme" onChange={vi.fn()} />);
      const trigger = screen.getByTitle("Default profile / acme");
      fireEvent.click(screen.getByRole("button", { name: /^acme \/\s*old-app$/ }));
      act(() => {
        fireEvent.focus(trigger);
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText("CLI profile")).toBeNull();
      // A later, deliberate focus still opens it.
      act(() => {
        fireEvent.blur(trigger);
      });
      act(() => {
        fireEvent.focus(trigger);
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText("CLI profile")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps the menu on the side it opened on, so a search that shrinks the list doesn't flip it", () => {
    render(<WorkingDirectorySelector profiles={folderProfiles} profileId="profile_1" pathId="acme" onChange={vi.fn()} />);
    const trigger = screen.getByTitle("Default profile / acme");
    // A composer near the bottom of the window: more room above.
    trigger.getBoundingClientRect = () => ({ top: window.innerHeight - 40, bottom: window.innerHeight - 10 }) as DOMRect;
    act(() => modelSelectorRoot.onOpenChange?.(true));
    expect(modelSelectorContentHandlers.current?.side).toBe("top");
    trigger.getBoundingClientRect = () => ({ top: 10, bottom: 40 }) as DOMRect;
    act(() => modelSelectorRoot.onOpenChange?.(false));
    act(() => modelSelectorRoot.onOpenChange?.(true));
    expect(modelSelectorContentHandlers.current?.side).toBe("bottom");
  });

  test("a pointer resting on the trigger through a pick does not pop the card; moving away and back does", () => {
    vi.useFakeTimers();
    try {
      render(<WorkingDirectorySelector profiles={folderProfiles} profileId="profile_1" pathId="acme" onChange={vi.fn()} />);
      const trigger = screen.getByTitle("Default profile / acme");
      fireEvent.click(screen.getByRole("button", { name: /^acme \/\s*old-app$/ }));
      // The relabelled trigger re-lays out under a still pointer: Chromium fires leave, then enter.
      act(() => {
        fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
      });
      act(() => {
        fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
        fireEvent.focus(trigger);
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText("CLI profile")).toBeNull();
      act(() => {
        fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
        fireEvent.pointerMove(document.body, { pointerType: "mouse" });
        vi.advanceTimersByTime(1000);
      });
      act(() => {
        fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText("CLI profile")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WorkingDirectorySelector", () => {
  afterEach(() => {
    cleanup();
    renameProfileMock.mockReset();
    deleteProfileMock.mockReset();
    modelSelectorContentHandlers.current = null;
  });

  test("uses pointer cursor when enabled", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    const trigger = screen.getByTitle("Default profile / project");
    expect(trigger.classList.contains("cursor-pointer")).toBe(true);
  });

  test("middle-truncates a long path label so its end stays visible", () => {
    const label = "feat/os-2289-evidence-tab-with-agent-attached";
    render(
      <WorkingDirectorySelector
        profiles={[{ ...singleOptionProfiles[0], paths: [{ id: "path_1", path: `/tmp/${label}`, label }] }]}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText("-agent-attached")).toBeDefined();
    expect(screen.getByTitle(`Default profile / ${label}`).textContent).toContain(label);
  });

  test("uses default cursor when disabled", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
        disabled
      />
    );

    const trigger = screen.getByTitle("Default profile / project");
    expect(trigger.classList.contains("cursor-default")).toBe(true);
  });

  test("shows profile details from the locked selector trigger", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
        disabled
      />
    );

    const trigger = screen.getByTitle("Default profile / project");
    expect(trigger.hasAttribute("data-profile-hover-card-trigger")).toBe(true);
  });

  test("shows profile details from the editable selector trigger (OS-2253)", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    const trigger = screen.getByTitle("Default profile / project");
    expect(trigger.hasAttribute("data-profile-hover-card-trigger")).toBe(true);
  });

  test("shows selected path for locked single-option context", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
        disabled
      />
    );

    const trigger = screen.getByTitle("Default profile / project");
    expect(trigger.textContent).toContain("project");
  });

  test("shows selected path for editable single-option context", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    const trigger = screen.getByTitle("Default profile / project");
    expect(trigger.textContent).toContain(" / project");
  });

  test("shows profile key in the group heading", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText("os-local")).toBeDefined();
    const statusText = screen.getByText("online");
    expect(statusText.classList.contains("sr-only")).toBe(true);
    expect(screen.queryByText("offline")).toBeNull();
  });

  test("drops the path suffix in a narrow composer bar (OS-2144)", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
        disabled
      />
    );

    const trigger = screen.getByTitle("Default profile / project");
    const suffix = [...trigger.querySelectorAll("span")].find((span) => span.textContent === " / project");
    expect(suffix?.className).toContain("@max-lg/composer-bar:hidden");
    expect(trigger.className).toContain("@max-lg/composer-bar:max-w-36");
  });

  test("keeps path visible in editable multi-option context", () => {
    render(
      <WorkingDirectorySelector
        profiles={[
          {
            _id: "profile_1" as Id<"cliProfiles">,
            name: "Default profile",
            profileKey: "os-local",
            hostname: "machine-a",
            isOnline: true,
            paths: [
              { id: "path_1", path: "/tmp/project", label: "project" },
              { id: "path_2", path: "/tmp/project-two", label: "project-two" },
            ],
          },
        ]}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    const trigger = screen.getByTitle("Default profile / project");
    expect(trigger.textContent).toContain("project");
  });

  test("shows rename action in enabled state", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Profile options for Default profile" })
    ).toBeDefined();
  });

  test("opens profile options menu from keyboard", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Profile options for Default profile" }),
      { key: "Enter" }
    );

    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeDefined();
  });

  test("renders profile options menu with the overlay marker", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Profile options for Default profile" })
    );

    const menu = document.getElementById("profile-options-menu-profile_1");
    expect(menu).not.toBeNull();
    expect(menu?.hasAttribute("data-profile-options-menu")).toBe(true);
    for (const token of POPOVER_SURFACE_CLASS.split(" ")) expect(menu?.classList).toContain(token);
  });

  test("renders the profile options menu as a clickable overlay", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Profile options for Default profile" })
    );

    const menu = document.getElementById("profile-options-menu-profile_1");
    expect(menu?.classList.contains("pointer-events-auto")).toBe(true);
  });

  test("closes the profile options menu when the trigger is clicked again", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Profile options for Default profile",
    });

    fireEvent.click(trigger);
    expect(document.getElementById("profile-options-menu-profile_1")).not.toBeNull();

    fireEvent.click(trigger);
    expect(document.getElementById("profile-options-menu-profile_1")).toBeNull();
  });

  test("keeps the parent selector open for profile options overlay interactions", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    const preventDefault = vi.fn();
    const target = document.createElement("div");
    target.setAttribute("data-profile-options-menu", "");

    modelSelectorContentHandlers.current?.onFocusOutside?.({
      target,
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  test("hides rename action in locked state", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
        disabled
      />
    );

    expect(
      screen.queryByRole("button", { name: "Profile options for Default profile" })
    ).toBeNull();
  });

  test("opens rename dialog and submits rename mutation", async () => {
    renameProfileMock.mockResolvedValue(undefined);
    const onChange = vi.fn();

    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={onChange}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Profile options for Default profile" })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByText("Rename profile dialog (Default profile)")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Confirm rename" }));

    await vi.waitFor(() =>
      expect(renameProfileMock).toHaveBeenCalledWith({
        profileId: "profile_1",
        name: "Renamed profile",
      })
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  test("removes the Info item and keeps Delete available", () => {
    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Profile options for Default profile" })
    );

    expect(screen.queryByRole("menuitem", { name: "Info" })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }).getAttribute("aria-disabled")
    ).toBeNull();
  });

  test("opens delete dialog and submits delete mutation", async () => {
    deleteProfileMock.mockResolvedValue(undefined);
    const onChange = vi.fn();

    render(
      <WorkingDirectorySelector
        profiles={singleOptionProfiles}
        profileId="profile_1"
        pathId="path_1"
        onChange={onChange}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Profile options for Default profile" })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.getByText("Delete profile?")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Delete profile" }));

    await vi.waitFor(() =>
      expect(deleteProfileMock).toHaveBeenCalledWith({
        profileId: "profile_1",
      })
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
