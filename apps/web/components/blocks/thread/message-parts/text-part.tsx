import { startTransition, useEffect, useState } from "react";
import type { TextUIPart } from "ai";
import { MessageResponse } from "@/components/ai-elements/message";
import { TaskLinkHandlersContext, type TaskLinkHandlers } from "@/components/blocks/task-links";

interface TextPartProps extends TaskLinkHandlers {
  part: TextUIPart;
}

export function TextPart({ part, onOpenTask, onOpenArtifact }: TextPartProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    startTransition(() => {
      setReady(true);
    });
  }, []);

  if (!ready) {
    return <div className="whitespace-pre-wrap text-sm">{part.text}</div>;
  }

  return (
    <TaskLinkHandlersContext.Provider value={{ onOpenTask, onOpenArtifact }}>
      <MessageResponse>{part.text}</MessageResponse>
    </TaskLinkHandlersContext.Provider>
  );
}
