/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  Conversation,
  ConversationScrollButton,
  type ConversationHandle,
} from "./conversation";

const libraryScrollToBottomMock = vi.hoisted(() => vi.fn());
const stickState = vi.hoisted(() => ({ isAtBottom: true }));

vi.mock("use-stick-to-bottom", async () => {
  const React = await import("react");

  function StickToBottom({
    children,
    contextRef,
  }: {
    children?: ReactNode;
    contextRef?: Ref<{ scrollToBottom: typeof libraryScrollToBottomMock }>;
  }) {
    React.useImperativeHandle(
      contextRef,
      () => ({ scrollToBottom: libraryScrollToBottomMock }),
      []
    );
    return <div>{children}</div>;
  }

  function StickToBottomContent({
    children,
  }: {
    children?: ReactNode;
  }) {
    return <div>{children}</div>;
  }

  StickToBottom.Content = StickToBottomContent;

  return {
    StickToBottom,
    useStickToBottomContext: () => ({
      isAtBottom: stickState.isAtBottom,
      scrollToBottom: libraryScrollToBottomMock,
    }),
  };
});

describe("Conversation", () => {
  test("exposes an instant bottom-scroll handle", () => {
    let conversationHandle: ConversationHandle | null = null;

    render(
      <Conversation
        ref={(handle) => {
          conversationHandle = handle;
        }}
      >
        Conversation content
      </Conversation>
    );

    act(() => {
      conversationHandle?.scrollToBottom();
    });

    expect(libraryScrollToBottomMock).toHaveBeenCalledWith("instant");
  });

  test("the scroll-to-bottom button is named", () => {
    stickState.isAtBottom = false;
    render(<ConversationScrollButton />);
    stickState.isAtBottom = true;

    expect(screen.getByRole("button", { name: "Scroll to bottom" })).toBeTruthy();
  });
});
