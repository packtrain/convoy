"use client";

import {
  buildAskUserQuestionResponseSummaryLines,
  type AskUserQuestionResponsePayload,
} from "@/lib/ai-tools/ask-user-question";

interface UserAskUserQuestionResponseProps {
  payload: AskUserQuestionResponsePayload;
}

export function UserAskUserQuestionResponse({
  payload,
}: UserAskUserQuestionResponseProps) {
  const lines = buildAskUserQuestionResponseSummaryLines(payload);

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">Your answers</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {lines.map((line, index) => (
          <li key={`${line}-${index}`}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
