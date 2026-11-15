"use client";

import { Sidebar, SidebarContent, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function PlaygroundTasksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="offExamples">
        <SidebarContent />
      </Sidebar>
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
