/**
 * @vitest-environment jsdom
 */
import { useEffect } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PromptInput } from "./prompt-input";

describe("PromptInput", () => {
  afterEach(() => {
    cleanup();
  });

  test("can render as a non-form container inside another form", () => {
    const { container } = render(
      <form>
        <PromptInput as="div" onSubmit={vi.fn()}>
          <input name="message" />
        </PromptInput>
      </form>
    );

    expect(container.querySelectorAll("form")).toHaveLength(1);
  });
});

test.each([false, true])("acceptance returns only accepted parts with provider=%s", async (withProvider) => {
  const { act } = await import("@testing-library/react");
  const { PromptInputProvider, usePromptInputAttachments } = await import("./prompt-input");
  let api: ReturnType<typeof usePromptInputAttachments>;
  function Probe() { const attachments = usePromptInputAttachments(); useEffect(() => { api = attachments; }, [attachments]); return null; }
  URL.createObjectURL = vi.fn(() => "blob:accepted");
  URL.revokeObjectURL = vi.fn();
  const content = <PromptInput onSubmit={vi.fn()} accept="image/*" maxFileSize={3} maxFiles={2}><Probe /></PromptInput>;
  render(withProvider ? <PromptInputProvider>{content}</PromptInputProvider> : content);
  const valid = new File(["ok"], "image.png", { type: "image/png" });
  let accepted: ReturnType<typeof api.add> = [];
  act(() => {
    accepted = api.add([new File(["pdf"], "no.pdf", { type: "application/pdf" }), new File(["large"], "large.png", { type: "image/png" }), valid]);
    api.add([valid, valid]);
  });
  expect(accepted).toHaveLength(1);
  expect(accepted[0].filename).toBe("image.png");
  expect(api!.files).toHaveLength(2);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  act(() => { expect(api.add([valid])).toEqual([]); });
  act(() => { api.remove(accepted[0].id); });
  act(() => { expect(api.add([valid])).toHaveLength(1); });
  act(() => { api.clear(); });
  expect(api!.files).toHaveLength(0);
});
