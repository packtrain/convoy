import chalk from "chalk";
import type { ArtifactCommentItem } from "./parsers.js";

export interface ArtifactCommentThread {
  root: ArtifactCommentItem;
  replies: ArtifactCommentItem[];
}

export function groupCommentThreads(comments: ArtifactCommentItem[]): ArtifactCommentThread[] {
  const repliesByParent = new Map<string, ArtifactCommentItem[]>();
  for (const comment of comments) {
    if (!comment.parentId) continue;
    const list = repliesByParent.get(comment.parentId) ?? [];
    list.push(comment);
    repliesByParent.set(comment.parentId, list);
  }
  return comments.filter((comment) => !comment.parentId).map((root) => ({ root, replies: repliesByParent.get(root._id) ?? [] }));
}

export function printCommentThreads(threads: ArtifactCommentThread[]): void {
  if (threads.length === 0) {
    console.log("No comments.");
    return;
  }

  for (const { root, replies } of threads) {
    const status = root.status ?? "open";
    const statusLabel = status === "resolved" ? chalk.green("[resolved]") : chalk.yellow("[open]");
    console.log(
      `\n${statusLabel} ${chalk.bold(root.authorName)} ${chalk.dim(new Date(root.createdAt).toISOString())} ${chalk.dim(root._id)}`
    );
    if (root.anchor?.text) {
      console.log(chalk.dim(`  > ${root.anchor.text}`));
    }
    console.log(`  ${root.content}`);
    for (const reply of replies) {
      console.log(`  ${chalk.dim("↳")} ${chalk.bold(reply.authorName)} ${chalk.dim(reply._id)}: ${reply.content}`);
    }
  }
  console.log();
}
