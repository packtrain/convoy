import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PlaygroundLayout({ children }: LayoutProps<"/playground">) {
  return children;
}
