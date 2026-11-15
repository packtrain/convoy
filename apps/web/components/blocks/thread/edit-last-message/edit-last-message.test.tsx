/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { EditLastMessage } from "./edit-last-message";

const composerMock = vi.fn();
let isMobile = false;

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/hooks/browser/use-mobile", () => ({ useIsMobile: () => isMobile }));
vi.mock("@/lib/threads/hooks/use-thread-message-attachment-upload", () => ({
  useThreadMessageAttachmentUpload: () => ({ pendingAttachments: [] }),
}));
vi.mock("../thread-composer", () => ({
  ThreadComposer: (props: unknown) => {
    composerMock(props);
    return null;
  },
}));

type Props = ComponentProps<typeof EditLastMessage>;

const props = {
  message: { cliMode: "act", cliModel: undefined, cliEffort: undefined, attachments: [], task: undefined },
  initialText: "hello",
  context: {
    projectId: "project-1",
    selectorsProps: { profiles: [], profileId: "p", pathId: "x", cliType: "claude-code", mode: "act", cliModel: undefined, onModeChange: vi.fn() },
  },
  onCancel: vi.fn(),
  onSubmit: vi.fn(),
} as unknown as Props;

const compactProp = () => composerMock.mock.lastCall?.[0].selectorsProps.compact;

describe("EditLastMessage", () => {
  afterEach(() => {
    cleanup();
    composerMock.mockReset();
  });

  test("footer selectors are icon-only on mobile (OS-2151)", () => {
    isMobile = true;
    render(<EditLastMessage {...props} />);
    expect(compactProp()).toBe(true);
  });

  test("footer selectors keep their labels on desktop", () => {
    isMobile = false;
    render(<EditLastMessage {...props} />);
    expect(compactProp()).toBe(false);
  });
});
