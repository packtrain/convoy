/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { POPOVER_SURFACE_CLASS } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

afterEach(cleanup);

test("the editor select menu uses the shared popover surface", () => {
  render(
    <Select open value="ts">
      <SelectTrigger aria-label="Language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ts">TypeScript</SelectItem>
      </SelectContent>
    </Select>
  );

  const content = screen.getByRole("listbox");
  for (const token of POPOVER_SURFACE_CLASS.split(" ")) expect(content.classList).toContain(token);
});
