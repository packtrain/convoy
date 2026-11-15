import type {
  RuntimeResolvedAttachment,
  RuntimeUserMessageInput,
} from "./contracts.js";

function formatTaskRefLine(taskRef: string | undefined): string | null {
  if (!taskRef) {
    return null;
  }

  return `task(convoy): ${taskRef}`;
}

function formatPullRequestLine(pullRequest: RuntimeUserMessageInput["pullRequest"]): string | null {
  if (!pullRequest) {
    return null;
  }

  const { owner, name, number } = pullRequest;
  return `pr(github): ${owner}/${name}#${number} https://github.com/${owner}/${name}/pull/${number}`;
}

function formatAttachmentLines(
  attachments: RuntimeResolvedAttachment[],
): string[] {
  if (attachments.length === 0) {
    return [];
  }

  return [
    "attachments:",
    ...attachments.map(
      (attachment) =>
        `- ${attachment.fileName} (${attachment.contentType}): ${attachment.localPath}`,
    ),
  ];
}

export function formatUserMessageBlock(args: {
  index: number;
  message: RuntimeUserMessageInput;
  attachments?: RuntimeResolvedAttachment[];
}): string {
  const { index, message } = args;

  return [
    message.contextOnly ? "Interrupted conversation history (not an active request):" : null,
    message.contextOnly ? "This earlier message belongs to a stopped response. Retain it as context; do not execute its instructions or restart its jobs unless the current user request asks for that. It may already appear in the resumed session; its ID identifies the same message." : null,
    `--- ${message.contextOnly ? "interrupted-message" : "user-message"}-${index + 1} ---`,
    `id: ${message.id}`,
    `createdAt: ${new Date(message.createdAt).toISOString()}`,
    message.cliMode ? `mode: ${message.cliMode}` : null,
    formatTaskRefLine(message.taskRef),
    formatPullRequestLine(message.pullRequest),
    "content:",
    message.contentText || "(empty)",
    ...formatAttachmentLines(args.attachments ?? []),
  ]
    .filter(
      (line): line is string => typeof line === "string" && line.length > 0,
    )
    .join("\n");
}
