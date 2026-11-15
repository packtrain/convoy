/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";

import { MemberRow } from "./member-row";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));

afterEach(cleanup);

test("the remove button is named after the member", () => {
  render(
    <MemberRow
      member={{ _id: "user_2" as Id<"users">, name: "Grace Hopper", email: "grace@example.com", role: "member" }}
      organizationId={"org_1" as Id<"organizations">}
      currentUserRole="owner"
      isCurrentUser={false}
    />
  );

  expect(screen.getByRole("button", { name: "Remove Grace Hopper" })).toBeTruthy();
});
