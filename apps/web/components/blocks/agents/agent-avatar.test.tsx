/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { AgentAvatar, getAgentInitials } from "./agent-avatar";

describe("AgentAvatar", () => {
  test("uses one initial from the agent name", () => {
    expect(getAgentInitials("Code Reviewer")).toBe("C");
    expect(getAgentInitials(" default")).toBe("D");
    expect(getAgentInitials("")).toBe("A");
  });

  test("sets avatar text color inline so menu hover styles cannot override it", () => {
    render(<AgentAvatar name="Code Reviewer" color="#f97316" size="xs" />);

    const fallback = screen.getByText("C");
    expect(fallback.style.backgroundColor).toBe("rgb(249, 115, 22)");
    expect(fallback.style.color).toBe("rgb(255, 255, 255)");
  });
});
