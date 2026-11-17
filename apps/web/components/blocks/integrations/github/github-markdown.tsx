import { MessageResponse, type MessageResponseProps } from "@/components/ai-elements/message";

type HastNode = { type: string; value?: string; children?: HastNode[] };
const hasText = (node: HastNode): boolean =>
  node.type === "text" ? Boolean(node.value?.trim()) : (node.children ?? []).some(hasText);

/** GitHub bodies put icons inline (bot tables, badges); Streamdown's image wrapper and `sup` lift them off the text. */
const components: MessageResponseProps["components"] = {
  // Vercel wraps its avatars in a text-less <sup> only to nudge them; that lift is 7px here.
  sup: ({ node, children }) => (node && !hasText(node) ? children : <sup>{children}</sup>),
  // eslint-disable-next-line @next/next/no-img-element -- remote markdown images, sized by their own attributes
  img: ({ src, alt, title, width, height }) => <img src={src} alt={alt} title={title} width={width} height={height} className="inline max-w-full align-middle" />,
};

/** A GitHub description or comment body (docs/specs/github-integration.md → PR reader). */
export function GithubMarkdown({ children }: { children: string }) {
  return (
    <MessageResponse className="text-sm" components={components}>
      {children}
    </MessageResponse>
  );
}
