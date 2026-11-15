import type { Metadata } from "next";
import "./globals.css";
import "@/components/mdx-editor-kit/theme.css";

import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "UI Playground",
  description: "Standalone editor experiments for Convoy.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
