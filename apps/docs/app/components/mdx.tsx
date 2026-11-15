import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { isValidElement } from "react";
import { Mermaid } from "./mermaid";

function getTextFromNode(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextFromNode).join("");

  if (isValidElement<{ children?: unknown }>(node)) {
    return getTextFromNode(node.props.children);
  }

  return "";
}

function isMermaidPre(children: unknown) {
  if (!isValidElement<{ className?: string }>(children)) return false;

  return (
    children.props.className?.split(" ").includes("language-mermaid") ?? false
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Mermaid,
    pre: ({ children, ...props }) => {
      if (isMermaidPre(children)) {
        return <Mermaid chart={getTextFromNode(children).trim()} />;
      }

      const Pre = defaultMdxComponents.pre ?? "pre";

      return <Pre {...props}>{children}</Pre>;
    },
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
