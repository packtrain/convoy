// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { useTaskFieldMenuTrigger } from "@/lib/tasks/hooks/use-task-field-menu";
const mocks = vi.hoisted(() => ({ roots: vi.fn() }));
vi.mock("radix-ui", async importOriginal => {
 const actual = await importOriginal<typeof import("radix-ui")>();
 return {...actual, DropdownMenu: {...actual.DropdownMenu, Root: (props: React.ComponentProps<typeof actual.DropdownMenu.Root>) => {
  mocks.roots(); return <actual.DropdownMenu.Root {...props}/>;
 }}};
});
afterEach(() => {cleanup(); vi.clearAllMocks();});
function Menu({disabled = false}: {disabled?: boolean}) {
 const [open,setOpen] = React.useState(false);
 const field = useTaskFieldMenuTrigger({open,onOpenChange:setOpen});
 return <DropdownMenu deferMount modal={false} open={open} onOpenChange={setOpen}>
 <DropdownMenuTrigger asChild disabled={disabled} {...field}><button>Priority</button></DropdownMenuTrigger>
 <DropdownMenuContent><DropdownMenuItem onSelect={() => setOpen(false)}>High</DropdownMenuItem></DropdownMenuContent>
 </DropdownMenu>;
}
function press(x=10) {
 const event = new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:x,clientY:10});
 Object.defineProperty(event,"pointerType",{value:"mouse"});
 fireEvent(screen.getByRole("button",{name:"Priority"}),event);
}
test("closed controls mount no Radix menu until first use", () => {
 render(<Menu/>);
 expect(screen.getByRole("button",{name:"Priority"}).getAttribute("aria-expanded")).toBe("false");
 expect(mocks.roots).not.toHaveBeenCalled();
});
test.each(["Enter"," ","ArrowDown"])("first keyboard activation with %s opens the menu", key => {
 render(<Menu/>);
 fireEvent.keyDown(screen.getByRole("button",{name:"Priority"}),{key});
 expect(screen.getByRole("menuitem",{name:"High"})).toBeTruthy();
});
test("drag remains closed; a later click opens and closing restores focus", async () => {
 render(<Menu/>);
 press();
 fireEvent.click(screen.getByRole("button",{name:"Priority"}),{clientX:40,clientY:10});
 expect(screen.queryByRole("menu")).toBeNull();
 expect(mocks.roots).not.toHaveBeenCalled();
 press();
 fireEvent.click(screen.getByRole("button",{name:"Priority"}),{clientX:10,clientY:10});
 fireEvent.click(screen.getByRole("menuitem",{name:"High"}));
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole("button",{name:"Priority"})));
});
test("disabled triggers never initialize the menu", () => {
 render(<Menu disabled/>);
 fireEvent.keyDown(screen.getByRole("button",{name:"Priority"}),{key:"Enter"});
 expect(mocks.roots).not.toHaveBeenCalled();
});


test.each(["ArrowDown", "Enter", " "])("first keyboard open with %s focuses the first item", async key => {
  render(<Menu />);
  const trigger = screen.getByRole("button", { name: "Priority" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "High" })));
});

test("first keyboard open preserves a search input's autofocus", async () => {
  function SearchMenu() {
    const [open, setOpen] = React.useState(false);
    return <DropdownMenu deferMount open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger>Search menu</DropdownMenuTrigger>
      <DropdownMenuContent><input aria-label="Search" autoFocus /><DropdownMenuItem>Option</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>;
  }
  render(<SearchMenu />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Search menu" }), { key: "Enter" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search" })));
});
