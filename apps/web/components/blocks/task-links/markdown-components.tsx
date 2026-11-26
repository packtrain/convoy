"use client";

import { useContext, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { parseConvoyLink, parsePullRequestLink } from "./parsers";
import { ArtifactLink, LayoutContext, PullRequestLink, TaskLink } from "./task-link";

type HastNode = { type: string; tagName?: string; value?: string; properties?: { href?: unknown }; children?: HastNode[] };
type WithNode<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T> & { node?: HastNode };

/** A paragraph or list item whose only content is one task, artifact, or PR link. */
function isStandaloneLink(node: HastNode | undefined) {
  const content = (node?.children ?? []).filter((child) => !(child.type === "text" && !child.value?.trim()));
  const [only] = content;
  const href = typeof only?.properties?.href === "string" ? only.properties.href : undefined;
  return content.length === 1 && only.tagName === "a" && (parseConvoyLink(href) ?? parsePullRequestLink(href)) !== null;
}

/** Plain link text; inline code keeps its backticks so the name matches the stored title (OS-2269). */
function plainText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  const inner = (node.children ?? []).map(plainText).join("");
  return node.tagName === "code" ? `\`${inner}\`` : inner;
}

function isLinkList(node: HastNode | undefined) {
  const items = (node?.children ?? []).filter((child) => child.tagName === "li");
  return items.length > 0 && items.every(isStandaloneLink);
}

function Standalone({ children }: { children: ReactNode }) {
  const { row } = useContext(LayoutContext);
  return <LayoutContext.Provider value={{ standalone: true, row }}>{children}</LayoutContext.Provider>;
}

// Streamdown's built-in modal renders inline, so message containers clip it (OS-2047).
function ExternalLink({ href, className, children }: { href?: string; className?: string; children?: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const incomplete = href === "streamdown:incomplete-link";
  return (
    <>
      <button
        type="button"
        data-streamdown="link"
        data-incomplete={incomplete}
        onClick={() => href && !incomplete && setIsOpen(true)}
        className={cn("wrap-anywhere appearance-none text-left font-medium text-primary underline", className)}
      >
        {children}
      </button>
      {href && !incomplete && (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Open external link?</DialogTitle>
              <DialogDescription>You&apos;re about to visit an external website.</DialogDescription>
            </DialogHeader>
            <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">{href}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => void navigator.clipboard.writeText(href)}>
                Copy link
              </Button>
              <Button
                onClick={() => {
                  window.open(href, "_blank", "noreferrer");
                  setIsOpen(false);
                }}
              >
                Open link
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function List({ ordered, node, className, children }: { ordered: boolean; node?: HastNode; className?: string; children?: ReactNode }) {
  if (isLinkList(node)) {
    return (
      <LayoutContext.Provider value={{ standalone: false, row: true }}>
        <ul
          data-testid="task-link-table"
          className="my-2 max-w-xl list-none divide-y divide-border overflow-hidden rounded-lg border border-border bg-muted/30 p-0"
        >
          {children}
        </ul>
      </LayoutContext.Provider>
    );
  }
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={cn(ordered ? "list-decimal" : "list-disc", "list-inside whitespace-normal pl-5 [li_&]:pl-6", className)}>
      {children}
    </Tag>
  );
}

/** Streamdown overrides that render task, artifact, and PR links as previews (docs/specs/cli-thread-message-links.md). */
export const taskLinkComponents = {
  a: ({ href, title, className, node, children }: WithNode<"a">) => {
    const link = parseConvoyLink(href);
    const text = node ? plainText(node) : children;
    if (link?.artifactId) return <ArtifactLink link={{ ...link, artifactId: link.artifactId }} title={title}>{text}</ArtifactLink>;
    if (link) return <TaskLink link={link} title={title}>{text}</TaskLink>;
    const pullRequest = parsePullRequestLink(href);
    if (pullRequest) return <PullRequestLink link={pullRequest} title={title}>{text}</PullRequestLink>;
    return <ExternalLink href={href} className={className}>{children}</ExternalLink>;
  },
  p: ({ node, className, children }: WithNode<"p">) =>
    isStandaloneLink(node) ? (
      <div className={className}>
        <Standalone>{children}</Standalone>
      </div>
    ) : (
      <p className={className}>{children}</p>
    ),
  ul: (props: WithNode<"ul">) => <List ordered={false} {...props} />,
  ol: (props: WithNode<"ol">) => <List ordered {...props} />,
  li: ListItem,
};

/** A lone link becomes a block only in a link table; in a mixed list it stays a bulleted chip. */
function ListItem({ node, className, children }: WithNode<"li">) {
  const { row } = useContext(LayoutContext);
  return row && isStandaloneLink(node) ? (
    <li className="list-none">
      <Standalone>{children}</Standalone>
    </li>
  ) : (
    <li className={cn("py-1 [&>p]:inline", className)}>{children}</li>
  );
}
