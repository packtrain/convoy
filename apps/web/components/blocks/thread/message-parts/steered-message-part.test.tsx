/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SteeredMessagePart } from "./steered-message-part";

// Attachment pills paint from envelope metadata; signed URLs resolve through a
// lazy query the pill only fires on click (OS-1600).
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
}));

vi.mock("@/components/blocks/thread/response-attachments", () => ({
  ResponseAttachments: ({ messageId, attachments, className }: { messageId: string; attachments: Array<{ fileName: string }>; className?: string }) => (
    <div data-testid="response-attachments" data-message-id={messageId} className={className}>
      {attachments.map((attachment) => attachment.fileName).join(",")}
    </div>
  ),
}));

afterEach(cleanup);

const basePart = {
  type: "runtime-notice" as const,
  code: "steered-message",
  title: "Steered",
  message: "steer me",
};

describe("SteeredMessagePart", () => {
  test("renders the steered user message's attachments from the lookup", () => {
    render(
      <SteeredMessagePart
        part={{
          ...basePart,
          message: "steer me #design.png",
          detailsJson: JSON.stringify({ messageId: "user-message-1" }),
        }}
        getUserMessageAttachments={(messageId) =>
          messageId === "user-message-1"
            ? [
                {
                  storageId: "storage-1",
                  fileName: "design.png",
                  fileSize: 1234,
                  contentType: "image/png",
                  uploadedAt: 1,
                },
              ]
            : undefined
        }
      />
    );

    expect(screen.getByRole("button", { name: "Preview design.png" })).toBeDefined();
    const host = screen.getByTestId("response-attachments");
    expect(host.getAttribute("data-message-id")).toBe("user-message-1");
    expect(host.textContent).toBe("design.png");
    expect(host.classList.contains("items-end")).toBe(true);
  });

  test("renders text-only for legacy markers without a messageId", () => {
    render(<SteeredMessagePart part={basePart} />);

    expect(screen.getByText("steer me")).toBeDefined();
  });
});
