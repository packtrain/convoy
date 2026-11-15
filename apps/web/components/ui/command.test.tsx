/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { Command, CommandItem, CommandList } from "./command";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("CommandItem", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  afterEach(cleanup);

  test("shows the selection indicator by default", () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandItem>Selectable row</CommandItem>
        </CommandList>
      </Command>
    );

    expect(
      container.querySelector('[data-slot="command-item-check"]')
    ).not.toBeNull();
  });

  test("can omit the selection indicator for action rows", () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandItem showCheckIcon={false}>Open destination</CommandItem>
        </CommandList>
      </Command>
    );

    expect(
      container.querySelector('[data-slot="command-item-check"]')
    ).toBeNull();
  });
});
