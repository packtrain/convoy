/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UserMessageText } from "./user-message-text";

describe("UserMessageText", () => {
  test("renders slash command markdown links as blue text", () => {
    render(<UserMessageText text="Use [/client-summary](convoy://command/org:client-summary)." />);

    const command = screen.getByText("/client-summary");
    expect(command.classList.contains("text-info")).toBe(true);
    expect(command.getAttribute("data-slash-command-canonical-key")).toBe("org:client-summary");
  });

  // OS-1784: skill mentions share the `/` trigger, so the accent is what tells
  // them apart from a Prompt mention in a dense thread.
  test("renders skill markdown links as violet text", () => {
    render(<UserMessageText text="Use [/pdf-tools](convoy://skill/pdf-tools)." />);

    const skill = screen.getByText("/pdf-tools");
    expect(skill.classList.contains("text-violet-600")).toBe(true);
    expect(skill.getAttribute("data-slash-command-canonical-key")).toBe("skill:pdf-tools");
  });

  test("leaves non-command slash text and urls unwrapped", () => {
    const { container } = render(<UserMessageText text="Open /client-summary, /shrug, https://example.com/path and src/app/page.tsx" />);

    expect(container.querySelector("[data-slash-command-text]")).toBeNull();
    expect(container.textContent).toBe("Open /client-summary, /shrug, https://example.com/path and src/app/page.tsx");
  });

  test("leaves non-command markdown links literal", () => {
    const { container } = render(<UserMessageText text="Read [docs](https://example.com/docs)." />);

    expect(container.querySelector("[data-slash-command-text]")).toBeNull();
    expect(container.textContent).toBe("Read [docs](https://example.com/docs).");
  });
});

const query = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useQuery: query }));
vi.mock("@/components/blocks/tasks/attachment-lightbox", () => ({
  AttachmentLightbox: ({ open, slides, initialIndex }: { open: boolean; slides: { src: string }[]; initialIndex: number }) =>
    open ? (
      <div role="dialog" aria-label="Image lightbox">
        {slides[initialIndex]?.src}
      </div>
    ) : null,
}));
const attachment = { storageId: "image-1", fileName: "before shot.png", contentType: "image/png", fileSize: 100, uploadedAt: 1 };
beforeEach(() => query.mockReset());
afterEach(cleanup);

test("highlights only exact unambiguous references and preserves slash mentions", () => {
  const { container } = render(
    <UserMessageText
      messageId="message-1"
      attachments={[attachment]}
      text={'Compare #"before shot.png". #unknown #"before shot.png"suffix [/pdf](convoy://skill/pdf)'}
    />
  );
  expect(screen.getAllByRole("button", { name: "Preview before shot.png" })).toHaveLength(1);
  expect(container.textContent).toContain('#unknown #"before shot.png"suffix');
  expect(screen.getByText("/pdf").classList.contains("text-violet-600")).toBe(true);
  expect(query.mock.calls.every((call) => call[1] === "skip")).toBe(true);
});

test("loads on focus, previews on hover, and opens the lightbox on click", async () => {
  const props = { messageId: "message-1", attachments: [attachment], text: '#"before shot.png"' };
  const { rerender } = render(<UserMessageText {...props} />);
  const reference = screen.getByRole("button", { name: "Preview before shot.png" });
  fireEvent.focus(reference);
  await waitFor(() => expect(query).toHaveBeenLastCalledWith(expect.anything(), { messageId: "message-1" }));
  expect(await screen.findByText("Loading preview…")).toBeDefined();
  query.mockReturnValue([{ storageId: "image-1", url: "https://example.com/before.png" }]);
  rerender(<UserMessageText {...props} />);
  expect(await screen.findByRole("img", { name: "before shot.png" })).toBeDefined();
  fireEvent.click(reference);
  expect(screen.getByRole("dialog", { name: "Image lightbox" }).textContent).toContain("before.png");
});

test("replays a click after URL resolution and handles unavailable images", async () => {
  const props = { messageId: "message-1", attachments: [attachment], text: '#"before shot.png"' };
  const { rerender } = render(<UserMessageText {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Preview before shot.png" }));
  expect(query).toHaveBeenLastCalledWith(expect.anything(), { messageId: "message-1" });
  query.mockReturnValue([]);
  rerender(<UserMessageText {...props} />);
  expect(await screen.findByText("Image unavailable")).toBeDefined();
  expect(screen.queryByRole("dialog")).toBeNull();
  query.mockReturnValue([{ storageId: "image-1", url: "https://example.com/before.png" }]);
  rerender(<UserMessageText {...props} />);
  expect(screen.getByRole("dialog").textContent).toContain("before.png");
});

test("leaves duplicate names plain and highlights documents without image actions", () => {
  const { container } = render(
    <UserMessageText
      messageId="message-1"
      attachments={[
        attachment,
        { ...attachment, storageId: "image-2" },
        { ...attachment, storageId: "doc", fileName: "notes.pdf", contentType: "application/pdf" },
      ]}
      text={'#"before shot.png" #notes.pdf'}
    />
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(container.querySelector("[data-attachment-reference]")?.textContent).toBe("#notes.pdf");
});

test("hover resolves the owning message and preview-image click opens its lightbox", async () => {
  query.mockImplementation((_ref, args) =>
    args === "skip" ? undefined : [{ storageId: "image-1", url: "https://example.com/hover.png" }]
  );
  render(<UserMessageText messageId="hover-message" attachments={[attachment]} text={'#"before shot.png"'} />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: "Preview before shot.png" }));
  const image = await screen.findByRole("img", { name: "before shot.png" });
  expect(image.getAttribute("src")).toBe("https://example.com/hover.png");
  expect(query).toHaveBeenLastCalledWith(expect.anything(), { messageId: "hover-message" });
  fireEvent.click(screen.getByRole("button", { name: "Open before shot.png in lightbox" }));
  expect(screen.getByRole("dialog").textContent).toContain("hover.png");
});
